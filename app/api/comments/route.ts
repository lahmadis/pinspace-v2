import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
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

    const { boardId, authorName, authorEmail, content, type } = await request.json()

    if (!boardId || !authorName || !content) {
      return NextResponse.json({ error: 'Missing required fields (boardId, authorName, content)' }, { status: 400 })
    }

    // Insert comment into Supabase
    const commentId = `comment-${Date.now()}`
    const { data: newComment, error: insertError } = await supabase
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
      authorEmail: newComment.author_email || '',
      content: newComment.text,
      type: type || 'review', // Note: type is not stored in DB, but we return it for compatibility
      createdAt: newComment.created_at,
    }

    console.log('✅ Comment created:', commentId)
    return NextResponse.json({ success: true, comment })
  } catch (error) {
    console.error('Comment error:', error)
    return NextResponse.json({ error: 'Failed to add comment', details: (error as Error).message }, { status: 500 })
  }
}

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
    const boardId = searchParams.get('boardId')

    if (!boardId) {
      return NextResponse.json({ error: 'boardId required' }, { status: 400 })
    }

    // Fetch comments from Supabase
    const { data: comments, error } = await supabase
      .from('comments')
      .select('*')
      .eq('board_id', boardId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching comments:', error)
      return NextResponse.json({ 
        error: 'Failed to fetch comments', 
        details: error.message || error 
      }, { status: 500 })
    }

    // Transform to frontend format
    const transformedComments = (comments || []).map((c: any) => ({
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
    return NextResponse.json({ error: 'Failed to fetch comments', details: (error as Error).message }, { status: 500 })
  }
}