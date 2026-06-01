import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'

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

    const { boardId, authorName, authorEmail, content, type } = await request.json()

    if (!boardId || !authorName || !content) {
      return NextResponse.json({ error: 'Missing required fields (boardId, authorName, content)' }, { status: 400 })
    }

    // Resolve board → room → workspace and enforce access, then insert via service role.
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

    const { data: workspace } = await admin
      .from('workspaces')
      .select('owner_id, is_public, published_at')
      .eq('id', resolvedWorkspaceId)
      .single()

    const isPublicWorkspace = workspace?.is_public && workspace?.published_at != null
    if (!isPublicWorkspace) {
      const isOwner = workspace?.owner_id === userId
      const { data: membership } = await admin
        .from('workspace_members')
        .select('user_id')
        .eq('workspace_id', resolvedWorkspaceId)
        .eq('user_id', userId)
        .maybeSingle()

      if (!isOwner && !membership) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    // Insert comment into Supabase
    const commentId = `comment-${Date.now()}`
    const { data: newComment, error: insertError } = await admin
      .from('comments')
      .insert({
        id: commentId,
        board_id: boardId,
        author_id: userId,
        author_name: authorName,
        author_email: authorEmail || null,
        text: content,
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
      authorName: newComment.author_name,
      authorEmail: newComment.author_email || '',
      content: newComment.text,
      type: type || 'review', // Note: type is not stored in DB, but we return it for compatibility
      createdAt: newComment.created_at,
    }

    return NextResponse.json({ success: true, comment })
  } catch (error) {
    console.error('Comment error:', error)
    return NextResponse.json({ error: 'Failed to add comment' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const boardId = searchParams.get('boardId')

    if (!boardId) {
      return NextResponse.json({ error: 'boardId required' }, { status: 400 })
    }

    // Use service role for GET so public workspace viewers can read comments without auth
    const db = supabaseServiceRole()

    // Fetch comments from Supabase
    const { data: comments, error } = await db
      .from('comments')
      .select('*')
      .eq('board_id', boardId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching comments:', error)
      return NextResponse.json({ error: 'Failed to fetch comments' }, { status: 500 })
    }

    // Transform to frontend format
    const transformedComments = (comments || []).map((c) => ({
      id: c.id,
      boardId: c.board_id,
      authorName: c.author_name,
      authorEmail: c.author_email || '',
      content: c.text,
      type: 'review', // Default type for compatibility
      createdAt: c.created_at,
    }))

    return NextResponse.json({ comments: transformedComments })
  } catch (error) {
    console.error('Error fetching comments:', error)
    return NextResponse.json({ error: 'Failed to fetch comments' }, { status: 500 })
  }
}
