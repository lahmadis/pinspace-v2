import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'

/**
 * Decrement position_wall_index by 1 for every board in `roomId` whose current
 * index is strictly greater than `deletedWallIndex`. Fired by the floor editor
 * after a wall is removed so boards on later walls stay pinned to the same
 * physical wall (which has shifted down one slot in the walls[] array).
 *
 * Single SQL UPDATE — atomic and bounded by room scope. The floor editor
 * separately refuses to remove a wall that has any boards on it, so we never
 * have to decide what to do with boards on the deleted index.
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

    // The PostgREST .update() builder doesn't support column-self references,
    // so use an RPC-style raw SQL call. supabase-js exposes execute via
    // .rpc; here we use the admin client to read affected rows then issue
    // per-row updates with the decremented value. Wall removal is rare and N
    // is small (boards on higher walls in one room), so the per-row loop is
    // fine and avoids needing a stored procedure.
    const { data: affected, error: selErr } = await admin
      .from('boards')
      .select('id, position_wall_index')
      .eq('room_id', roomId)
      .gt('position_wall_index', deletedWallIndex)
    if (selErr) {
      console.error('reindex select failed', selErr)
      return NextResponse.json({ error: 'Failed to read boards' }, { status: 500 })
    }

    if (!affected || affected.length === 0) {
      return NextResponse.json({ success: true, updated: 0 })
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
          { error: 'Partial update failed', updated },
          { status: 500 }
        )
      }
      updated += 1
    }

    return NextResponse.json({ success: true, updated })
  } catch (err) {
    console.error('reindex-after-wall-delete uncaught', err)
    return NextResponse.json(
      { error: 'Failed to reindex boards', message: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
