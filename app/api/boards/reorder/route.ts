import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/server'
import { isSuperadmin } from '@/lib/auth/superadmin'
import { getVerifiedUser } from '@/lib/auth/requireAdmin'

/**
 * POST /api/boards/reorder — move one board to a 1-based slot in its room's
 * lightbox slideshow, renumbering the whole room 1..N.
 *
 * Body: { roomId, boardId, targetPosition }
 *
 * Auth mirrors the mechanics of the boards PATCH route (app/api/boards/[id]:
 * getVerifiedUser + supabaseServiceRole + isSuperadmin, check enforced in app
 * code, no new RLS policies) but with a deliberately NARROWER rule: the
 * workspace owner or a platform superadmin only. A board's uploader, and an
 * ordinary member, are denied — reordering rewrites every row in the room, so
 * it is a room-wide act, not a per-board edit.
 *
 * "Room owner" collapses into "workspace owner" here: `rooms` has no owner_id
 * column (migrations/014_add_rooms_table.sql), so a room's owner IS the owner of
 * the workspace it belongs to.
 */
export async function POST(request: NextRequest) {
  try {
    // getUser(), not getSession(): this route ends in a service-role write, so
    // the identity behind it is re-verified against GoTrue rather than read off
    // an unverified cookie claim.
    const caller = await getVerifiedUser()
    if (!caller) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = caller.userId

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const { roomId, boardId, targetPosition } = body as {
      roomId?: unknown
      boardId?: unknown
      targetPosition?: unknown
    }

    if (typeof roomId !== 'string' || !roomId.trim()) {
      return NextResponse.json({ error: 'roomId is required' }, { status: 400 })
    }
    if (typeof boardId !== 'string' || !boardId.trim()) {
      return NextResponse.json({ error: 'boardId is required' }, { status: 400 })
    }
    // Positive integer only. Number.isInteger rejects 1.5/NaN/Infinity, and the
    // typeof guard rejects "3" — a numeric string would otherwise slip through
    // and splice at a fractional/garbage index.
    if (typeof targetPosition !== 'number' || !Number.isInteger(targetPosition) || targetPosition < 1) {
      return NextResponse.json(
        { error: 'targetPosition must be a positive integer' },
        { status: 400 }
      )
    }

    const admin = supabaseServiceRole()

    const { data: room, error: roomErr } = await admin
      .from('rooms')
      .select('id, workspace_id')
      .eq('id', roomId)
      .maybeSingle()

    if (roomErr) {
      console.error('Error loading room for reorder:', roomId, roomErr)
      return NextResponse.json({ error: 'Failed to load space' }, { status: 500 })
    }
    if (!room) {
      return NextResponse.json({ error: 'Space not found' }, { status: 404 })
    }

    const { data: workspace, error: workspaceErr } = await admin
      .from('workspaces')
      .select('owner_id')
      .eq('id', room.workspace_id)
      .maybeSingle()

    // A swallowed failure here reads as "not the owner" and would deny a
    // reorder the caller is entitled to, so it is a 500 rather than a silent 403.
    if (workspaceErr) {
      console.error('Error loading workspace for reorder:', room.workspace_id, workspaceErr)
      return NextResponse.json({ error: 'Failed to verify access' }, { status: 500 })
    }

    let authorized = workspace?.owner_id === userId
    if (!authorized) {
      authorized = await isSuperadmin(userId, admin)
    }
    if (!authorized) {
      return NextResponse.json({ error: 'Not authorized to reorder this space' }, { status: 403 })
    }

    // Current ordering — the same key the client sorts on (lib/boardOrder.ts):
    // sort_order ascending with nulls last, then upload time, then id.
    const { data: rows, error: listErr } = await admin
      .from('boards')
      .select('id')
      .eq('room_id', roomId)
      .neq('upload_status', 'pending')
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('uploaded_at', { ascending: true })
      .order('id', { ascending: true })

    if (listErr) {
      console.error('Error listing boards for reorder:', roomId, listErr)
      return NextResponse.json({ error: 'Failed to load boards' }, { status: 500 })
    }

    const ids = (rows || []).map((r) => r.id as string)
    if (!ids.includes(boardId)) {
      return NextResponse.json({ error: 'Board not found in this space' }, { status: 404 })
    }

    // Splice: pull the board out, clamp the target into 1..N of the REMAINING
    // list plus one (so N is always reachable), then reinsert.
    const without = ids.filter((id) => id !== boardId)
    const clamped = Math.min(Math.max(targetPosition, 1), without.length + 1)
    without.splice(clamped - 1, 0, boardId)

    // One statement for the whole room — unnest WITH ORDINALITY joined on id.
    // See migrations/035_board_sort_order.sql.
    const { error: writeErr } = await admin.rpc('reorder_room_boards', {
      p_room_id: roomId,
      p_ids: without,
    })

    if (writeErr) {
      console.error('Error writing reordered boards:', roomId, writeErr)
      return NextResponse.json({ error: 'Failed to reorder boards' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      ordering: without.map((id, i) => ({ id, sortOrder: i + 1 })),
    })
  } catch (error) {
    console.error('Unexpected error reordering boards:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
