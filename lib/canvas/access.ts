import type { NextRequest } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'
import { isSuperadmin } from '@/lib/auth/superadmin'
import { getVerifiedUser } from '@/lib/auth/requireAdmin'
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
  /**
   * The canvas's room, resolved server-side — never taken from the client.
   *
   * NULL for a PERSONAL canvas (migration 038), which has no room at all. The
   * node routes copy this straight onto canvas_nodes.room_id, and that column
   * is what 036's SELECT policies pivot on — so a personal node carries NULL
   * there and matches none of them, which is correct: those policies grant
   * workspace members access, and a personal canvas has no members.
   */
  roomId: string | null
  /** The canvas's personal owner, when it has one. NULL for a room canvas. */
  ownerId: string | null
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
  // `*`, not a column list naming owner_id.
  //
  // owner_id arrives with migration 038, and migrations here are applied by
  // hand — so there is a window where this code is running against a database
  // that does not have the column yet. PostgREST answers a named-but-missing
  // column with 42703, which surfaces as a null row and would 404 EVERY canvas
  // route, room canvases included. A star select just yields undefined for the
  // absent field, which the branch below reads as "not personal" and falls
  // through to the room path that already worked.
  const { data: canvas } = await db
    .from('canvases')
    .select('*')
    .eq('id', canvasId)
    .maybeSingle()

  if (!canvas) return { ok: false, status: 404, error: 'Canvas not found' }

  // Migration 038 guarantees exactly one anchor, so this is a clean either/or
  // rather than a precedence question. Personal first only because it is the
  // cheaper check — no joins.
  const ownerId = canvas.owner_id as string | null
  if (ownerId) return resolvePersonalCanvasAccess(ownerId)

  // Both anchors null should be impossible — 038's CHECK requires exactly one.
  // Treated as not-found rather than passed through, because the room resolver
  // would query `rooms` for a null id and return a 404 by accident; a canvas
  // that is reachable by nobody is genuinely gone, and saying so here keeps
  // that from reading as a bug in the room lookup.
  const roomId = canvas.room_id as string | null
  if (!roomId) return { ok: false, status: 404, error: 'Canvas not found' }

  return resolveRoomCanvasAccess(request, roomId)
}

/**
 * A canvas that belongs to one person: its owner, and nobody else.
 *
 * No members, no org, no guest tokens, no public path — and deliberately no
 * superadmin either, which is the one place this is STRICTER than the room
 * path. A superadmin can already reach any workspace's canvases; a desk crit's
 * private notes are a different thing, and quietly extending an existing
 * administrative reach over them is not a decision to make in passing. Add it
 * when someone asks for it and can say why.
 */
async function resolvePersonalCanvasAccess(ownerId: string): Promise<CanvasAccessResult> {
  const viewer = await resolveViewer()
  if (!viewer.ok) return { ok: false, status: 403, error: 'Forbidden' }
  // owner_id is TEXT and the uid is a uuid string — compared as strings, never
  // joined. Same cast trap as workspaces.owner_id.
  if (viewer.userId !== ownerId) return { ok: false, status: 403, error: 'Forbidden' }

  return {
    ok: true,
    access: {
      roomId: null,
      ownerId,
      authorId: viewer.userId,
      guestTokenId: null,
      updatedBy: viewer.userId,
      canWrite: true,
      authorName: viewer.authorName,
    },
  }
}

export type ViewerResult =
  | { ok: true; userId: string; authorName: string }
  | { ok: false; status: 403; error: string }

/**
 * The signed-in account and its display name, with no canvas in hand.
 *
 * The collection route needs this before a canvas exists — it is creating one —
 * and the personal path needs it to compare against an owner. Factored out so
 * the display-name resolution (server-side, capped) has exactly one definition;
 * a second copy is how one route starts trusting a client-supplied name.
 */
export async function resolveViewer(): Promise<ViewerResult> {
  // getVerifiedUser(), NOT getSession() — and deliberately unlike the room path
  // a few lines below.
  //
  // getSession() decodes the auth cookie without re-verifying the JWT against
  // GoTrue, so it yields an unverified `sub` claim. That is a reasonable trade
  // for the room path, where the uid is only the key to a membership lookup: an
  // attacker who could choose it would still have to choose one that belongs to
  // the workspace. Here the uid IS the entire access check — `viewer.userId ===
  // ownerId`, nothing else — so an unverified claim would be the whole gate,
  // and the stated promise for a desk crit is that nobody else can read it.
  //
  // The cost is one GoTrue round trip per request that touches a personal
  // canvas, which includes each node write. Per gesture, not per frame — a drag
  // commits once on pointerup — and this is the surface to spend it on.
  const verified = await getVerifiedUser()
  if (!verified) return { ok: false, status: 403, error: 'Forbidden' }

  // user_profiles.user_id is uuid and userId is the uuid string — an eq filter,
  // never a join against a TEXT owner column.
  const { data: profile } = await supabaseServiceRole()
    .from('user_profiles')
    .select('full_name')
    .eq('user_id', verified.userId)
    .maybeSingle()

  return {
    ok: true,
    userId: verified.userId,
    authorName: displayNameOf(profile?.full_name, verified.email),
  }
}

/**
 * Capped display name.
 *
 * author_name rides on every row a user writes, and REPLICA IDENTITY FULL
 * rebroadcasts the whole row to every subscriber on each update — so a
 * 300-character name is paid for repeatedly by everyone in the space rather
 * than once by its owner.
 */
function displayNameOf(fullName: string | null | undefined, email: string | null | undefined): string {
  return (fullName?.trim() || email?.split('@')[0] || 'Anonymous').slice(0, 80)
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
        // Guest tokens are scoped to a ROOM, so they can only ever reach a room
        // canvas. A personal canvas is never resolved through this function.
        ownerId: null,
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
  const supabase = await supabaseServer()
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
  const authorName = displayNameOf(profile?.full_name, session?.user?.email)

  return {
    ok: true,
    access: {
      roomId,
      ownerId: null,
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
