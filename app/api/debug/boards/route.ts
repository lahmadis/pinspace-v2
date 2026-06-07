import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'

const ADMIN_EMAILS = (process.env.PINSPACE_ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)

function isAdmin(email: string | undefined): boolean {
  if (!email) return false
  return ADMIN_EMAILS.includes(email.toLowerCase())
}

// Debug endpoint to inspect and fix board positions (admin-only)
export async function GET(request: NextRequest) {
  try {
    // SECURITY (audit pass 1): debug data-inspection/mutation tools — available
    // in local development only. 404 in any non-dev environment (the admin gate
    // below still applies in dev).
    if (process.env.NODE_ENV !== 'development') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const supabase = supabaseServer()
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession()

    if (sessionError || !session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!isAdmin(session.user.email)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
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
      console.error('Error fetching boards in debug endpoint:', error)
      return NextResponse.json({ error: 'Failed to fetch boards' }, { status: 500 })
    }

    // Group by wallIndex for easier inspection
    const boardsByWall: Record<string, Array<{ id: string; title: string; position_wall_index: number | null; position_x: string | null; position_y: string | null; position_side: string | null }>> = {}
    boards?.forEach(board => {
      const wallIndex = board.position_wall_index ?? 'null'
      const key = String(wallIndex)
      if (!boardsByWall[key]) {
        boardsByWall[key] = []
      }
      boardsByWall[key].push({
        id: board.id,
        title: board.title,
        position_wall_index: board.position_wall_index,
        position_x: board.position_x,
        position_y: board.position_y,
        position_side: board.position_side
      })
    })

    // Count by wall
    const counts: Record<string, number> = {}
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
  } catch (error) {
    console.error('Error in debug boards endpoint:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

// POST endpoint to update a board's wallIndex (admin-only)
export async function POST(request: NextRequest) {
  try {
    // SECURITY (audit pass 1): debug data-inspection/mutation tools — available
    // in local development only. 404 in any non-dev environment (the admin gate
    // below still applies in dev).
    if (process.env.NODE_ENV !== 'development') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const supabase = supabaseServer()
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession()

    if (sessionError || !session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!isAdmin(session.user.email)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { boardId, newWallIndex } = body

    if (!boardId || newWallIndex === undefined || newWallIndex === null) {
      return NextResponse.json({ error: 'boardId and newWallIndex are required' }, { status: 400 })
    }

    // Validate newWallIndex is a valid number
    const wallIndexNum = parseInt(String(newWallIndex), 10)
    if (isNaN(wallIndexNum)) {
      return NextResponse.json({ error: 'newWallIndex must be a valid number' }, { status: 400 })
    }

    // Update the board
    const { data: updatedBoard, error: updateError } = await supabase
      .from('boards')
      .update({ position_wall_index: wallIndexNum })
      .eq('id', boardId)
      .select()
      .single()

    if (updateError) {
      console.error('Error updating board in debug endpoint:', updateError)
      return NextResponse.json({ error: 'Failed to update board' }, { status: 500 })
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
  } catch (error) {
    console.error('Error updating board in debug endpoint:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
