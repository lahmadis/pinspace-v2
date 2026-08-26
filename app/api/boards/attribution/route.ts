import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/server'
import { getVerifiedUser } from '@/lib/auth/requireAdmin'
import { validateName } from '@/lib/validation/safeName'
import { cleanDisplayName } from '@/lib/displayName'

export const dynamic = 'force-dynamic'

/** Guard against a client shipping an unbounded id list into an IN clause. */
const MAX_BOARDS = 200

/**
 * PATCH /api/boards/attribution — relabel who a set of boards is credited to.
 *
 * NOT the same thing as [id]/owner, and deliberately separate from it:
 *
 *   [id]/owner  moves a board to a different ACCOUNT. It rewrites owner_id and
 *               owner_color too, because ownership is the authorization key —
 *               who may edit and delete the board.
 *   this route  changes only the DISPLAY label. Nobody gains or loses access;
 *               the board simply reads under a different name.
 *
 * That distinction is the whole reason this exists. The case it serves is a
 * board (or a whole stack of them) pinned under a misspelled or placeholder
 * name — a guest upload, an import, a TA pinning on someone's behalf — where
 * there is no account to reassign TO. Forcing that through [id]/owner would
 * mean inventing an account just to fix a label.
 *
 * IT WRITES student_name AND NOT owner_name, deliberately:
 *   student_name  — the curated label. Free text by design; the same column
 *                   LightboxModal's author edit writes, and the one
 *                   lib/displayName.ts boardAuthorName prefers everywhere.
 *   owner_name    — a snapshot of the owning ACCOUNT's display name, which
 *                   GET /api/boards re-resolves from the live user_profiles row
 *                   on every read. Writing a label into it would be overwritten
 *                   on the next fetch for anyone with a profile name, so the
 *                   rename would appear to work and then silently revert.
 *
 * Batched rather than one-board-at-a-time because the caller renames a PERSON,
 * whose sheets are a set. A partial rename splits that person into two rows in
 * every grouped view, so the write is a single UPDATE over the id list.
 *
 * Auth: workspace owner, platform admin, or someone who owns every board in the
 * set. Plain members are excluded on the same reasoning as [id]/owner — letting
 * any member restamp authorship on someone else's work is how attribution gets
 * laundered. Owning the boards yourself is allowed, since that is just
 * correcting your own label.
 *
 * Service role + app-level check (established pattern); no new RLS policies.
 */

interface AttributionPatchBody {
  boardIds?: unknown
  name?: unknown
}

export async function PATCH(request: NextRequest) {
  try {
    const caller = await getVerifiedUser()
    if (!caller) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await request.json().catch(() => null)) as AttributionPatchBody | null
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const nameCheck = validateName(body.name, { maxLength: 80, fieldLabel: 'Name' })
    if (!nameCheck.ok) {
      return NextResponse.json({ error: nameCheck.error }, { status: 400 })
    }
    const name = nameCheck.value

    // "Anonymous", "Unknown", "User", "Uploaded board" are the strings older
    // upload paths wrote when they could not resolve a name, and every surface
    // treats them as absent (lib/displayName.ts). Accepting one here would not
    // relabel the work — it would ERASE the person: deriveRoomStudents drops
    // boards with no usable name, so their whole row would vanish from the 2D
    // archive and the roster with no way back through this same UI.
    if (!cleanDisplayName(name)) {
      return NextResponse.json(
        { error: `"${name}" reads as no name at all — the work would stop being listed under anyone. Pick a different name.` },
        { status: 400 }
      )
    }

    if (!Array.isArray(body.boardIds)) {
      return NextResponse.json({ error: 'boardIds must be an array' }, { status: 400 })
    }
    // De-duplicated: a repeated id is harmless in an IN clause but would make
    // the returned count disagree with what the client thinks it sent.
    const boardIds = Array.from(
      new Set(body.boardIds.filter((id): id is string => typeof id === 'string' && id.length > 0))
    )
    if (boardIds.length === 0) {
      return NextResponse.json({ error: 'At least one board id is required' }, { status: 400 })
    }
    if (boardIds.length > MAX_BOARDS) {
      return NextResponse.json(
        { error: `Cannot relabel more than ${MAX_BOARDS} boards at once` },
        { status: 400 }
      )
    }

    const admin = supabaseServiceRole()

    const { data: boards, error: boardsErr } = await admin
      .from('boards')
      .select('id, workspace_id, owner_id')
      .in('id', boardIds)

    if (boardsErr) {
      console.error('Error loading boards for attribution change:', boardsErr)
      return NextResponse.json({ error: 'Failed to load boards' }, { status: 500 })
    }
    if (!boards || boards.length === 0) {
      return NextResponse.json({ error: 'No matching boards' }, { status: 404 })
    }

    // Every board must live in ONE workspace. Without this a caller who owns
    // workspace A could slip a board from workspace B into the list and have
    // the single ownership check below wave it through.
    const workspaceIds = new Set(boards.map((b) => b.workspace_id as string))
    if (workspaceIds.size !== 1) {
      return NextResponse.json(
        { error: 'All boards must belong to the same studio' },
        { status: 400 }
      )
    }
    const workspaceId = boards[0].workspace_id as string

    const { data: workspace, error: wsErr } = await admin
      .from('workspaces')
      .select('owner_id')
      .eq('id', workspaceId)
      .maybeSingle()

    if (wsErr) {
      console.error('Error loading workspace for attribution change:', workspaceId, wsErr)
      return NextResponse.json({ error: 'Failed to verify access' }, { status: 500 })
    }
    if (!workspace) {
      return NextResponse.json({ error: 'Studio not found' }, { status: 404 })
    }

    const isWorkspaceOwner = workspace.owner_id === caller.userId
    const ownsEveryBoard = boards.every((b) => b.owner_id === caller.userId)
    if (!isWorkspaceOwner && !caller.isPlatformAdmin && !ownsEveryBoard) {
      return NextResponse.json(
        { error: 'Only the studio owner can change who work is credited to.' },
        { status: 403 }
      )
    }

    // Scoped by workspace as well as id: the ids were just proven to be in this
    // one workspace, and pinning the statement to it means a race that moved a
    // board out from under us cannot carry the write along with it.
    const { data: updated, error: updateError } = await admin
      .from('boards')
      .update({ student_name: name })
      .in('id', boardIds)
      .eq('workspace_id', workspaceId)
      .select('id')

    if (updateError) {
      console.error('Error updating board attribution:', updateError)
      return NextResponse.json({ error: 'Failed to change the name' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      name,
      updated: updated?.length ?? 0,
    })
  } catch (error) {
    console.error('Unexpected error in PATCH /api/boards/attribution:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
