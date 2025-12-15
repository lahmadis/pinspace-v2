import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'

// Debug endpoint to inspect and fix board positions
export async function GET(request: NextRequest) {
  try {
    const supabase = supabaseServer()
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession()
    
    if (sessionError || !session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const searchParams = request.nextUrl.searchParams
    const workspaceId = searchParams.get('workspaceId') || searchParams.get('studioId')

    if (!workspaceId) {
      return NextResponse.json({ error: 'workspaceId or studioId required' }, { status: 400 })
    }

    // Fetch all boards with position data
    const { data: boards, error } = await supabase
      .from('boards')
      .select('id, title, position_wall_index, position_x, position_y, position_side')
      .eq('workspace_id', workspaceId)
      .order('position_wall_index', { ascending: true, nullsFirst: false })

    if (error) {
      return NextResponse.json({ 
        error: 'Failed to fetch boards', 
        details: error.message 
      }, { status: 500 })
    }

    // Group by wallIndex for easier inspection
    const boardsByWall: Record<number | string, any[]> = {}
    boards?.forEach(board => {
      const wallIndex = board.position_wall_index ?? 'null'
      if (!boardsByWall[wallIndex]) {
        boardsByWall[wallIndex] = []
      }
      boardsByWall[wallIndex].push({
        id: board.id,
        title: board.title,
        position_wall_index: board.position_wall_index,
        position_x: board.position_x,
        position_y: board.position_y,
        position_side: board.position_side
      })
    })

    // Count by wall
    const counts: Record<number | string, number> = {}
    Object.keys(boardsByWall).forEach(wallIndex => {
      counts[wallIndex] = boardsByWall[wallIndex].length
    })

    return NextResponse.json({
      summary: {
        totalBoards: boards?.length || 0,
        boardsByWall: counts,
        message: 'Use POST with boardId and newWallIndex to update a board'
      },
      boardsByWall,
      allBoards: boards
    })
  } catch (error: any) {
    console.error('Error in debug boards endpoint:', error)
    return NextResponse.json({ 
      error: 'Internal Server Error', 
      details: error?.message || String(error) 
    }, { status: 500 })
  }
}

// POST endpoint to update a board's wallIndex
export async function POST(request: NextRequest) {
  try {
    const supabase = supabaseServer()
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession()
    
    if (sessionError || !session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { boardId, newWallIndex } = body

    if (!boardId || newWallIndex === undefined || newWallIndex === null) {
      return NextResponse.json({ 
        error: 'boardId and newWallIndex are required' 
      }, { status: 400 })
    }

    // Validate newWallIndex is a valid number
    const wallIndexNum = parseInt(String(newWallIndex), 10)
    if (isNaN(wallIndexNum)) {
      return NextResponse.json({ 
        error: 'newWallIndex must be a valid number' 
      }, { status: 400 })
    }

    // Update the board
    const { data: updatedBoard, error: updateError } = await supabase
      .from('boards')
      .update({ position_wall_index: wallIndexNum })
      .eq('id', boardId)
      .select()
      .single()

    if (updateError) {
      return NextResponse.json({ 
        error: 'Failed to update board', 
        details: updateError.message 
      }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      message: `Board ${boardId} updated to wall ${wallIndexNum}`,
      board: {
        id: updatedBoard.id,
        title: updatedBoard.title,
        position_wall_index: updatedBoard.position_wall_index
      }
    })
  } catch (error: any) {
    console.error('Error updating board in debug endpoint:', error)
    return NextResponse.json({ 
      error: 'Internal Server Error', 
      details: error?.message || String(error) 
    }, { status: 500 })
  }
}

