import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'
import { isSuperadmin } from '@/lib/auth/superadmin'
import { validateName } from '@/lib/validation/safeName'
import {
  collectBoardStoragePaths,
  type BoardObjectRow,
  unreferencedBoardStoragePaths,
} from '@/lib/storage/boardObjects'

// Room wall color — the two supported values, mirrored by the DB CHECK
// constraint (migration 031). Shared by the validation below.
const WALL_COLORS = ['grey', 'white'] as const
type WallColor = (typeof WALL_COLORS)[number]

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
 * Pass `allowSuperadmin: true` to also admit a platform superadmin (an
 * owner-equivalent for that field) — used for the wall-color path so an admin
 * can adjust it. Never passed for DELETE.
 */
async function authorizeRoomMutation(
  request: NextRequest,
  roomId: string,
  options: { allowMembers?: boolean; allowSuperadmin?: boolean } = {}
): Promise<
  | { ok: true; room: Record<string, unknown>; workspace: Record<string, unknown>; workspaceId: string; userId: string }
  | { ok: false; response: NextResponse }
> {
  void request
  const supabase = await supabaseServer()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user?.id) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  const userId = user.id

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
    .select('owner_id, type, organization_id')
    .eq('id', workspaceId)
    .maybeSingle()
  if (!workspace) {
    return { ok: false, response: NextResponse.json({ error: 'Parent workspace not found' }, { status: 404 }) }
  }

  let authorized = workspace.owner_id === userId
  if (!authorized && options.allowSuperadmin) {
    // Platform superadmin acts as an owner-equivalent for the permitted field.
    authorized = await isSuperadmin(userId, admin)
  }
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

  return { ok: true, room, workspace, workspaceId, userId }
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
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const body = await request.json().catch(() => ({}))

    // A name-only rename is permitted for any workspace member (Phase 10).
    // Any other field (displayOrder, isPublished) stays owner-only, so we only
    // relax the gate when `name` is the sole field being changed.
    const wantsName = typeof body?.name === 'string'
    const wantsDisplayOrder = body?.displayOrder != null
    const wantsIsPublished = typeof body?.isPublished === 'boolean'
    // Wall color accepts the camelCase `wallColor` body key (matching this
    // route's other keys); the snake_case `wall_color` alias is tolerated too.
    const wallColorRaw =
      typeof body?.wallColor === 'string'
        ? body.wallColor
        : typeof body?.wall_color === 'string'
          ? body.wall_color
          : null
    const wantsWallColor = wallColorRaw != null
    const isNameOnlyRename = wantsName && !wantsDisplayOrder && !wantsIsPublished && !wantsWallColor

    // Wall color is owner-OR-superadmin (never plain members). isNameOnlyRename
    // is false whenever wall color is present, so the member relaxation can't
    // leak to it.
    const auth = await authorizeRoomMutation(request, id, {
      allowMembers: isNameOnlyRename,
      allowSuperadmin: wantsWallColor,
    })
    if (!auth.ok) return auth.response
    const { room, workspace } = auth
    const admin = supabaseServiceRole()

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
      if (body.isPublished === true) {
        const { data: profile } = await admin
          .from('user_profiles')
          .select('account_role, organization_id')
          .eq('user_id', auth.userId)
          .maybeSingle()
        if (
          workspace.type !== 'class'
          || !workspace.organization_id
          || profile?.account_role !== 'instructor'
          || profile.organization_id !== workspace.organization_id
        ) {
          return NextResponse.json(
            { error: 'Only verified instructors can publish classes in their organization.' },
            { status: 403 }
          )
        }
      }
      updates.is_published = body.isPublished
      // Mirror published_at so timestamp metadata stays coherent with the flag.
      updates.published_at = body.isPublished ? new Date().toISOString() : null
    }
    if (wantsWallColor) {
      const wc = String(wallColorRaw).trim().toLowerCase()
      if (!WALL_COLORS.includes(wc as WallColor)) {
        return NextResponse.json(
          { error: "wall_color must be 'grey' or 'white'" },
          { status: 400 }
        )
      }
      updates.wall_color = wc
    }

    if (Object.keys(updates).length > 0) {
      const { error: updateError } = await admin
        .from('rooms')
        .update(updates)
        .eq('id', id)
      if (updateError) {
        console.error('Error updating room:', updateError)
        return NextResponse.json({ error: 'Failed to update room' }, { status: 500 })
      }
    }

    const { data: updated } = await admin
      .from('rooms')
      .select('*')
      .eq('id', id)
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
 * 014. Their storage objects are inventoried before the cascade and removed
 * only after a post-delete service-role scan proves no surviving board refers
 * to them. Query/removal failure leaks an object rather than risking data loss.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const auth = await authorizeRoomMutation(request, id)
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

    const roomBoards: BoardObjectRow[] = []
    const inventoryPageSize = 1000
    for (let from = 0; ; from += inventoryPageSize) {
      const { data, error } = await admin
        .from('boards')
        .select('thumbnail_url, full_image_url')
        .eq('room_id', id)
        .range(from, from + inventoryPageSize - 1)
      if (error) {
        console.error('Failed to inventory room board objects:', error)
        return NextResponse.json({ error: 'Failed to prepare room deletion' }, { status: 500 })
      }
      const page = (data ?? []) as BoardObjectRow[]
      roomBoards.push(...page)
      if (page.length < inventoryPageSize) break
    }
    const candidatePaths = collectBoardStoragePaths(roomBoards)

    const { error: deleteError } = await admin
      .from('rooms')
      .delete()
      .eq('id', id)
    if (deleteError) {
      console.error('Error deleting room:', deleteError)
      return NextResponse.json({ error: 'Failed to delete room' }, { status: 500 })
    }

    if (candidatePaths.size > 0) {
      const remainingBoards: BoardObjectRow[] = []
      const pageSize = 1000
      let referenceScanFailed = false
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await admin
          .from('boards')
          .select('thumbnail_url, full_image_url')
          .range(from, from + pageSize - 1)
        if (error) {
          console.error('Failed to verify room object references; skipping cleanup:', error)
          referenceScanFailed = true
          break
        }
        const page = (data ?? []) as BoardObjectRow[]
        remainingBoards.push(...page)
        if (page.length < pageSize) break
      }

      if (!referenceScanFailed) {
        const unreferencedPaths = unreferencedBoardStoragePaths(candidatePaths, remainingBoards)
        if (unreferencedPaths.length > 0) {
          try {
            const { error: storageError } = await admin.storage.from('board-images').remove(unreferencedPaths)
            if (storageError) {
              console.error('Failed to remove unreferenced room board objects:', storageError)
            }
          } catch (storageError) {
            console.error('Room board object cleanup threw after successful deletion:', storageError)
          }
        }
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Unexpected error in DELETE /api/rooms/[id]:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
