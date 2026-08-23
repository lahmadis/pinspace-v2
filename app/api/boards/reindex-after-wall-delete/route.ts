import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'
import { isSuperadmin } from '@/lib/auth/superadmin'

/**
 * Two-phase reconciliation after the floor editor pops a wall:
 *   (a) DELETE every board row whose position_wall_index === deletedWallIndex.
 *       The floor editor surfaces a confirm modal listing the board count
 *       before calling here, so by the time we run we have explicit consent.
 *   (b) Decrement position_wall_index by 1 for boards on higher walls so they
 *       stay pinned to the correct physical wall after the splice.
 *
 * Empty wall → (a) deletes nothing and the endpoint behaves like a pure
 * re-index. Storage image cleanup is parked (orphans get swept by the
 * separate cleanup-orphan-storage script); we delete rows only here.
 *
 * Callers MUST send `expectedBoardCount` — the board count they showed the user
 * before asking for confirmation. We re-count live and 409 on mismatch, so a
 * client working from a stale board list can never delete boards the user was
 * never told about. Access is owner / superadmin / instructor-member, matching
 * the `canDeleteWalls` gate on the Remove-wall control.
 */
export async function PATCH(request: NextRequest) {
  // Declared outside the try so the catch-all below can still report whether
  // anything was committed. Without it an unexpected throw after the delete
  // would fall through to a generic 500 and the client would tell the user
  // nothing changed, while their boards were already gone.
  let mutated = false
  try {
    const supabase = supabaseServer()
    const { data: { session }, error: sessionError } = await supabase.auth.getSession()
    if (sessionError || !session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = session.user.id

    const body = await request.json().catch(() => ({}))
    const { roomId, deletedWallIndex, expectedBoardCount } = body as {
      roomId?: string
      deletedWallIndex?: number
      expectedBoardCount?: number
    }

    if (typeof roomId !== 'string' || !roomId) {
      return NextResponse.json({ error: 'roomId required' }, { status: 400 })
    }
    if (typeof deletedWallIndex !== 'number' || !Number.isInteger(deletedWallIndex) || deletedWallIndex < 0) {
      return NextResponse.json({ error: 'deletedWallIndex must be a non-negative integer' }, { status: 400 })
    }

    const admin = supabaseServiceRole()

    // Auth: OWNER, SUPERADMIN, or an INSTRUCTOR member of the room's workspace.
    // This deliberately mirrors `canDeleteWalls` in app/studio/[id]/page.tsx —
    // it used to accept any member, which was strictly broader than the UI gate
    // that hides the Remove-wall control. Since this endpoint DELETES every
    // board on the wall, a student member could bypass the hidden button by
    // calling it directly. The client gate is UX; this is the boundary.
    const { data: room } = await admin
      .from('rooms')
      .select('workspace_id')
      .eq('id', roomId)
      .maybeSingle()
    if (!room) return NextResponse.json({ error: 'Space not found' }, { status: 404 })

    const { data: ws } = await admin
      .from('workspaces')
      .select('owner_id')
      .eq('id', room.workspace_id)
      .maybeSingle()
    if (!ws) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

    if (ws.owner_id !== userId) {
      const { data: m } = await admin
        .from('workspace_members')
        .select('role')
        .eq('workspace_id', room.workspace_id)
        .eq('user_id', userId)
        .maybeSingle()
      const isInstructorMember = m?.role === 'instructor'
      if (!isInstructorMember && !(await isSuperadmin(userId, admin))) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    // Consent check. `expectedBoardCount` is what the caller was shown in the
    // confirm modal. That count is computed from the client's local board list,
    // which goes stale the moment anyone else pins a board to this wall — and a
    // stale zero skips the modal entirely, so the boards below would be deleted
    // without the user ever being told they existed. Counting live here and
    // refusing on mismatch is what makes the displayed number binding.
    //
    // Omitted (legacy caller) → no consent to verify, so refuse rather than
    // assume. Count query error → refuse: we cannot prove what we are deleting.
    if (typeof expectedBoardCount !== 'number' || !Number.isInteger(expectedBoardCount) || expectedBoardCount < 0) {
      return NextResponse.json(
        { error: 'expectedBoardCount must be a non-negative integer' },
        { status: 400 }
      )
    }
    // Capture the actual ids, not just a count. The delete below targets THIS
    // id set rather than re-running the predicate, so a board pinned to this
    // wall between the check and the delete is left alone instead of being
    // destroyed uncounted. It also makes the verified set and the deleted set
    // the same rows by construction.
    const { data: liveRows, error: countErr } = await admin
      .from('boards')
      .select('id')
      .eq('room_id', roomId)
      .eq('position_wall_index', deletedWallIndex)
    if (countErr) {
      console.error('reindex board count failed; refusing delete', { roomId, deletedWallIndex }, countErr)
      return NextResponse.json({ error: 'Could not verify what is on this wall' }, { status: 500 })
    }
    const liveBoardIds = (liveRows ?? []).map((r) => r.id as string)
    if (liveBoardIds.length !== expectedBoardCount) {
      return NextResponse.json(
        {
          error: 'Wall contents changed',
          liveBoardCount: liveBoardIds.length,
          expectedBoardCount,
        },
        { status: 409 }
      )
    }

    // (a) Delete boards pinned to the wall the user is removing. Storage
    // objects (full_image_url, thumbnail_url) are intentionally left in
    // place — orphan-image cleanup is parked. We delete rows only.
    let deleted = 0
    if (liveBoardIds.length > 0) {
      const { data: deletedRows, error: deleteErr } = await admin
        .from('boards')
        .delete()
        .in('id', liveBoardIds)
        .select('id')
      if (deleteErr) {
        console.error('reindex DELETE failed', deleteErr)
        return NextResponse.json({ error: 'Failed to delete boards on wall' }, { status: 500 })
      }
      deleted = deletedRows?.length ?? 0
      if (deleted > 0) mutated = true
    }

    // (b) Decrement higher walls' boards. PostgREST .update() doesn't support
    // column-self references, so we read the affected rows and update them
    // per-row. Wall removal is rare and N is small (boards on higher walls
    // in one room), so the per-row loop is fine and avoids needing a
    // stored procedure.
    const { data: affected, error: selErr } = await admin
      .from('boards')
      .select('id, position_wall_index')
      .eq('room_id', roomId)
      .gt('position_wall_index', deletedWallIndex)
    if (selErr) {
      console.error('reindex select failed', selErr)
      // `partial` tells the client whether the phrase "no changes made" is
      // still true. The delete above already committed, so once `deleted > 0`
      // it is not, and saying so would send the user looking for boards that
      // are gone.
      return NextResponse.json(
        { error: 'Failed to read boards', deleted, partial: deleted > 0 },
        { status: 500 }
      )
    }

    if (!affected || affected.length === 0) {
      return NextResponse.json({ success: true, deleted, updated: 0 })
    }

    let updated = 0
    for (const row of affected) {
      const current = Number(row.position_wall_index)
      if (!Number.isFinite(current)) continue
      const { error: updErr } = await admin
        .from('boards')
        .update({ position_wall_index: current - 1 })
        .eq('id', row.id as string)
      if (updErr) {
        console.error('reindex per-row update failed', { id: row.id, updErr })
        return NextResponse.json(
          { error: 'Partial update failed', deleted, updated, partial: deleted > 0 || updated > 0 },
          { status: 500 }
        )
      }
      updated += 1
      mutated = true
    }

    return NextResponse.json({ success: true, deleted, updated })
  } catch (err) {
    console.error('reindex-after-wall-delete uncaught', err)
    return NextResponse.json(
      {
        error: 'Failed to reindex boards',
        message: err instanceof Error ? err.message : String(err),
        partial: mutated,
      },
      { status: 500 }
    )
  }
}
