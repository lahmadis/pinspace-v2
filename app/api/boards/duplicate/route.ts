import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'
import { resolveMainRoomId } from '@/lib/rooms'

/**
 * POST /api/boards/duplicate
 * Body: { boardId, workspaceId, wallIndex, position_x, position_y, position_side?, position_width?, position_height? }
 * Creates a new board with the same image and metadata as the source, at the given position (same workspace).
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = supabaseServer()
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession()

    if (sessionError) {
      console.error('Session error:', sessionError)
      return NextResponse.json({ error: 'Failed to get session' }, { status: 500 })
    }

    const userId = session?.user?.id
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const {
      boardId,
      workspaceId,
      wallIndex,
      position_x,
      position_y,
      position_side = 'front',
      position_width,
      position_height,
    } = body as {
      boardId: string
      workspaceId: string
      wallIndex: number
      position_x: number
      position_y: number
      position_side?: 'front' | 'back'
      position_width?: number
      position_height?: number
    }

    if (!boardId || workspaceId == null || wallIndex == null || position_x == null || position_y == null) {
      return NextResponse.json(
        { error: 'Missing required fields: boardId, workspaceId, wallIndex, position_x, position_y' },
        { status: 400 }
      )
    }

    const { data: source, error: fetchError } = await supabase
      .from('boards')
      .select('*')
      .eq('id', boardId)
      .single()

    if (fetchError || !source) {
      return NextResponse.json({ error: 'Board not found' }, { status: 404 })
    }

    if (source.workspace_id !== workspaceId) {
      return NextResponse.json({ error: 'Board is not in the specified workspace' }, { status: 400 })
    }

    const { data: workspace } = await supabase
      .from('workspaces')
      .select('owner_id')
      .eq('id', workspaceId)
      .single()

    const isWorkspaceOwner = workspace?.owner_id === userId
    const { data: membership } = await supabase
      .from('workspace_members')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .single()

    const canDuplicate = source.owner_id === userId || isWorkspaceOwner || membership
    if (!canDuplicate) {
      return NextResponse.json({ error: 'Not authorized to duplicate this board' }, { status: 403 })
    }

    const timestamp = Date.now()
    const newId = `board-${timestamp}`
    const ownerName = session?.user?.user_metadata?.full_name ?? session?.user?.user_metadata?.email?.split('@')[0] ?? 'User'

    // Mirror Phase 6.1 boards.room_id alongside workspace_id. Reuse the source
    // board's room_id when present (so duplicates land in the same room as the
    // original); otherwise resolve the workspace's Main Room.
    const adminForRoomLookup = supabaseServiceRole()
    const sourceRoomId = (source as { room_id?: string | null }).room_id ?? null
    const resolvedRoomId = sourceRoomId ?? (await resolveMainRoomId(adminForRoomLookup, workspaceId))

    const insertData = {
      id: newId,
      workspace_id: workspaceId,
      room_id: resolvedRoomId,
      owner_id: userId,
      owner_name: ownerName,
      owner_color: source.owner_color ?? undefined,
      student_name: source.student_name,
      student_email: source.student_email ?? null,
      title: (source.title || 'Board').trimEnd() + ' (copy)',
      description: source.description ?? null,
      thumbnail_url: source.thumbnail_url,
      full_image_url: source.full_image_url,
      tags: source.tags ?? [],
      uploaded_at: new Date().toISOString(),
      position_wall_index: wallIndex,
      position_x: Number(position_x),
      position_y: Number(position_y),
      position_width: position_width != null ? Number(position_width) : source.position_width,
      position_height: position_height != null ? Number(position_height) : source.position_height,
      position_side: position_side === 'back' ? 'back' : 'front',
      original_width: source.original_width,
      original_height: source.original_height,
      aspect_ratio: source.aspect_ratio,
      physical_width: source.physical_width,
      physical_height: source.physical_height,
      board_width_in: source.board_width_in,
      board_height_in: source.board_height_in,
    }

    const admin = supabaseServiceRole()
    const { data: saved, error: insertError } = await admin
      .from('boards')
      .insert(insertData)
      .select()
      .single()

    if (insertError) {
      console.error('Duplicate board insert error:', insertError)
      return NextResponse.json({ error: 'Failed to duplicate board' }, { status: 500 })
    }

    const board = {
      id: saved.id,
      studioId: saved.workspace_id,
      workspaceId: saved.workspace_id,
      studentName: saved.student_name,
      studentEmail: saved.student_email,
      title: saved.title,
      description: saved.description,
      thumbnailUrl: saved.thumbnail_url,
      fullImageUrl: saved.full_image_url,
      tags: saved.tags ?? [],
      uploadedAt: saved.uploaded_at,
      position: {
        wallIndex: saved.position_wall_index,
        x: parseFloat(saved.position_x),
        y: parseFloat(saved.position_y),
        width: saved.position_width != null ? parseFloat(saved.position_width) : undefined,
        height: saved.position_height != null ? parseFloat(saved.position_height) : undefined,
        side: (saved.position_side as 'front' | 'back') || 'front',
      },
      ownerId: saved.owner_id,
      ownerName: saved.owner_name,
      ownerColor: saved.owner_color,
      originalWidth: saved.original_width,
      originalHeight: saved.original_height,
      aspectRatio: saved.aspect_ratio != null ? parseFloat(saved.aspect_ratio) : undefined,
      physicalWidth: saved.physical_width,
      physicalHeight: saved.physical_height,
      boardWidthIn: saved.board_width_in != null ? Number(saved.board_width_in) : undefined,
      boardHeightIn: saved.board_height_in != null ? Number(saved.board_height_in) : undefined,
    }

    return NextResponse.json({ success: true, board })
  } catch (error) {
    console.error('Duplicate board error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
