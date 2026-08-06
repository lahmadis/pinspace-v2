import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/server'
import { getVerifiedUser } from '@/lib/auth/requireAdmin'
import { validateName } from '@/lib/validation/safeName'
import { isUuid } from '@/lib/validation/uuid'
import { generateOwnerColor } from '@/lib/ownerColors'

export const dynamic = 'force-dynamic'

/**
 * PATCH /api/boards/[id]/owner — reassign a board to a different member.
 *
 * For the case where a board lands under the wrong name: a student uploads to a
 * classmate's spot, or an instructor bulk-uploads a crit and everything comes
 * out owned by them. Ownership is what gates editing and deletion, so a
 * mis-attributed board is not merely a wrong label — the actual author cannot
 * touch their own work.
 *
 * Auth: the WORKSPACE OWNER or a platform admin. Deliberately NOT the board's
 * current owner — self-service reassignment would let a student hand their
 * board to someone else to dodge a crit, and would let anyone with edit rights
 * launder authorship. Not plain members either, for the same reason.
 *
 * The TARGET must already be a member of that workspace. This route grants no
 * access it did not already have: you can only reassign to someone who can
 * already see the studio.
 *
 * FIVE COLUMNS MOVE TOGETHER, and they have to:
 *   owner_id      — the authorization key (app/api/boards/route.ts:428, :548).
 *   owner_name    — leave it and the board reads "belongs to X" while X gets a
 *                   403 editing it.
 *   owner_color   — lib/ownerColors.ts derives this as a deterministic hash of
 *                   the user id ("a consistent color for a user"). It is
 *                   identity, not decoration; a stale one renders this board in
 *                   a different colour from every other board its owner has.
 *   student_name  — DraggableBoard prefers student_name over owner_name for the
 *                   label under the board, so a reassignment that skips this
 *                   changes nothing anyone can see in the 3D room.
 *   student_email — see the note on `studentEmail` below.
 *
 * Service role + app-level check (established pattern); no new RLS policies.
 */

interface OwnerPatchBody {
  /** Auth user id of the new owner. Must be an existing member. */
  ownerId?: unknown
  /**
   * Optional display-name override for student_name.
   *
   * student_name is NOT guaranteed to be an account holder's name — the
   * lightbox author-name edit (LightboxModal handleSaveAuthorName) writes free
   * text straight into it, which is how a board uploaded by a TA on someone
   * else's behalf gets attributed. So: default it to the new owner's resolved
   * name, but let a caller preserve a curated label. Defaulting with no escape
   * hatch would silently destroy those.
   */
  studentName?: unknown
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const caller = await getVerifiedUser()
    if (!caller) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const boardId = params.id
    if (!boardId) {
      return NextResponse.json({ error: 'Board id is required' }, { status: 400 })
    }

    const body = (await request.json().catch(() => null)) as OwnerPatchBody | null
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    // Reject a malformed id BEFORE it reaches a uuid column. user_profiles
    // .user_id is UUID, and auth.admin.getUserById expects one — a non-UUID
    // string raises 22P02 there and fails the whole statement, turning a
    // should-be-400 into a 500. (workspace_members.user_id is TEXT — compared
    // against auth.uid()::text throughout the RLS policies — so that lookup
    // would merely miss, but there is no reason to let it get that far.)
    //
    // boardId needs no such guard: boards.id is TEXT, a generated
    // `board-<ts>-<rand>` string, not a uuid.
    const newOwnerId = typeof body.ownerId === 'string' ? body.ownerId.trim() : ''
    if (!isUuid(newOwnerId)) {
      return NextResponse.json({ error: 'A valid ownerId is required' }, { status: 400 })
    }

    // Validate the override up front so a bad label fails before any write.
    let studentNameOverride: string | null = null
    if (body.studentName !== undefined) {
      const check = validateName(body.studentName, { maxLength: 80, fieldLabel: 'Author name' })
      if (!check.ok) {
        return NextResponse.json({ error: check.error }, { status: 400 })
      }
      studentNameOverride = check.value
    }

    const admin = supabaseServiceRole()

    const { data: board, error: boardErr } = await admin
      .from('boards')
      .select('id, workspace_id, owner_id')
      .eq('id', boardId)
      .maybeSingle()

    if (boardErr) {
      console.error('Error loading board for reassignment:', boardId, boardErr)
      return NextResponse.json({ error: 'Failed to load board' }, { status: 500 })
    }
    if (!board) {
      return NextResponse.json({ error: 'Board not found' }, { status: 404 })
    }

    const workspaceId = board.workspace_id as string

    const { data: workspace, error: wsErr } = await admin
      .from('workspaces')
      .select('owner_id')
      .eq('id', workspaceId)
      .maybeSingle()

    if (wsErr) {
      console.error('Error loading workspace for board reassignment:', workspaceId, wsErr)
      return NextResponse.json({ error: 'Failed to verify access' }, { status: 500 })
    }
    if (!workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    // Workspace owner OR platform admin. A failed membership lookup must not
    // read as "not authorized" — it is a 500, handled below for the target.
    const isWorkspaceOwner = workspace.owner_id === caller.userId
    if (!isWorkspaceOwner && !caller.isPlatformAdmin) {
      return NextResponse.json(
        { error: 'Only the studio owner can reassign a board.' },
        { status: 403 }
      )
    }

    // Already theirs — nothing to write. Reported as an explicit no-op rather
    // than an error so a resubmitted form is harmless, and rather than a silent
    // success so the caller can tell the two apart.
    if (board.owner_id === newOwnerId) {
      return NextResponse.json({ success: true, changed: false, ownerId: newOwnerId })
    }

    // The target must ALREADY belong to this workspace. The owner is guaranteed
    // a members row by createWorkspace.ensureOwnerMembership, but check
    // owner_id directly too so a workspace whose row went missing does not
    // become un-reassignable.
    let targetIsMember = workspace.owner_id === newOwnerId
    if (!targetIsMember) {
      const { data: membership, error: membershipErr } = await admin
        .from('workspace_members')
        .select('user_id')
        .eq('workspace_id', workspaceId)
        .eq('user_id', newOwnerId)
        .maybeSingle()
      if (membershipErr) {
        console.error('Error checking target membership for board reassignment:', membershipErr)
        return NextResponse.json({ error: 'Failed to verify the new owner' }, { status: 500 })
      }
      targetIsMember = membership != null
    }
    if (!targetIsMember) {
      return NextResponse.json(
        { error: 'That person is not a member of this studio. Add them first.' },
        { status: 400 }
      )
    }

    // Resolve the target through the auth admin API rather than trusting the id
    // from the client: proves the account exists, and is the ONLY source for
    // student_email. Never take an email off the request body — that would let
    // a studio owner stamp an arbitrary address onto a board.
    const { data: targetAuth, error: targetErr } = await admin.auth.admin.getUserById(newOwnerId)
    if (targetErr || !targetAuth?.user) {
      if (targetErr) console.error('Error resolving new board owner:', newOwnerId, targetErr)
      return NextResponse.json({ error: 'That account no longer exists' }, { status: 404 })
    }

    const { data: targetProfile, error: profileErr } = await admin
      .from('user_profiles')
      .select('full_name')
      .eq('user_id', newOwnerId)
      .maybeSingle()
    if (profileErr) {
      // Non-fatal — we fall back to the auth record below — but a swallowed
      // failure here silently renames the board to an email prefix.
      console.error('Error loading new owner profile (falling back to auth record):', profileErr)
    }

    // Same precedence as board creation (app/api/boards/route.ts:915). Run it
    // through safeName because user_metadata.full_name is user-controlled at
    // signup and this lands in a rendered label; fall back rather than reject,
    // since a bad display name must not block a correction to authorship.
    const rawOwnerName =
      (targetProfile?.full_name as string | null)?.trim() ||
      targetAuth.user.user_metadata?.full_name ||
      targetAuth.user.email?.split('@')[0] ||
      'User'
    const nameCheck = validateName(rawOwnerName, { maxLength: 80, fieldLabel: 'Owner name' })
    const ownerName = nameCheck.ok ? nameCheck.value : 'User'

    // student_email follows the owner. Leaving it stale would park the previous
    // student's real address under a different person's name on the board
    // detail page, where every workspace member can read it.
    const updates = {
      owner_id: newOwnerId,
      owner_name: ownerName,
      owner_color: generateOwnerColor(newOwnerId),
      student_name: studentNameOverride ?? ownerName,
      student_email: targetAuth.user.email ?? null,
    }

    const { data: updated, error: updateError } = await admin
      .from('boards')
      .update(updates)
      .eq('id', boardId)
      .select('id, owner_id, owner_name, owner_color, student_name, student_email')
      .maybeSingle()

    if (updateError || !updated) {
      console.error('Error reassigning board owner:', boardId, updateError)
      return NextResponse.json({ error: 'Failed to reassign this board' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      changed: true,
      previousOwnerId: (board.owner_id as string | null) ?? null,
      board: {
        id: updated.id,
        ownerId: updated.owner_id,
        ownerName: updated.owner_name,
        ownerColor: updated.owner_color,
        studentName: updated.student_name,
        studentEmail: updated.student_email,
      },
    })
  } catch (error) {
    console.error('Unexpected error in PATCH /api/boards/[id]/owner:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
