import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = await supabaseServer()
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

    // Fetch all boards owned by the user
    const { data: boards, error } = await supabase
      .from('boards')
      .select('*')
      .eq('owner_id', userId)
      .order('uploaded_at', { ascending: false })

    if (error) {
      console.error('Error fetching user boards:', error)
      return NextResponse.json({ error: 'Failed to fetch boards' }, { status: 500 })
    }

    // Transform to frontend format
    const transformedBoards = (boards || []).map((board) => ({
      id: board.id,
      studioId: board.workspace_id,
      workspaceId: board.workspace_id,
      studentName: board.student_name,
      studentEmail: board.student_email,
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
    }))

    return NextResponse.json({ boards: transformedBoards })
  } catch (error) {
    console.error('Error fetching boards:', error)
    return NextResponse.json({ error: 'Failed to fetch boards' }, { status: 500 })
  }
}
