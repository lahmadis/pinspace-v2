import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = supabaseServer()
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession()

    if (sessionError || !session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const boardId = params.id
    const { wallIndex, x, y, width, height, side, rotation } = await request.json()

    if (wallIndex === undefined || x === undefined || y === undefined) {
      return NextResponse.json({ error: 'Missing position data' }, { status: 400 })
    }
    if (rotation !== undefined && (typeof rotation !== 'number' || !Number.isFinite(rotation))) {
      return NextResponse.json({ error: 'rotation must be a finite number' }, { status: 400 })
    }

    const admin = supabaseServiceRole()

    // Verify user has access to this board's workspace
    const { data: board } = await admin
      .from('boards')
      .select('workspace_id, owner_id')
      .eq('id', boardId)
      .single()

    if (!board) {
      return NextResponse.json({ error: 'Board not found' }, { status: 404 })
    }

    const { data: workspace } = await admin
      .from('workspaces')
      .select('owner_id')
      .eq('id', board.workspace_id)
      .single()

    const isWorkspaceOwner = workspace?.owner_id === userId
    const { data: membership } = await admin
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', board.workspace_id)
      .eq('user_id', userId)
      .maybeSingle()

    if (board.owner_id !== userId && !isWorkspaceOwner && !membership) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const updateData: Record<string, unknown> = {
      position_wall_index: wallIndex,
      position_x: x.toString(),
      position_y: y.toString(),
      position_side: side === 'back' ? 'back' : 'front',
    }
    if (width !== undefined) updateData.position_width = width.toString()
    if (height !== undefined) updateData.position_height = height.toString()
    // Optional. Existing callers that don't send rotation continue to work — the column has a NOT NULL DEFAULT 0.
    if (rotation !== undefined) updateData.position_rotation = rotation

    const { data: updated, error: updateError } = await admin
      .from('boards')
      .update(updateData)
      .eq('id', boardId)
      .select()
      .single()

    if (updateError || !updated) {
      console.error('Error updating board position:', updateError)
      return NextResponse.json({ error: 'Failed to update position' }, { status: 500 })
    }

    return NextResponse.json({ success: true, board: updated })
  } catch (error) {
    console.error('Error updating position:', error)
    return NextResponse.json({ error: 'Failed to update position' }, { status: 500 })
  }
}
