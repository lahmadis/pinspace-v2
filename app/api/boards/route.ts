import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = supabaseServer()
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession()
    
    if (sessionError) {
      console.error('Session error:', sessionError)
      return NextResponse.json({ error: 'Failed to get session', details: sessionError }, { status: 500 })
    }
    
    const userId = session?.user?.id
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const searchParams = request.nextUrl.searchParams
    const workspaceId = searchParams.get('workspaceId') || searchParams.get('studioId') // Support both for backward compatibility

    if (!workspaceId) {
      return NextResponse.json({ error: 'workspaceId or studioId required' }, { status: 400 })
    }

    console.log('Fetching boards for workspace:', workspaceId)

    // Fetch boards from Supabase
    const { data: boards, error } = await supabase
      .from('boards')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('uploaded_at', { ascending: false })

    if (error) {
      console.error('Error fetching boards:', error)
      return NextResponse.json({ 
        error: 'Failed to fetch boards', 
        details: error.message || error 
      }, { status: 500 })
    }

    // Transform database format to frontend format
    const transformedBoards = (boards || []).map((board: any) => ({
      id: board.id,
      studioId: board.workspace_id, // Keep for backward compatibility
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
      } : undefined,
      ownerId: board.owner_id,
      ownerName: board.owner_name,
      ownerColor: board.owner_color,
      originalWidth: board.original_width,
      originalHeight: board.original_height,
      aspectRatio: board.aspect_ratio ? parseFloat(board.aspect_ratio) : undefined,
    }))

    console.log('Returning boards:', transformedBoards.length)
    return NextResponse.json({ boards: transformedBoards })
  }
  catch (error: any) {
    console.error('Unexpected error in GET /api/boards:', error)
    return NextResponse.json({ 
      error: 'Internal Server Error', 
      details: error?.message || String(error) 
    }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = supabaseServer()
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession()
    
    if (sessionError) {
      console.error('Session error:', sessionError)
      return NextResponse.json({ error: 'Failed to get session', details: sessionError }, { status: 500 })
    }
    
    const userId = session?.user?.id
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const board = await request.json()
    
    console.log('📥 [API] PUT request received for board:', board.id)
    console.log('📥 [API] Position data received:', JSON.stringify(board.position))
    
    // Validate required fields
    if (!board.id || (!board.studioId && !board.workspaceId)) {
      console.log('❌ [API] Missing required fields!')
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const workspaceId = board.workspaceId || board.studioId

    // Prepare update data for Supabase
    const updateData: any = {}
    
    if (board.position) {
      updateData.position_wall_index = board.position.wallIndex
      updateData.position_x = board.position.x.toString()
      updateData.position_y = board.position.y.toString()
      if (board.position.width !== undefined) updateData.position_width = board.position.width.toString()
      if (board.position.height !== undefined) updateData.position_height = board.position.height.toString()
    }
    
    if (board.title) updateData.title = board.title
    if (board.description !== undefined) updateData.description = board.description
    if (board.tags) updateData.tags = board.tags
    if (board.studentName) updateData.student_name = board.studentName
    if (board.studentEmail) updateData.student_email = board.studentEmail

    // Update board in Supabase
    const { data: updatedBoard, error } = await supabase
      .from('boards')
      .update(updateData)
      .eq('id', board.id)
      .eq('owner_id', userId) // Ensure user owns the board
      .select()
      .single()

    if (error) {
      console.error('❌ [API] Error updating board:', error)
      return NextResponse.json({ 
        error: 'Failed to update board', 
        details: error.message || error 
      }, { status: 500 })
    }

    if (!updatedBoard) {
      return NextResponse.json({ error: 'Board not found or unauthorized' }, { status: 404 })
    }

    console.log('✅ [API] Successfully updated board:', board.id)
    
    // Transform back to frontend format
    const transformedBoard = {
      id: updatedBoard.id,
      studioId: updatedBoard.workspace_id,
      workspaceId: updatedBoard.workspace_id,
      studentName: updatedBoard.student_name,
      studentEmail: updatedBoard.student_email,
      title: updatedBoard.title,
      description: updatedBoard.description,
      thumbnailUrl: updatedBoard.thumbnail_url,
      fullImageUrl: updatedBoard.full_image_url,
      tags: updatedBoard.tags || [],
      uploadedAt: updatedBoard.uploaded_at,
      position: (updatedBoard.position_wall_index !== null && updatedBoard.position_x !== null && updatedBoard.position_y !== null) ? {
        wallIndex: updatedBoard.position_wall_index,
        x: parseFloat(updatedBoard.position_x),
        y: parseFloat(updatedBoard.position_y),
        width: updatedBoard.position_width ? parseFloat(updatedBoard.position_width) : undefined,
        height: updatedBoard.position_height ? parseFloat(updatedBoard.position_height) : undefined,
      } : undefined,
      ownerId: updatedBoard.owner_id,
      ownerName: updatedBoard.owner_name,
      ownerColor: updatedBoard.owner_color,
    }

    return NextResponse.json({ success: true, board: transformedBoard })
  } catch (error: any) {
    console.error('❌ [API] Unexpected error updating board:', error)
    return NextResponse.json({ 
      error: 'Internal Server Error', 
      details: error?.message || String(error) 
    }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = supabaseServer()
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession()
    
    if (sessionError) {
      console.error('Session error:', sessionError)
      return NextResponse.json({ error: 'Failed to get session', details: sessionError }, { status: 500 })
    }
    
    const userId = session?.user?.id
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const searchParams = request.nextUrl.searchParams
    const boardId = searchParams.get('boardId')

    if (!boardId) {
      return NextResponse.json({ error: 'boardId required' }, { status: 400 })
    }

    // Delete board from Supabase (RLS will ensure user owns it)
    const { error } = await supabase
      .from('boards')
      .delete()
      .eq('id', boardId)
      .eq('owner_id', userId)

    if (error) {
      console.error('Error deleting board:', error)
      return NextResponse.json({ 
        error: 'Failed to delete board', 
        details: error.message || error 
      }, { status: 500 })
    }

    console.log('✅ [API] Board deleted:', boardId)
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Unexpected error deleting board:', error)
    return NextResponse.json({ 
      error: 'Internal Server Error', 
      details: error?.message || String(error) 
    }, { status: 500 })
  }
}