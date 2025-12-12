import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'

// GET /api/boards/[id]/comments - Get all comments for a board
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const boardId = params.id

    // Try with regular client first (RLS policies should handle public boards)
    const supabase = supabaseServer()
    
    // Fetch comments from Supabase
    let { data: comments, error } = await supabase
      .from('comments')
      .select('*')
      .eq('board_id', boardId)
      .order('created_at', { ascending: false })

    // If that fails, check if board is in a public workspace and use service role
    if (error) {
      console.log('Initial fetch failed, checking if board is in public workspace:', error.message)
      
      const serviceSupabase = supabaseServiceRole()
      
      // Check if board exists and is in a public workspace
      const { data: board } = await serviceSupabase
        .from('boards')
        .select('workspace_id')
        .eq('id', boardId)
        .single()

      if (!board) {
        return NextResponse.json({ error: 'Board not found' }, { status: 404 })
      }

      const { data: workspace } = await serviceSupabase
        .from('workspaces')
        .select('is_public, published_at')
        .eq('id', board.workspace_id)
        .single()

      const isPublicWorkspace = workspace?.is_public && workspace?.published_at !== null

      // If it's a public workspace, use service role to fetch comments
      if (isPublicWorkspace) {
        const { data: publicComments, error: publicError } = await serviceSupabase
          .from('comments')
          .select('*')
          .eq('board_id', boardId)
          .order('created_at', { ascending: false })

        if (publicError) {
          console.error('Error fetching comments with service role:', publicError)
          return NextResponse.json({ 
            error: 'Failed to fetch comments', 
            details: publicError.message 
          }, { status: 500 })
        }

        const transformedComments = (publicComments || []).map((c: any) => ({
          id: c.id,
          boardId: c.board_id,
          authorName: c.author_name,
          content: c.text,
          createdAt: c.created_at,
        }))

        return NextResponse.json({ comments: transformedComments })
      }
      
      // Not a public workspace and initial fetch failed
      console.error('Error fetching comments:', error)
      return NextResponse.json({ 
        error: 'Failed to fetch comments', 
        details: error.message 
      }, { status: 500 })
    }

    // Transform to frontend format
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
      details: (error as Error).message 
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
    const { content, authorName } = await request.json()

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return NextResponse.json({ error: 'Comment content is required' }, { status: 400 })
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

