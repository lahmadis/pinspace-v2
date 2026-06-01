import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'
import { isInstructorAccount } from '@/lib/auth/getAccountRole'
import { validateName } from '@/lib/validation/safeName'

export const dynamic = 'force-dynamic'

/**
 * Look up the room and authorize the caller against its parent workspace.
 * Returns { room, workspaceId } on success or a NextResponse on failure so the
 * caller can early-return without re-checking shape.
 *
 * By default this is owner-only (used for DELETE and any non-rename mutation).
 * Pass `allowMembers: true` to also admit any workspace member (any role,
 * including student) — used ONLY for the name-only rename path (Phase 10).
 * Destructive operations must NOT pass allowMembers.
 */
async function authorizeRoomMutation(
  request: NextRequest,
  roomId: string,
  options: { allowMembers?: boolean } = {}
): Promise<
  | { ok: true; room: Record<string, unknown>; workspaceId: string; userId: string }
  | { ok: false; response: NextResponse }
> {
  void request
  const supabase = supabaseServer()
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession()

  if (sessionError) {
    console.error('Session error:', sessionError)
    return { ok: false, response: NextResponse.json({ error: 'Failed to get session' }, { status: 500 }) }
  }
  const userId = session?.user?.id
  if (!userId) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const admin = supabaseServiceRole()
  const { data: room, error: roomError } = await admin
    .from('rooms')
    .select('*')
    .eq('id', roomId)
    .maybeSingle()
  if (roomError || !room) {
    return { ok: false, response: NextResponse.json({ error: 'Room not found' }, { status: 404 }) }
  }

  const workspaceId = room.workspace_id as string
  const { data: workspace } = await admin
    .from('workspaces')
    .select('owner_id')
    .eq('id', workspaceId)
    .maybeSingle()
  if (!workspace) {
    return { ok: false, response: NextResponse.json({ error: 'Parent workspace not found' }, { status: 404 }) }
  }

  let authorized = workspace.owner_id === userId
  if (!authorized && options.allowMembers) {
    // Any workspace member (any role) may rename. Membership is the boundary
    // for non-owners; true non-members still fall through to 403 below.
    const { data: membership } = await admin
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle()
    authorized = membership !== null
  }
  if (!authorized) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: options.allowMembers
            ? 'Only workspace members can rename rooms'
            : 'Only workspace owners can mutate rooms',
        },
        { status: 403 }
      ),
    }
  }

  return { ok: true, room, workspaceId, userId }
}

/**
 * PATCH /api/rooms/[id] — update one or more of:
 *   - name (rename)
 *   - displayOrder (reorder)
 *   - isPublished (publish toggle; flips published_at to now/null to match)
 *
 * Workspace owner only. Reads the current room first so we can write back only
 * the fields the caller actually provided (PATCH semantics).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json().catch(() => ({}))

    // A name-only rename is permitted for any workspace member (Phase 10).
    // Any other field (displayOrder, isPublished) stays owner-only, so we only
    // relax the gate when `name` is the sole field being changed.
    const wantsName = typeof body?.name === 'string'
    const wantsDisplayOrder = body?.displayOrder != null
    const wantsIsPublished = typeof body?.isPublished === 'boolean'
    const isNameOnlyRename = wantsName && !wantsDisplayOrder && !wantsIsPublished

    const auth = await authorizeRoomMutation(request, params.id, { allowMembers: isNameOnlyRename })
    if (!auth.ok) return auth.response
    const { room } = auth

    const updates: Record<string, unknown> = {}

    if (typeof body?.name === 'string') {
      const nameResult = validateName(body.name, { maxLength: 100, fieldLabel: 'Room name' })
      if (!nameResult.ok) {
        return NextResponse.json({ error: nameResult.error }, { status: 400 })
      }
      updates.name = nameResult.value
    }
    if (body?.displayOrder != null) {
      const n = Number(body.displayOrder)
      if (!Number.isFinite(n)) {
        return NextResponse.json({ error: 'displayOrder must be a number' }, { status: 400 })
      }
      updates.display_order = n
    }
    if (typeof body?.isPublished === 'boolean') {
      // Publishing to the network is an instructor-only action. Unpublishing is
      // always allowed (retracting content is never a privilege escalation).
      if (body.isPublished === true && !(await isInstructorAccount(auth.userId))) {
        return NextResponse.json(
          { error: 'Only instructors can publish rooms to the network.' },
          { status: 403 }
        )
      }
      updates.is_published = body.isPublished
      // Mirror published_at so timestamp metadata stays coherent with the flag.
      updates.published_at = body.isPublished ? new Date().toISOString() : null
    }

    const admin = supabaseServiceRole()

    if (Object.keys(updates).length > 0) {
      const { error: updateError } = await admin
        .from('rooms')
        .update(updates)
        .eq('id', params.id)
      if (updateError) {
        console.error('Error updating room:', updateError)
        return NextResponse.json({ error: 'Failed to update room' }, { status: 500 })
      }
    }

    const { data: updated } = await admin
      .from('rooms')
      .select('*')
      .eq('id', params.id)
      .single()

    return NextResponse.json({ room: updated ?? room })
  } catch (error) {
    console.error('Unexpected error in PATCH /api/rooms/[id]:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

/**
 * DELETE /api/rooms/[id] — workspace owner only.
 *
 * Boards in this room cascade-delete via the boards.room_id FK from migration
 * 014. We do NOT clean up the orphaned storage objects here this phase — the
 * existing board-delete code path (with storage cleanup) is the source of
 * truth for that, and a follow-up can wire room deletion through it. For now,
 * instructors deleting a room understand boards disappear; storage cost of
 * orphans is a known follow-up.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await authorizeRoomMutation(request, params.id)
    if (!auth.ok) return auth.response
    const { workspaceId } = auth

    const admin = supabaseServiceRole()

    // Don't let an instructor accidentally orphan a workspace by removing its
    // last room. The boards data path requires at least one room to exist.
    const { count: roomCount } = await admin
      .from('rooms')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
    if ((roomCount ?? 0) <= 1) {
      return NextResponse.json(
        { error: 'Cannot delete the only room in a workspace. Create another room first or delete the workspace itself.' },
        { status: 400 }
      )
    }

    const { error: deleteError } = await admin
      .from('rooms')
      .delete()
      .eq('id', params.id)
    if (deleteError) {
      console.error('Error deleting room:', deleteError)
      return NextResponse.json({ error: 'Failed to delete room' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Unexpected error in DELETE /api/rooms/[id]:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
