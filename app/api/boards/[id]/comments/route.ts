import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'
import { getDemoBoards, transformDemoBoard, DEMO_STUDIOS } from '@/lib/mockData'
import { getSampleComments } from '@/lib/sampleData'

export const dynamic = 'force-dynamic'

// GET /api/boards/[id]/comments - Get all comments for a board
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const boardId = params.id
    const searchParams = request.nextUrl.searchParams
    const isDemo = searchParams.get('demo') === 'true'

    // Check if this is a sample board (return sample comments)
    if (boardId.startsWith('sample-board-')) {
      const sampleComments = getSampleComments(boardId)
      console.log(`✅ [SAMPLE] Returning ${sampleComments.length} sample comments for board ${boardId}`)
      return NextResponse.json({ comments: sampleComments })
    }

    // Demo mode: return comments from mock data
    if (isDemo) {
      // Search through all demo studios to find the board
      let foundBoard = null
      for (const studio of DEMO_STUDIOS) {
        const boards = getDemoBoards(studio.id)
        const board = boards.find(b => b.id === boardId)
        if (board) {
          foundBoard = transformDemoBoard(board)
          break
        }
      }
      
      if (foundBoard && foundBoard.comments) {
        console.log(`✅ [DEMO MODE] Returning ${foundBoard.comments.length} comments for board ${boardId}`)
        return NextResponse.json({ comments: foundBoard.comments })
      }
      
      // If board not found, return empty comments
      return NextResponse.json({ comments: [] })
    }

    // Resolve board and workspace first so public studios work without requiring auth
    const serviceSupabase = supabaseServiceRole()
    const { data: board, error: boardErr } = await serviceSupabase
      .from('boards')
      .select('workspace_id')
      .eq('id', boardId)
      .single()

    if (boardErr || !board) {
      return NextResponse.json({ error: 'Board not found' }, { status: 404 })
    }

    const { data: workspace } = await serviceSupabase
      .from('workspaces')
      .select('is_public, published_at')
      .eq('id', board.workspace_id)
      .single()

    const isPublicWorkspace = workspace?.is_public && workspace?.published_at != null

    if (isPublicWorkspace) {
      // Public workspace: anyone can read comments (no auth required)
      const { data: publicComments, error: publicError } = await serviceSupabase
        .from('comments')
        .select('*')
        .eq('board_id', boardId)
        .order('created_at', { ascending: false })

      if (publicError) {
        console.error('Error fetching comments with service role:', publicError)
        return NextResponse.json({
          error: 'Failed to fetch comments',
          details: publicError.message,
        }, { status: 500 })
      }

      const transformedComments = (publicComments || []).map((c: any) => ({
        id: c.id,
        boardId: c.board_id,
        authorName: c.author_name,
        content: c.text,
        createdAt: c.created_at,
      }))
      console.log(`📖 [Comments API] GET (public) - Board ${boardId} has ${transformedComments.length} comments`)
      return NextResponse.json({ comments: transformedComments })
    }

    // Private workspace: use user session so RLS applies (members can read)
    const supabase = supabaseServer()
    const { data: comments, error } = await supabase
      .from('comments')
      .select('*')
      .eq('board_id', boardId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching comments (private workspace):', error)
      return NextResponse.json({
        error: 'Failed to fetch comments',
        details: error.message,
      }, { status: 500 })
    }

    const transformedComments = (comments || []).map((c: any) => ({
      id: c.id,
      boardId: c.board_id,
      authorName: c.author_name,
      content: c.text,
      createdAt: c.created_at,
    }))
    console.log(`📖 [Comments API] GET - Board ${boardId} has ${transformedComments.length} comments`)
    return NextResponse.json({ comments: transformedComments })
  } catch (error) {
    console.error('Error fetching comments:', error)
    return NextResponse.json({
      error: 'Failed to fetch comments',
      details: (error as Error).message,
    }, { status: 500 })
  }
}

// POST /api/boards/[id]/comments - Add a new comment to a board
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const boardId = params.id
    const searchParams = request.nextUrl.searchParams
    const isDemo = searchParams.get('demo') === 'true'
    const { content, authorName } = await request.json()

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return NextResponse.json({ error: 'Comment content is required' }, { status: 400 })
    }

    // Demo mode: return a mock comment (not persisted, just for demo)
    if (isDemo) {
      // Verify board exists in demo data
      let foundBoard = null
      for (const studio of DEMO_STUDIOS) {
        const boards = getDemoBoards(studio.id)
        const board = boards.find(b => b.id === boardId)
        if (board) {
          foundBoard = transformDemoBoard(board)
          break
        }
      }
      
      if (!foundBoard) {
        return NextResponse.json({ error: 'Board not found' }, { status: 404 })
      }

      // Create a mock comment response (not actually saved, but returned for demo)
      const mockComment = {
        id: `demo-comment-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        boardId: boardId,
        authorName: authorName || 'Demo User',
        content: content.trim(),
        createdAt: new Date().toISOString(),
        type: 'peer' as const
      }

      console.log(`💬 [DEMO MODE] Mock comment posted to board ${boardId}:`, mockComment)
      return NextResponse.json({ comment: mockComment, success: true })
    }

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

    // Verify board exists
    const { data: board, error: boardError } = await supabase
      .from('boards')
      .select('id')
      .eq('id', boardId)
      .single()

    if (boardError || !board) {
      return NextResponse.json({ error: 'Board not found' }, { status: 404 })
    }

    // Insert comment into Supabase
    const commentId = `comment-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const { data: newComment, error: insertError } = await supabase
      .from('comments')
      .insert({
        id: commentId,
        board_id: boardId,
        author_id: userId,
        author_name: authorName || 'Anonymous',
        text: content.trim(),
      })
      .select()
      .single()

    if (insertError) {
      console.error('Error creating comment:', insertError)
      return NextResponse.json({ 
        error: 'Failed to add comment', 
        details: insertError.message || insertError 
      }, { status: 500 })
    }

    // Transform to frontend format
    const comment = {
      id: newComment.id,
      boardId: newComment.board_id,
      authorName: newComment.author_name,
      content: newComment.text,
      createdAt: newComment.created_at,
    }

    console.log(`💬 [Comments API] POST - Added comment to board ${boardId}:`, comment)

    return NextResponse.json({ comment, success: true })
  } catch (error) {
    console.error('Error adding comment:', error)
    return NextResponse.json({ 
      error: 'Failed to add comment', 
      details: (error as Error).message 
    }, { status: 500 })
  }
}

