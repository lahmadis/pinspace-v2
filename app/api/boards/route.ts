import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'
import { getDemoBoards, transformDemoBoard } from '@/lib/mockData'
import { getSampleBoards } from '@/lib/sampleData'
import { resolveMainRoomId } from '@/lib/rooms'

// No static caching — boards change frequently (uploads, position updates)
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const isDemo = searchParams.get('demo') === 'true'
    const roomIdParam = searchParams.get('roomId')
    const workspaceId = searchParams.get('workspaceId') || searchParams.get('studioId') // Support both for backward compatibility

    if (!roomIdParam && !workspaceId) {
      return NextResponse.json({ error: 'roomId, workspaceId, or studioId required' }, { status: 400 })
    }

    // Demo mode: return mock data (still keyed by workspace/studio id; demo boards aren't rooms-layered)
    if (isDemo) {
      const demoKey = workspaceId ?? roomIdParam ?? ''
      const demoBoards = getDemoBoards(demoKey)
      const transformedBoards = demoBoards.map(transformDemoBoard)
      return NextResponse.json({ boards: transformedBoards })
    }

    // Check if this is a sample studio (return sample boards)
    if (workspaceId?.startsWith('sample-studio-')) {
      const sampleBoards = getSampleBoards(workspaceId)
      return NextResponse.json({ boards: sampleBoards })
    }

    // Resolve the (room, workspace) pair we'll filter by. Two entry shapes:
    //   - roomId given: look up room → workspace_id, scope auth to that workspace
    //   - workspaceId given: scope auth to that workspace, resolve its Main Room for the boards filter
    const adminDb = supabaseServiceRole()
    let scopedWorkspaceId: string | null = null
    let scopedRoomId: string | null = null

    if (roomIdParam) {
      const { data: room } = await adminDb
        .from('rooms')
        .select('id, workspace_id')
        .eq('id', roomIdParam)
        .maybeSingle()
      if (room) {
        scopedWorkspaceId = room.workspace_id as string
        scopedRoomId = room.id as string
      } else {
        // Phase 6.2 backward-compat: an old URL like /studio/{workspace_id}
        // still funnels here as `roomId`. If it's actually a workspace, resolve
        // its first room and let the studio page detect the mismatch (room.id
        // !== requested id) to issue a router.replace and update the URL.
        const { data: ws } = await adminDb
          .from('workspaces')
          .select('id')
          .eq('id', roomIdParam)
          .maybeSingle()
        if (!ws) {
          return NextResponse.json({ error: 'Room not found' }, { status: 404 })
        }
        scopedWorkspaceId = ws.id as string
        scopedRoomId = await resolveMainRoomId(adminDb, ws.id as string)
      }
    } else if (workspaceId) {
      scopedWorkspaceId = workspaceId
      scopedRoomId = await resolveMainRoomId(adminDb, workspaceId)
    }

    if (!scopedWorkspaceId) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    // Normal mode: use Supabase
    // For public workspaces, we should allow unauthenticated access
    const supabase = supabaseServer()

    // Check if this workspace is public (allow unauthenticated access for public workspaces)
    const { data: workspace, error: workspaceError } = await supabase
      .from('workspaces')
      .select('is_public')
      .eq('id', scopedWorkspaceId)
      .single()

    // If workspace doesn't exist, require authentication (might be a private workspace)
    const isPublicWorkspace = workspace && !workspaceError && workspace.is_public === true

    // Only require authentication for private workspaces or if workspace doesn't exist
    if (!isPublicWorkspace) {
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

      // Verify the user is the workspace owner or a member
      const { data: ws } = await adminDb
        .from('workspaces')
        .select('owner_id')
        .eq('id', scopedWorkspaceId)
        .single()

      if (!ws) {
        return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
      }

      if (ws.owner_id !== userId) {
        const { data: membership } = await adminDb
          .from('workspace_members')
          .select('user_id')
          .eq('workspace_id', scopedWorkspaceId)
          .eq('user_id', userId)
          .maybeSingle()

        if (!membership) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }
      }
    }

    // Fetch boards with service role after explicit access checks above.
    // Filter by room_id when we resolved one (Phase 6.1 data path); fall back to
    // workspace_id when this workspace has no Main Room yet (legacy/edge case).
    let boardsQuery = adminDb
      .from('boards')
      .select('*')
      .neq('upload_status', 'pending')
      .order('uploaded_at', { ascending: false })

    if (scopedRoomId) {
      boardsQuery = boardsQuery.eq('room_id', scopedRoomId)
    } else {
      console.warn(
        '[/api/boards GET] No Main Room resolved for workspace',
        scopedWorkspaceId,
        '— falling back to workspace_id filter.'
      )
      boardsQuery = boardsQuery.eq('workspace_id', scopedWorkspaceId)
    }

    const { data: boards, error } = await boardsQuery

    if (error) {
      console.error('Error fetching boards:', error)
      return NextResponse.json({ error: 'Failed to fetch boards' }, { status: 500 })
    }

    // Transform database format to frontend format
    const transformedBoards = (boards || []).map((board) => ({
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
      position: (board.position_wall_index != null && board.position_x != null && board.position_y != null) ? {
        wallIndex: Number(board.position_wall_index),
        x: Number(board.position_x),
        y: Number(board.position_y),
        width: board.position_width != null ? Number(board.position_width) : undefined,
        height: board.position_height != null ? Number(board.position_height) : undefined,
        side: (String(board.position_side || '').trim().toLowerCase() === 'back' ? 'back' : 'front') as 'front' | 'back',
        rotation: board.position_rotation != null ? Number(board.position_rotation) : 0,
      } : undefined,
      position_rotation: board.position_rotation != null ? Number(board.position_rotation) : 0,
      ownerId: board.owner_id,
      ownerName: board.owner_name,
      ownerColor: board.owner_color,
      originalWidth: board.original_width,
      originalHeight: board.original_height,
      aspectRatio: board.aspect_ratio ? parseFloat(board.aspect_ratio) : undefined,
      physicalWidth: board.physical_width ? parseFloat(board.physical_width) : undefined,
      physicalHeight: board.physical_height ? parseFloat(board.physical_height) : undefined,
    }))

    // Surface the resolved room so the studio page can subscribe to realtime
    // changes scoped to room_id without making a second round-trip.
    const response = NextResponse.json({
      boards: transformedBoards,
      room: scopedRoomId
        ? { id: scopedRoomId, workspaceId: scopedWorkspaceId }
        : null,
    })
    response.headers.set('Cache-Control', 'no-store')
    return response
  }
  catch (error) {
    console.error('Unexpected error in GET /api/boards:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
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
      return NextResponse.json({ error: 'Failed to get session' }, { status: 500 })
    }

    const userId = session?.user?.id
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const board = await request.json()

    // Validate required fields
    if (!board.id || (!board.studioId && !board.workspaceId)) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Prepare update data for Supabase
    const updateData: Record<string, unknown> = {}

    if (board.position) {
      updateData.position_wall_index = board.position.wallIndex
      updateData.position_x = board.position.x.toString()
      updateData.position_y = board.position.y.toString()
      if (board.position.width !== undefined) updateData.position_width = board.position.width.toString()
      if (board.position.height !== undefined) updateData.position_height = board.position.height.toString()
      // Always persist side when updating position so 'back' is never lost (default 'front')
      updateData.position_side = board.position.side === 'back' ? 'back' : 'front'
      // Persist rotation when the caller explicitly sends it. Undefined means
      // "don't touch" — the column has NOT NULL DEFAULT 0 so omitting it
      // keeps whatever value the row already has. This is what makes Save &
      // Exit's bulk save preserve rotation set by the rotate-handle PATCH.
      if (board.position.rotation !== undefined) {
        updateData.position_rotation = board.position.rotation
      }
    }

    if (board.title) updateData.title = board.title
    if (board.description !== undefined) updateData.description = board.description
    if (board.tags) updateData.tags = board.tags
    if (board.studentName) updateData.student_name = board.studentName
    if (board.studentEmail) updateData.student_email = board.studentEmail

    // Use service role for access checks to avoid RLS mismatches
    const adminDb = supabaseServiceRole()

    const { data: boardData, error: boardFetchError } = await adminDb
      .from('boards')
      .select('workspace_id, owner_id')
      .eq('id', board.id)
      .single()

    if (boardFetchError || !boardData) {
      console.error('❌ [API] Board not found:', boardFetchError)
      return NextResponse.json({ error: 'Board not found' }, { status: 404 })
    }

    const { data: workspace } = await adminDb
      .from('workspaces')
      .select('owner_id')
      .eq('id', boardData.workspace_id)
      .single()

    const isWorkspaceOwner = workspace?.owner_id === userId

    const { data: membership, error: membershipError } = await adminDb
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', boardData.workspace_id)
      .eq('user_id', userId)
      .maybeSingle()

    if (membershipError) {
      console.error('Error checking workspace membership:', membershipError)
      return NextResponse.json({ error: 'Failed to verify access' }, { status: 500 })
    }

    const canEdit = boardData.owner_id === userId || isWorkspaceOwner || membership !== null

    if (!canEdit) {
      return NextResponse.json({
        error: 'Not authorized to edit this board. You must be a member of the workspace.'
      }, { status: 403 })
    }

    // Update using service role so RLS UPDATE policy can't silently block members
    const { data: updatedBoard, error } = await adminDb
      .from('boards')
      .update(updateData)
      .eq('id', board.id)
      .select()
      .single()

    if (error) {
      console.error('❌ [API] Error updating board:', error)
      return NextResponse.json({ error: 'Failed to update board' }, { status: 500 })
    }

    if (!updatedBoard) {
      return NextResponse.json({ error: 'Board not found' }, { status: 404 })
    }

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
        side: (String(updatedBoard.position_side || '').trim().toLowerCase() === 'back' ? 'back' : 'front') as 'front' | 'back',
      } : undefined,
      ownerId: updatedBoard.owner_id,
      ownerName: updatedBoard.owner_name,
      ownerColor: updatedBoard.owner_color,
    }

    return NextResponse.json({ success: true, board: transformedBoard })
  } catch (error) {
    console.error('❌ [API] Unexpected error updating board:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
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
      return NextResponse.json({ error: 'Failed to get session' }, { status: 500 })
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

    // Use service role for all access checks (consistent with GET and PUT)
    const admin = supabaseServiceRole()

    const { data: boardData, error: boardFetchError } = await admin
      .from('boards')
      .select('workspace_id, owner_id, owner_name, thumbnail_url, full_image_url')
      .eq('id', boardId)
      .single()

    if (boardFetchError || !boardData) {
      console.error('❌ [API] Board not found:', boardFetchError)
      return NextResponse.json({ error: 'Board not found' }, { status: 404 })
    }

    const { data: workspace } = await admin
      .from('workspaces')
      .select('owner_id')
      .eq('id', boardData.workspace_id)
      .single()

    const isWorkspaceOwner = workspace?.owner_id === userId

    const { data: membership, error: membershipError } = await admin
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', boardData.workspace_id)
      .eq('user_id', userId)
      .maybeSingle()

    if (membershipError) {
      console.error('Error checking workspace membership:', membershipError)
      return NextResponse.json({ error: 'Failed to verify access' }, { status: 500 })
    }

    const canDelete = boardData.owner_id === userId || isWorkspaceOwner || membership !== null

    if (!canDelete) {
      return NextResponse.json({
        error: 'Not authorized to delete this board',
        ownerName: boardData.owner_name || undefined
      }, { status: 403 })
    }

    // Cascade cleanup: comments → storage objects → board row.
    // We log and continue on failure of comments/storage so the user isn't blocked from deleting.
    const { error: commentsError } = await admin
      .from('comments')
      .delete()
      .eq('board_id', boardId)
    if (commentsError) {
      console.error('Failed to cascade delete comments for board', boardId, commentsError)
    }

    // Storage path is everything after the `/board-images/` segment of the public URL.
    const storagePathsToDelete = new Set<string>()
    const extractStoragePath = (url: string | null | undefined): string | null => {
      if (!url) return null
      const marker = '/board-images/'
      const idx = url.indexOf(marker)
      if (idx === -1) return null
      return decodeURIComponent(url.slice(idx + marker.length).split('?')[0])
    }
    const thumbPath = extractStoragePath(boardData.thumbnail_url)
    const fullPath = extractStoragePath(boardData.full_image_url)
    if (thumbPath) storagePathsToDelete.add(thumbPath)
    if (fullPath) storagePathsToDelete.add(fullPath)
    if (storagePathsToDelete.size > 0) {
      const { error: storageError } = await admin
        .storage
        .from('board-images')
        .remove(Array.from(storagePathsToDelete))
      if (storageError) {
        console.error('Failed to cascade delete storage objects for board', boardId, storageError)
      }
    }

    const { error } = await admin
      .from('boards')
      .delete()
      .eq('id', boardId)

    if (error) {
      console.error('Error deleting board:', error)
      return NextResponse.json({ error: 'Failed to delete board' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Unexpected error deleting board:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
