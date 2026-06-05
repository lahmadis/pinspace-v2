import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'
import { resolveGuestToken, getGuestTokenFromRequest } from '@/lib/auth/guestToken'

export const dynamic = 'force-dynamic'

// Critique layer: edit / resolve / delete an anchored board comment.
//
//   PATCH  body      -> author only (session author OR guest matching guest_token_id)
//   PATCH  resolved  -> workspace owner OR author (guests: their own only)
//   DELETE           -> author OR workspace owner (guests: their own only)
//
// A guest is identified by X-Guest-Token; they may act only on rows whose
// guest_token_id matches their token. All access checks are in app code via the
// service-role client (table is service-role-only, no RLS policies).

interface BoardCommentRow {
  id: string
  board_id: string
  room_id: string
  parent_id: string | null
  anchor_x: number | null
  anchor_y: number | null
  body: string
  author_id: string | null
  guest_token_id: string | null
  author_name: string
  resolved: boolean
  created_at: string
  updated_at: string
}

function transformRow(c: BoardCommentRow) {
  return {
    id: c.id,
    boardId: c.board_id,
    roomId: c.room_id,
    parentId: c.parent_id,
    anchorX: c.anchor_x,
    anchorY: c.anchor_y,
    body: c.body,
    authorId: c.author_id,
    guestTokenId: c.guest_token_id,
    authorName: c.author_name,
    resolved: c.resolved,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  }
}

// Resolve the workspace owner for a comment's board (walks room_id → workspace,
// falling back to boards.workspace_id) so we can authorize owner-level actions.
async function resolveWorkspaceOwnerId(
  admin: ReturnType<typeof supabaseServiceRole>,
  boardId: string
): Promise<string | null> {
  const { data: board } = await admin
    .from('boards')
    .select('workspace_id, room_id')
    .eq('id', boardId)
    .maybeSingle()
  if (!board) return null

  let workspaceId = board.workspace_id as string | null
  if (board.room_id) {
    const { data: room } = await admin
      .from('rooms')
      .select('workspace_id')
      .eq('id', board.room_id)
      .maybeSingle()
    if (room?.workspace_id) workspaceId = room.workspace_id as string
  }
  if (!workspaceId) return null

  const { data: workspace } = await admin
    .from('workspaces')
    .select('owner_id')
    .eq('id', workspaceId)
    .maybeSingle()
  return (workspace?.owner_id as string | null) ?? null
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { commentId: string } }
) {
  try {
    const commentId = params.commentId
    const { body, resolved } = await request.json()

    const wantsBodyEdit = body !== undefined
    const wantsResolveToggle = resolved !== undefined

    if (!wantsBodyEdit && !wantsResolveToggle) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }
    if (wantsBodyEdit && (typeof body !== 'string' || body.trim().length === 0)) {
      return NextResponse.json({ error: 'Comment body is required' }, { status: 400 })
    }
    if (wantsResolveToggle && typeof resolved !== 'boolean') {
      return NextResponse.json({ error: 'resolved must be a boolean' }, { status: 400 })
    }

    const guestToken = getGuestTokenFromRequest(request)
    const admin = supabaseServiceRole()
    const { data: comment, error: fetchError } = await admin
      .from('board_comments')
      .select('id, board_id, author_id, guest_token_id')
      .eq('id', commentId)
      .maybeSingle()

    if (fetchError || !comment) {
      return NextResponse.json({ error: 'Comment not found' }, { status: 404 })
    }

    // Identity: guest (own row only) OR session (author / workspace owner).
    let isAuthor = false
    let isWorkspaceOwner = false
    if (guestToken) {
      const guest = await resolveGuestToken(guestToken)
      if (!guest) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      isAuthor = comment.guest_token_id != null && comment.guest_token_id === guest.tokenId
    } else {
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
      isAuthor = comment.author_id != null && comment.author_id === userId
      const workspaceOwnerId = await resolveWorkspaceOwnerId(admin, comment.board_id as string)
      isWorkspaceOwner = workspaceOwnerId != null && workspaceOwnerId === userId
    }

    // Per-field authorization: body edit is author-only; resolve is owner-or-author.
    if (wantsBodyEdit && !isAuthor) {
      return NextResponse.json({ error: 'Only the author can edit this comment' }, { status: 403 })
    }
    if (wantsResolveToggle && !isAuthor && !isWorkspaceOwner) {
      return NextResponse.json(
        { error: 'Only the author or workspace owner can resolve this comment' },
        { status: 403 }
      )
    }

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (wantsBodyEdit) updateData.body = body.trim()
    if (wantsResolveToggle) updateData.resolved = resolved

    const { data: updated, error: updateError } = await admin
      .from('board_comments')
      .update(updateData)
      .eq('id', commentId)
      .select()
      .single()

    if (updateError || !updated) {
      console.error('Error updating board comment:', updateError)
      return NextResponse.json({ error: 'Failed to update comment' }, { status: 500 })
    }

    return NextResponse.json({
      comment: transformRow(updated as BoardCommentRow),
      success: true,
    })
  } catch (error) {
    console.error('Error editing board comment:', error)
    return NextResponse.json({ error: 'Failed to edit comment' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { commentId: string } }
) {
  try {
    const commentId = params.commentId

    const guestToken = getGuestTokenFromRequest(request)
    const admin = supabaseServiceRole()
    const { data: comment, error: fetchError } = await admin
      .from('board_comments')
      .select('id, board_id, author_id, guest_token_id')
      .eq('id', commentId)
      .maybeSingle()

    if (fetchError || !comment) {
      return NextResponse.json({ error: 'Comment not found' }, { status: 404 })
    }

    let allowed = false
    if (guestToken) {
      const guest = await resolveGuestToken(guestToken)
      if (!guest) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      allowed = comment.guest_token_id != null && comment.guest_token_id === guest.tokenId
    } else {
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
      const isAuthor = comment.author_id != null && comment.author_id === userId
      const workspaceOwnerId = await resolveWorkspaceOwnerId(admin, comment.board_id as string)
      const isWorkspaceOwner = workspaceOwnerId != null && workspaceOwnerId === userId
      allowed = isAuthor || isWorkspaceOwner
    }

    if (!allowed) {
      return NextResponse.json(
        { error: 'Not authorized to delete this comment' },
        { status: 403 }
      )
    }

    // ON DELETE CASCADE on parent_id removes any replies to this comment.
    const { error: deleteError } = await admin
      .from('board_comments')
      .delete()
      .eq('id', commentId)

    if (deleteError) {
      console.error('Error deleting board comment:', deleteError)
      return NextResponse.json({ error: 'Failed to delete comment' }, { status: 500 })
    }

    return NextResponse.json({ success: true, commentId })
  } catch (error) {
    console.error('Error deleting board comment:', error)
    return NextResponse.json({ error: 'Failed to delete comment' }, { status: 500 })
  }
}
