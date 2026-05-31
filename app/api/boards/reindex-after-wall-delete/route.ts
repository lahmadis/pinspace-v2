import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'

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
 */
export async function PATCH(request: NextRequest) {
  try {
    const supabase = supabaseServer()
    const { data: { session }, error: sessionError } = await supabase.auth.getSession()
    if (sessionError || !session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = session.user.id

    const body = await request.json().catch(() => ({}))
    const { roomId, deletedWallIndex } = body as { roomId?: string; deletedWallIndex?: number }

    if (typeof roomId !== 'string' || !roomId) {
      return NextResponse.json({ error: 'roomId required' }, { status: 400 })
    }
    if (typeof deletedWallIndex !== 'number' || !Number.isInteger(deletedWallIndex) || deletedWallIndex < 0) {
      return NextResponse.json({ error: 'deletedWallIndex must be a non-negative integer' }, { status: 400 })
    }

    const admin = supabaseServiceRole()

    // Auth: caller must own or be a member of the room's workspace. We look up
    // the workspace via the room id (room id is the canonical scope post Phase 6.x).
    const { data: room } = await admin
      .from('rooms')
      .select('workspace_id')
      .eq('id', roomId)
      .maybeSingle()
    if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 })

    const { data: ws } = await admin
      .from('workspaces')
      .select('owner_id')
      .eq('id', room.workspace_id)
      .maybeSingle()
    if (!ws) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

    if (ws.owner_id !== userId) {
      const { data: m } = await admin
        .from('workspace_members')
        .select('user_id')
        .eq('workspace_id', room.workspace_id)
        .eq('user_id', userId)
        .maybeSingle()
      if (!m) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // (a) Delete boards pinned to the wall the user is removing. Storage
    // objects (full_image_url, thumbnail_url) are intentionally left in
    // place — orphan-image cleanup is parked. We delete rows only.
    const { data: deletedRows, error: deleteErr } = await admin
      .from('boards')
      .delete()
      .eq('room_id', roomId)
      .eq('position_wall_index', deletedWallIndex)
      .select('id')
    if (deleteErr) {
      console.error('reindex DELETE failed', deleteErr)
      return NextResponse.json({ error: 'Failed to delete boards on wall' }, { status: 500 })
    }
    const deleted = deletedRows?.length ?? 0

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
      return NextResponse.json({ error: 'Failed to read boards', deleted }, { status: 500 })
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
          { error: 'Partial update failed', deleted, updated },
          { status: 500 }
        )
      }
      updated += 1
    }

    return NextResponse.json({ success: true, deleted, updated })
  } catch (err) {
    console.error('reindex-after-wall-delete uncaught', err)
    return NextResponse.json(
      { error: 'Failed to reindex boards', message: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
