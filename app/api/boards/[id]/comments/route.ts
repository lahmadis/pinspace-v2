import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'
import { getDemoBoards, transformDemoBoard, DEMO_STUDIOS } from '@/lib/mockData'
import { getSampleComments } from '@/lib/sampleData'
import { isSuperadmin } from '@/lib/auth/superadmin'

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
        return NextResponse.json({ comments: foundBoard.comments })
      }

      // If board not found, return empty comments
      return NextResponse.json({ comments: [] })
    }

    // Resolve board → room → workspace so public studios work without requiring auth.
    // Phase 6.1 walks via boards.room_id → rooms.workspace_id; falls back to
    // boards.workspace_id when room_id is null (defensive — the migration
    // backfilled all rows, so this shouldn't happen in practice).
    const serviceSupabase = supabaseServiceRole()
    const { data: board, error: boardErr } = await serviceSupabase
      .from('boards')
      .select('workspace_id, room_id')
      .eq('id', boardId)
      .single()

    if (boardErr || !board) {
      return NextResponse.json({ error: 'Board not found' }, { status: 404 })
    }

    let resolvedWorkspaceId = board.workspace_id as string | null
    if (board.room_id) {
      const { data: room } = await serviceSupabase
        .from('rooms')
        .select('workspace_id')
        .eq('id', board.room_id)
        .maybeSingle()
      if (room?.workspace_id) resolvedWorkspaceId = room.workspace_id as string
    }
    if (!resolvedWorkspaceId) {
      return NextResponse.json({ error: 'Board has no workspace' }, { status: 404 })
    }

    const { data: workspace } = await serviceSupabase
      .from('workspaces')
      .select('owner_id')
      .eq('id', resolvedWorkspaceId)
      .single()

    // Phase A.3.2: comments are PRIVATE to the room's workspace — there is no
    // public read path (matching board-comments GET). Require a session, then
    // authorize as workspace owner OR member OR superadmin; everyone else gets
    // 403. We return 403 (not 401) for the no-session case so a logged-out
    // visitor of a board whose IMAGE they can legitimately see is not bounced
    // into a login flow just because the comment layer is hidden.
    const supabase = supabaseServer()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    const userId = session?.user?.id
    if (!userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    let allowed = workspace?.owner_id === userId
    if (!allowed) {
      const { data: membership } = await serviceSupabase
        .from('workspace_members')
        .select('user_id')
        .eq('workspace_id', resolvedWorkspaceId)
        .eq('user_id', userId)
        .maybeSingle()
      allowed = membership != null
    }
    if (!allowed) {
      allowed = await isSuperadmin(userId, serviceSupabase)
    }
    if (!allowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: comments, error } = await serviceSupabase
      .from('comments')
      .select('*')
      .eq('board_id', boardId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching comments (private workspace):', error)
      return NextResponse.json({ error: 'Failed to fetch comments' }, { status: 500 })
    }

    const transformedComments = (comments || []).map((c) => ({
      id: c.id,
      boardId: c.board_id,
      authorId: c.author_id,
      authorName: c.author_name,
      content: c.text,
      createdAt: c.created_at,
    }))
    return NextResponse.json({ comments: transformedComments })
  } catch (error) {
    console.error('Error fetching comments:', error)
    return NextResponse.json({ error: 'Failed to fetch comments' }, { status: 500 })
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
        authorId: null,
        authorName: authorName || 'Demo User',
        content: content.trim(),
        createdAt: new Date().toISOString(),
        type: 'peer' as const
      }

      return NextResponse.json({ comment: mockComment, success: true })
    }

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

    // Resolve board → room → workspace with service role; enforce access explicitly.
    const admin = supabaseServiceRole()
    const { data: board, error: boardError } = await admin
      .from('boards')
      .select('id, workspace_id, room_id')
      .eq('id', boardId)
      .single()

    if (boardError || !board) {
      return NextResponse.json({ error: 'Board not found' }, { status: 404 })
    }

    let resolvedWorkspaceId = board.workspace_id as string | null
    if (board.room_id) {
      const { data: room } = await admin
        .from('rooms')
        .select('workspace_id')
        .eq('id', board.room_id)
        .maybeSingle()
      if (room?.workspace_id) resolvedWorkspaceId = room.workspace_id as string
    }
    if (!resolvedWorkspaceId) {
      return NextResponse.json({ error: 'Board has no workspace' }, { status: 404 })
    }

    // Phase A.3.2: writes require session + owner OR member OR superadmin —
    // no public short-circuit (matching the GET gate).
    const { data: workspace } = await admin
      .from('workspaces')
      .select('owner_id')
      .eq('id', resolvedWorkspaceId)
      .single()

    let canWrite = workspace?.owner_id === userId
    if (!canWrite) {
      const { data: membership } = await admin
        .from('workspace_members')
        .select('user_id')
        .eq('workspace_id', resolvedWorkspaceId)
        .eq('user_id', userId)
        .maybeSingle()
      canWrite = membership != null
    }
    if (!canWrite) {
      canWrite = await isSuperadmin(userId, admin)
    }
    if (!canWrite) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Insert comment with service role after explicit authorization.
    const commentId = `comment-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const { data: newComment, error: insertError } = await admin
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
      return NextResponse.json({ error: 'Failed to add comment' }, { status: 500 })
    }

    // Transform to frontend format
    const comment = {
      id: newComment.id,
      boardId: newComment.board_id,
      authorId: newComment.author_id,
      authorName: newComment.author_name,
      content: newComment.text,
      createdAt: newComment.created_at,
    }

    return NextResponse.json({ comment, success: true })
  } catch (error) {
    console.error('Error adding comment:', error)
    return NextResponse.json({ error: 'Failed to add comment' }, { status: 500 })
  }
}

// PATCH /api/boards/[id]/comments - Edit an existing comment
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const boardId = params.id
    const searchParams = request.nextUrl.searchParams
    const isDemo = searchParams.get('demo') === 'true'
    const { commentId, content } = await request.json()

    if (!commentId || typeof commentId !== 'string') {
      return NextResponse.json({ error: 'commentId is required' }, { status: 400 })
    }
    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return NextResponse.json({ error: 'Comment content is required' }, { status: 400 })
    }
    if (isDemo) {
      return NextResponse.json({ error: 'Editing comments is not available in demo mode' }, { status: 400 })
    }

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

    const { data: updatedComment, error: updateError } = await supabase
      .from('comments')
      .update({ text: content.trim() })
      .eq('id', commentId)
      .eq('board_id', boardId)
      .eq('author_id', userId)
      .select()
      .single()

    if (updateError || !updatedComment) {
      return NextResponse.json({ error: 'Comment not found or not editable by this user' }, { status: 404 })
    }

    const comment = {
      id: updatedComment.id,
      boardId: updatedComment.board_id,
      authorId: updatedComment.author_id,
      authorName: updatedComment.author_name,
      content: updatedComment.text,
      createdAt: updatedComment.created_at,
    }

    return NextResponse.json({ comment, success: true })
  } catch (error) {
    console.error('Error editing comment:', error)
    return NextResponse.json({ error: 'Failed to edit comment' }, { status: 500 })
  }
}

// DELETE /api/boards/[id]/comments - Delete an existing comment
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const boardId = params.id
    const searchParams = request.nextUrl.searchParams
    const isDemo = searchParams.get('demo') === 'true'
    const body = await request.json().catch(() => ({}))
    const commentId = body?.commentId

    if (!commentId || typeof commentId !== 'string') {
      return NextResponse.json({ error: 'commentId is required' }, { status: 400 })
    }
    if (isDemo) {
      return NextResponse.json({ error: 'Deleting comments is not available in demo mode' }, { status: 400 })
    }

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

    const { data: deletedComments, error: deleteError } = await supabase
      .from('comments')
      .delete()
      .eq('id', commentId)
      .eq('board_id', boardId)
      .eq('author_id', userId)
      .select('id')

    if (deleteError) {
      console.error('Error deleting comment:', deleteError)
      return NextResponse.json({ error: 'Failed to delete comment' }, { status: 500 })
    }
    if (!deletedComments || deletedComments.length === 0) {
      return NextResponse.json({ error: 'Comment not found or not deletable by this user' }, { status: 404 })
    }

    return NextResponse.json({ success: true, commentId })
  } catch (error) {
    console.error('Error deleting comment:', error)
    return NextResponse.json({ error: 'Failed to delete comment' }, { status: 500 })
  }
}
