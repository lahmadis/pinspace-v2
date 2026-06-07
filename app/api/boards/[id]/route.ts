import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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

    const boardId = params.id

    // Fetch board from Supabase
    const { data: board, error } = await supabase
      .from('boards')
      .select('*')
      .eq('id', boardId)
      .single()

    if (error) {
      console.error('Error fetching board:', error)
      return NextResponse.json({ error: 'Failed to fetch board' }, { status: 500 })
    }

    if (!board) {
      return NextResponse.json({ error: 'Board not found' }, { status: 404 })
    }

    // SECURITY (audit pass 1): student_email is private — expose it only to the
    // workspace owner or a member, matching the list serializer's "unmasked only
    // for owner/member" rule. The board itself is read via RLS above (which also
    // admits org/public viewers), so without this an org member or a public-board
    // viewer would receive the student's email. Owner/member is resolved via the
    // service role (RLS has no membership SELECT on workspaces).
    const accessDb = supabaseServiceRole()
    const { data: ws } = await accessDb
      .from('workspaces')
      .select('owner_id')
      .eq('id', board.workspace_id)
      .maybeSingle()
    let isOwnerOrMember = ws?.owner_id === userId
    if (!isOwnerOrMember) {
      const { data: membership } = await accessDb
        .from('workspace_members')
        .select('user_id')
        .eq('workspace_id', board.workspace_id)
        .eq('user_id', userId)
        .maybeSingle()
      isOwnerOrMember = membership != null
    }

    // Transform to frontend format
    const transformedBoard = {
      id: board.id,
      studioId: board.workspace_id, // Keep for backward compatibility
      workspaceId: board.workspace_id,
      studentName: board.student_name,
      studentEmail: isOwnerOrMember ? board.student_email : undefined,
      title: board.title,
      description: board.description,
      thumbnailUrl: board.thumbnail_url,
      fullImageUrl: board.full_image_url,
      tags: board.tags || [],
      uploadedAt: board.uploaded_at,
      position: (board.position_wall_index !== null && board.position_x !== null && board.position_y !== null) ? {
        wallIndex: board.position_wall_index,
        x: parseFloat(board.position_x),
        y: parseFloat(board.position_y),
        width: board.position_width ? parseFloat(board.position_width) : undefined,
        height: board.position_height ? parseFloat(board.position_height) : undefined,
        side: board.position_side || 'front',
      } : undefined,
      ownerId: board.owner_id,
      ownerName: board.owner_name,
      ownerColor: board.owner_color,
      originalWidth: board.original_width,
      originalHeight: board.original_height,
      aspectRatio: board.aspect_ratio ? parseFloat(board.aspect_ratio) : undefined,
      physicalWidth: board.physical_width ? parseFloat(board.physical_width) : undefined,
      physicalHeight: board.physical_height ? parseFloat(board.physical_height) : undefined,
      boardWidthIn: board.board_width_in != null ? Number(board.board_width_in) : undefined,
      boardHeightIn: board.board_height_in != null ? Number(board.board_height_in) : undefined,
      linkUrl: board.link_url ?? undefined,
    }

    return NextResponse.json({ board: transformedBoard })
  } catch (error) {
    console.error('Unexpected error fetching board:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
