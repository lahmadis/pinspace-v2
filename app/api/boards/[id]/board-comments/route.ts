import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'
import { isSuperadmin, isNetworkPublished } from '@/lib/auth/superadmin'

export const dynamic = 'force-dynamic'

// Phase A.1 critique layer: anchored, threaded board comments.
//
// Auth gate mirrors app/api/boards/[id]/comments/route.ts exactly:
//   resolve board → room → workspace, then
//   public-published OR superadmin(network-published) OR owner OR member.
// All reads/writes go through the service-role client after explicit app-code
// checks (no new RLS policies — table is service-role-only).

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

// GET /api/boards/[id]/board-comments — all anchored comments for the board, created_at asc.
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const boardId = params.id

    // Resolve board → room → workspace with the service role (mirrors comments GET).
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
      .select('owner_id, is_public, published_at')
      .eq('id', resolvedWorkspaceId)
      .single()

    const isPublicWorkspace = workspace?.is_public && workspace?.published_at != null

    if (!isPublicWorkspace) {
      // Private workspace: enforce access in app code, then read with service role.
      const supabase = supabaseServer()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const userId = session?.user?.id
      if (!userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const superadminViewer = await isSuperadmin(userId, serviceSupabase)
      const networkPublished =
        superadminViewer &&
        (await isNetworkPublished(serviceSupabase, {
          roomId: board.room_id,
          workspaceId: resolvedWorkspaceId,
        }))

      if (!(superadminViewer && networkPublished)) {
        const isOwner = workspace?.owner_id === userId
        if (!isOwner) {
          const { data: membership } = await serviceSupabase
            .from('workspace_members')
            .select('user_id')
            .eq('workspace_id', resolvedWorkspaceId)
            .eq('user_id', userId)
            .maybeSingle()
          if (!membership) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
          }
        }
      }
    }

    const { data: comments, error } = await serviceSupabase
      .from('board_comments')
      .select('*')
      .eq('board_id', boardId)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('Error fetching board comments:', error)
      return NextResponse.json({ error: 'Failed to fetch board comments' }, { status: 500 })
    }

    return NextResponse.json({
      comments: (comments || []).map((c) => transformRow(c as BoardCommentRow)),
    })
  } catch (error) {
    console.error('Error fetching board comments:', error)
    return NextResponse.json({ error: 'Failed to fetch board comments' }, { status: 500 })
  }
}

// POST /api/boards/[id]/board-comments — create a root pin (anchored) or a reply.
//
// Phase A.1: session required (author_id = session uid, author_name from profile).
// Root pin: anchorX + anchorY required (0..1), parentId omitted.
// Reply: parentId required (must belong to this board), anchors forced null.
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const boardId = params.id
    const { anchorX, anchorY, body, parentId } = await request.json()

    if (!body || typeof body !== 'string' || body.trim().length === 0) {
      return NextResponse.json({ error: 'Comment body is required' }, { status: 400 })
    }

    const hasParent = parentId !== undefined && parentId !== null
    if (!hasParent) {
      // Root pin: anchors required and within 0..1.
      const validAnchor = (v: unknown): v is number =>
        typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1
      if (!validAnchor(anchorX) || !validAnchor(anchorY)) {
        return NextResponse.json(
          { error: 'A root comment requires anchorX and anchorY between 0 and 1' },
          { status: 400 }
        )
      }
    } else if (typeof parentId !== 'string') {
      return NextResponse.json({ error: 'parentId must be a string' }, { status: 400 })
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

    // Resolve board → room → workspace; enforce the write gate (mirrors comments POST).
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
    // board_comments.room_id is NOT NULL — require a resolved room for the insert.
    const roomId = board.room_id as string | null
    if (!roomId) {
      return NextResponse.json({ error: 'Board has no room' }, { status: 404 })
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

    // Reply: the parent must exist and belong to THIS board.
    if (hasParent) {
      const { data: parent } = await admin
        .from('board_comments')
        .select('id, board_id')
        .eq('id', parentId)
        .maybeSingle()
      if (!parent || parent.board_id !== boardId) {
        return NextResponse.json(
          { error: 'Parent comment not found on this board' },
          { status: 400 }
        )
      }
    }

    // author_name from profile (mirrors POST /api/boards).
    const { data: userProfile } = await admin
      .from('user_profiles')
      .select('full_name')
      .eq('user_id', userId)
      .maybeSingle()
    const profileName = userProfile?.full_name?.trim() || null
    const authorName = profileName || session.user.email?.split('@')[0] || 'Anonymous'

    const commentId = `bc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    const { data: inserted, error: insertError } = await admin
      .from('board_comments')
      .insert({
        id: commentId,
        board_id: boardId,
        room_id: roomId,
        parent_id: hasParent ? parentId : null,
        anchor_x: hasParent ? null : anchorX,
        anchor_y: hasParent ? null : anchorY,
        body: body.trim(),
        author_id: userId,
        author_name: authorName,
      })
      .select()
      .single()

    if (insertError || !inserted) {
      console.error('Error creating board comment:', insertError)
      return NextResponse.json({ error: 'Failed to add board comment' }, { status: 500 })
    }

    return NextResponse.json({
      comment: transformRow(inserted as BoardCommentRow),
      success: true,
    })
  } catch (error) {
    console.error('Error adding board comment:', error)
    return NextResponse.json({ error: 'Failed to add board comment' }, { status: 500 })
  }
}
