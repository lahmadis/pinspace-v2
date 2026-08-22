import type { NextRequest } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'
import { isSuperadmin } from '@/lib/auth/superadmin'
import { resolveGuestToken, getGuestTokenFromRequest } from '@/lib/auth/guestToken'
import { MAX_CANVAS_PAYLOAD_BYTES } from '@/lib/canvas/types'

// Types and validators live in lib/canvas/types.ts, which imports nothing, so
// the browser can share them without pulling next/server and the service-role
// client into its bundle. Re-exported here so server code has one import.
export * from '@/lib/canvas/types'

/**
 * Who may read and write a canvas, resolved once and shared by every canvas
 * route.
 *
 * The tables are service-role-only (migration 036 adds SELECT policies purely so
 * realtime can deliver; it grants no write access), so authorisation lives here
 * in app code — the pattern CLAUDE.md mandates and that board-comments already
 * follows. Extracted rather than copied per route because the check is ~60 lines
 * of joins and a divergent copy is how one route quietly becomes more permissive
 * than its siblings.
 *
 * Canvas content is PRIVATE to the room's workspace. There is deliberately no
 * public/published path: a published space exposes its board images, not the
 * working record of a desk crit. Same call as the critique layer.
 *
 * Migration 036 shipped canvas_nodes with the full four-policy SELECT set
 * copied from board_traces, which contradicted that — public and org readers
 * could pull canvas_nodes straight from PostgREST for any published workspace,
 * never touching this file. Migration 037 drops those two. What remains (owner,
 * member) matches what this resolver grants, so the invariant above is now true
 * at the database as well as here.
 */

export interface CanvasAccess {
  /** The canvas's room, resolved server-side — never taken from the client. */
  roomId: string
  /** Identity to stamp on rows this request writes. */
  authorId: string | null
  guestTokenId: string | null
  /** Opaque last-writer identity: account uid, or the guest token id. */
  updatedBy: string
  canWrite: boolean
  /**
   * Display name to stamp on rows this request writes, resolved SERVER-SIDE.
   *
   * Not taken from the request body for account holders — a name in the record
   * of a crit is attribution, and a member who can type their own author_name
   * can sign a node "Prof. Smith". Guests are the one case that may supply a
   * name (they have no profile to read), and only as an override of this
   * default, capped in the route. Same split as board_traces.
   */
  authorName: string
}

export type CanvasAccessResult =
  | { ok: true; access: CanvasAccess }
  | { ok: false; status: 403 | 404; error: string }

/**
 * Resolve a request's access to one canvas.
 *
 * Returns 403 rather than 401 for the no-session case, matching board-comments:
 * a logged-out visitor to a public space shouldn't be bounced into a login flow
 * merely because a private layer is hidden from them.
 */
export async function resolveCanvasAccess(
  request: NextRequest,
  canvasId: string
): Promise<CanvasAccessResult> {
  const db = supabaseServiceRole()

  // The canvas row is the ONLY source of room_id. Deriving it here rather than
  // accepting it from the client is load-bearing: migration 036's SELECT
  // policies pivot on canvas_nodes.room_id, so a node written with a mismatched
  // room_id would become visible to the wrong workspace.
  const { data: canvas } = await db
    .from('canvases')
    .select('id, room_id')
    .eq('id', canvasId)
    .maybeSingle()

  if (!canvas) return { ok: false, status: 404, error: 'Canvas not found' }
  return resolveRoomCanvasAccess(request, canvas.room_id as string)
}

/**
 * The same check, keyed on a room instead of a canvas — for the collection
 * route, which has no canvas to derive a room from yet.
 *
 * Shared with resolveCanvasAccess rather than reimplemented: a second copy of
 * an owner/member check is how one route quietly becomes more permissive than
 * its siblings.
 *
 * Callers that take roomId from the client (as the collection route must) are
 * responsible for the fact that this only proves the CALLER may write that
 * room — it does not validate any other client-supplied id against it.
 */
export async function resolveRoomCanvasAccess(
  request: NextRequest,
  roomId: string
): Promise<CanvasAccessResult> {
  const db = supabaseServiceRole()

  // Guest path: a token scoped to THIS canvas's room. Guests may draw only if
  // the token carries canTrace — the nearest existing capability to marking up
  // someone's work, and the one guest critics are already granted for boards.
  const guestToken = getGuestTokenFromRequest(request)
  if (guestToken) {
    const guest = await resolveGuestToken(guestToken)
    if (!guest || guest.roomId !== roomId) {
      return { ok: false, status: 403, error: 'Forbidden' }
    }
    return {
      ok: true,
      access: {
        roomId,
        authorId: null,
        guestTokenId: guest.tokenId,
        updatedBy: guest.tokenId,
        canWrite: guest.canTrace,
        authorName: guest.label || 'Guest',
      },
    }
  }

  // getSession(), matching board_traces and the rest of the content routes.
  // getVerifiedUser()'s getUser() is reserved for privileged writes that
  // reassign ownership (see lib/auth/requireAdmin.ts) — drawing on a canvas is
  // an ordinary content write, and using a different identity path here than
  // the trace route uses for the same act would be the inconsistency, not the
  // fix.
  const supabase = supabaseServer()
  const { data: { session } } = await supabase.auth.getSession()
  const userId = session?.user?.id
  if (!userId) return { ok: false, status: 403, error: 'Forbidden' }

  const { data: room } = await db
    .from('rooms')
    .select('workspace_id')
    .eq('id', roomId)
    .maybeSingle()
  const workspaceId = room?.workspace_id as string | undefined
  if (!workspaceId) return { ok: false, status: 404, error: 'Space not found' }

  const { data: workspace } = await db
    .from('workspaces')
    .select('owner_id')
    .eq('id', workspaceId)
    .maybeSingle()

  // owner_id is TEXT and userId is a uuid string — compared as strings, never
  // joined, which is the cast trap CLAUDE.md calls out.
  let allowed = workspace?.owner_id === userId
  if (!allowed) {
    const { data: membership } = await db
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle()
    allowed = membership != null
  }
  if (!allowed) allowed = await isSuperadmin(userId, db)
  if (!allowed) return { ok: false, status: 403, error: 'Forbidden' }

  // user_profiles.user_id is uuid and userId is the uuid string — an eq filter,
  // never a join against workspaces.owner_id (text), which is the cast trap.
  const { data: profile } = await db
    .from('user_profiles')
    .select('full_name')
    .eq('user_id', userId)
    .maybeSingle()
  // Capped like the guest path: author_name rides on every row this user
  // writes, and REPLICA IDENTITY FULL rebroadcasts the whole row to every
  // subscriber on each update, so a 300-character display name is paid for
  // repeatedly by everyone in the space rather than once by its owner.
  const authorName = (
    profile?.full_name?.trim() || session?.user?.email?.split('@')[0] || 'Anonymous'
  ).slice(0, 80)

  return {
    ok: true,
    access: {
      roomId,
      authorId: userId,
      guestTokenId: null,
      updatedBy: userId,
      canWrite: true,
      authorName,
    },
  }
}

export type CappedBody =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; status: 400 | 413; error: string }

/** Read and parse a request body, refusing oversized ones before the parse. */
export async function readCappedJson(request: NextRequest): Promise<CappedBody> {
  const raw = await request.text().catch(() => null)
  if (raw === null) return { ok: false, status: 400, error: 'Invalid body' }
  // byteLength, not .length — the latter counts UTF-16 units, so a props blob
  // full of multibyte characters would sail past a cap named in bytes at two
  // to three times its nominal size.
  //
  // Note this buffers the body before measuring it: the cap protects the
  // database and the realtime fan-out, not this function's own memory. Refusing
  // earlier would mean reading the stream in chunks, which is not worth it
  // while Next's own body limit sits above this one.
  if (Buffer.byteLength(raw, 'utf8') > MAX_CANVAS_PAYLOAD_BYTES) {
    return { ok: false, status: 413, error: 'Payload too large (max 1 MB)' }
  }
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, status: 400, error: 'Invalid body' }
    }
    return { ok: true, body: parsed as Record<string, unknown> }
  } catch {
    return { ok: false, status: 400, error: 'Invalid JSON' }
  }
}
