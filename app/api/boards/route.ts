import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'
import { getDemoBoards, transformDemoBoard } from '@/lib/mockData'
import { getSampleBoards } from '@/lib/sampleData'
import { resolveMainRoomId } from '@/lib/rooms'
import { validateLinkUrl } from '@/lib/linkUrl'
import { isSuperadmin, isNetworkPublished } from '@/lib/auth/superadmin'

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
    // Surfaced on the response so view-mode can display the room name in its
    // top bar without a separate /api/workspaces fetch. Edit-mode still uses
    // its own workspace fetch because it also needs the rooms-list (for the
    // switcher dropdown); single-room name is sufficient here.
    let scopedRoomName: string | null = null

    // Inline helper for the fallback paths that previously called
    // resolveMainRoomId — we now need the name too, and one query is cheaper
    // than two (an id-only call followed by a name-only call).
    const fetchFirstRoomWithName = async (wsId: string) => {
      const { data } = await adminDb
        .from('rooms')
        .select('id, name')
        .eq('workspace_id', wsId)
        .order('display_order', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      return data
        ? { id: data.id as string, name: (data.name as string) ?? null }
        : null
    }

    if (roomIdParam) {
      const { data: room } = await adminDb
        .from('rooms')
        .select('id, workspace_id, name')
        .eq('id', roomIdParam)
        .maybeSingle()
      if (room) {
        scopedWorkspaceId = room.workspace_id as string
        scopedRoomId = room.id as string
        scopedRoomName = (room.name as string) ?? null
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
        const firstRoom = await fetchFirstRoomWithName(ws.id as string)
        scopedRoomId = firstRoom?.id ?? null
        scopedRoomName = firstRoom?.name ?? null
      }
    } else if (workspaceId) {
      scopedWorkspaceId = workspaceId
      const firstRoom = await fetchFirstRoomWithName(workspaceId)
      scopedRoomId = firstRoom?.id ?? null
      scopedRoomName = firstRoom?.name ?? null
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

      // Platform superadmin: READ-ONLY access to network-published content, in
      // addition to owner/member access. Verified server-side via service role
      // from the authenticated user id (never a client flag). Scoped strictly
      // to published-to-network content — unpublished workspaces still require
      // ownership/membership below.
      const superadminViewer = await isSuperadmin(userId, adminDb)
      const networkPublished =
        superadminViewer &&
        (await isNetworkPublished(adminDb, { roomId: scopedRoomId, workspaceId: scopedWorkspaceId }))

      if (!(superadminViewer && networkPublished)) {
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
      studentEmail: isPublicWorkspace ? undefined : board.student_email,
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
      boardWidthIn: board.board_width_in != null ? Number(board.board_width_in) : undefined,
      boardHeightIn: board.board_height_in != null ? Number(board.board_height_in) : undefined,
      linkUrl: board.link_url ?? undefined,
    }))

    // Surface the resolved room so the studio page can subscribe to realtime
    // changes scoped to room_id without making a second round-trip.
    const response = NextResponse.json({
      boards: transformedBoards,
      room: scopedRoomId
        ? { id: scopedRoomId, workspaceId: scopedWorkspaceId, name: scopedRoomName }
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

    // Absolute board size in inches (independent of wall). Written here so Save
    // & Exit's bulk save persists a corner-resize whose dedicated PATCH failed.
    if (typeof board.boardWidthIn === 'number') updateData.board_width_in = board.boardWidthIn
    if (typeof board.boardHeightIn === 'number') updateData.board_height_in = board.boardHeightIn

    if (board.title) updateData.title = board.title
    if (board.description !== undefined) updateData.description = board.description
    if (board.tags) updateData.tags = board.tags
    if (board.studentName) updateData.student_name = board.studentName
    if (board.studentEmail) updateData.student_email = board.studentEmail

    // Optional video link. Only touch the column when the caller explicitly
    // sends the field (undefined = "leave as-is", so position-only/author-only
    // PUTs don't wipe an existing link). An empty/whitespace value clears it.
    if (board.linkUrl !== undefined) {
      const { value, error } = validateLinkUrl(board.linkUrl)
      if (error) return NextResponse.json({ error }, { status: 400 })
      updateData.link_url = value
    }

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
      boardWidthIn: updatedBoard.board_width_in != null ? Number(updatedBoard.board_width_in) : undefined,
      boardHeightIn: updatedBoard.board_height_in != null ? Number(updatedBoard.board_height_in) : undefined,
      linkUrl: updatedBoard.link_url ?? undefined,
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

// ---------------------------------------------------------------------------
// POST /api/boards — metadata-only board creation after client-direct storage upload.
//
// Source fidelity notes (patterns ported 1:1 from app/api/upload/route.ts):
//
// Auth pattern (upload/route.ts:8-22):
//   const { data: { session } } = await supabase.auth.getSession()
//   if (!session?.user?.id) return 401
//
// Membership check (upload/route.ts:214-242 — RLS fallback gate):
//   check workspaces.owner_id first via service role;
//   if not owner, check workspace_members; otherwise 403.
//
// roomId cross-check (upload/route.ts:162-177):
//   if roomId provided: verify room.workspace_id === workspaceId, else 404.
//   if no roomId: resolveMainRoomId(admin, workspaceId).
//
// boards INSERT columns (upload/route.ts:179-206 + 307-316, collapsed into one):
//   id, workspace_id, room_id, owner_id, owner_name, owner_color,
//   student_name, student_email, title, description, thumbnail_url,
//   full_image_url, tags, uploaded_at, upload_status ('complete' — no placeholder
//   dance needed since storage is already settled), position_wall_index,
//   position_x, position_y, position_width, position_height, position_side,
//   position_rotation (NOT NULL DEFAULT 0, omitted by /api/upload but written here),
//   original_width, original_height, aspect_ratio, physical_width, physical_height.
//
// NOTE: request body fields `contentType` and `fileSize` are accepted for
// forward-compatibility but have no matching boards column today — they are not stored.
// ---------------------------------------------------------------------------

interface BoardsPostBody {
  workspaceId?: unknown
  roomId?: unknown
  storagePath?: unknown
  thumbnailPath?: unknown
  contentType?: unknown      // accepted; no matching boards column today — ignored
  fileSize?: unknown         // accepted; no matching boards column today — ignored
  position?: {
    x?: unknown
    y?: unknown
    z?: unknown              // no boards column — ignored
    rotation?: unknown
    scale?: unknown          // no boards column — ignored
    wallIndex?: unknown      // maps to position_wall_index
    widthPercent?: unknown   // maps to position_width
    heightPercent?: unknown  // maps to position_height
    side?: unknown           // 'front' | 'back'; null if omitted
  }
  width?: unknown
  height?: unknown
  ownerColor?: unknown
  isPdf?: unknown
  originalFilename?: unknown
  studentName?: unknown
  physicalWidth?: unknown   // optional, real-world inches; maps to physical_width column
  physicalHeight?: unknown  // optional, real-world inches; maps to physical_height column
  boardWidthIn?: unknown    // absolute rendered board width in inches; maps to board_width_in
  boardHeightIn?: unknown   // absolute rendered board height in inches; maps to board_height_in
  linkUrl?: unknown         // optional video link; validated + maps to link_url (nullable)
}

export async function POST(request: NextRequest) {
  try {
    // 1. Auth — mirrors upload/route.ts:8-22
    const supabase = supabaseServer()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = session.user.id

    // 2. Parse + validate required fields
    const raw = await request.json() as BoardsPostBody

    const workspaceId = typeof raw.workspaceId === 'string' ? raw.workspaceId.trim() : null
    const storagePath  = typeof raw.storagePath  === 'string' ? raw.storagePath.trim()  : null
    // Fix 3: contentType and fileSize are optional — accepted if present, not stored (no boards column).
    // Kept in the interface for forward-compat when the schema gains these columns.
    // const contentType = ...  (parsed but unused)
    // const fileSize    = ...  (parsed but unused)

    if (!workspaceId) return NextResponse.json({ error: 'Missing required field: workspaceId' }, { status: 400 })
    if (!storagePath) return NextResponse.json({ error: 'Missing required field: storagePath' }, { status: 400 })

    const thumbnailPath    = typeof raw.thumbnailPath    === 'string'  ? raw.thumbnailPath.trim()    : null
    const width            = typeof raw.width            === 'number'  ? raw.width                   : null
    const height           = typeof raw.height           === 'number'  ? raw.height                  : null
    // Fix 4: ownerColor is required — generateOwnerColor runs client-side; server should not guess.
    const ownerColor       = typeof raw.ownerColor       === 'string'  ? raw.ownerColor.trim()        : null
    if (!ownerColor) return NextResponse.json({ error: 'Missing required field: ownerColor' }, { status: 400 })

    const isPdf            = raw.isPdf === true
    const originalFilename = typeof raw.originalFilename === 'string'  ? raw.originalFilename.trim() : null
    const studentNameRaw   = typeof raw.studentName      === 'string'  ? raw.studentName.trim()      : null
    const roomIdRaw        = typeof raw.roomId           === 'string'  ? raw.roomId.trim()            : null
    const physicalWidth    = typeof raw.physicalWidth    === 'number'  ? raw.physicalWidth            : null
    const physicalHeight   = typeof raw.physicalHeight   === 'number'  ? raw.physicalHeight           : null
    const boardWidthIn     = typeof raw.boardWidthIn     === 'number'  ? raw.boardWidthIn             : null
    const boardHeightIn    = typeof raw.boardHeightIn    === 'number'  ? raw.boardHeightIn            : null
    // Optional video link — validate + normalize with the shared rules. Reject
    // a malformed link with 400 rather than silently dropping it.
    const { value: linkUrl, error: linkUrlError } = validateLinkUrl(raw.linkUrl)
    if (linkUrlError) return NextResponse.json({ error: linkUrlError }, { status: 400 })

    const positionX           = typeof raw.position?.x           === 'number' ? raw.position.x           : null
    const positionY           = typeof raw.position?.y           === 'number' ? raw.position.y           : null
    const positionRotation    = typeof raw.position?.rotation    === 'number' ? raw.position.rotation    : 0
    // Fix 1: wall-position fields — map to existing boards columns (PUT handler already r/w these)
    const positionWallIndex   = typeof raw.position?.wallIndex   === 'number' ? raw.position.wallIndex   : null
    const positionWidth       = typeof raw.position?.widthPercent  === 'number' ? raw.position.widthPercent  : null
    const positionHeight      = typeof raw.position?.heightPercent === 'number' ? raw.position.heightPercent : null
    // side: normalize 'back' (case-insensitive) → 'back'; any other string → 'front'; omitted → null
    const positionSide: 'front' | 'back' | null =
      typeof raw.position?.side === 'string'
        ? (raw.position.side.toLowerCase() === 'back' ? 'back' : 'front')
        : null

    // 3. Membership check — mirrors upload/route.ts:214-242
    const admin = supabaseServiceRole()
    const { data: ws } = await admin
      .from('workspaces')
      .select('owner_id')
      .eq('id', workspaceId)
      .maybeSingle()
    if (!ws) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    if (ws.owner_id !== userId) {
      const { data: m } = await admin
        .from('workspace_members')
        .select('user_id')
        .eq('workspace_id', workspaceId)
        .eq('user_id', userId)
        .maybeSingle()
      if (!m) return NextResponse.json({ error: 'Not a member of this workspace' }, { status: 403 })
    }

    // 4. Room resolution — mirrors upload/route.ts:162-177
    let resolvedRoomId: string | null = null
    if (roomIdRaw) {
      const { data: room } = await admin
        .from('rooms')
        .select('id, workspace_id')
        .eq('id', roomIdRaw)
        .maybeSingle()
      if (!room || room.workspace_id !== workspaceId) {
        return NextResponse.json({ error: 'Room not found' }, { status: 404 })
      }
      resolvedRoomId = room.id as string
    } else {
      resolvedRoomId = await resolveMainRoomId(admin, workspaceId)
    }

    // 5. Owner/student metadata — mirrors upload/route.ts:24-41
    const { data: userProfile } = await supabase
      .from('user_profiles')
      .select('full_name')
      .eq('user_id', userId)
      .single()
    const profileName = userProfile?.full_name?.trim() || null

    const ownerName   = profileName || session.user.user_metadata?.email?.split('@')[0] || 'User'
    const studentName = studentNameRaw || profileName || session.user.email?.split('@')[0] || 'Anonymous'
    const studentEmail = session.user.email || null

    // 6. Public URLs — storage already settled, just resolve paths.
    // Fix 2: mirror /api/upload behavior (upload/route.ts:291-303):
    //   thumbnailUrl = getPublicUrl(thumbnailPath) when a thumb exists,
    //   otherwise fall back to fullUrl (same as /api/upload does for PDFs where no thumb is generated).
    //   Never null — grid views always have something to render.
    const { data: fullUrlData } = admin.storage.from('board-images').getPublicUrl(storagePath)
    const fullUrl = fullUrlData.publicUrl
    let thumbnailUrl = fullUrl
    if (thumbnailPath) {
      const { data: thumbUrlData } = admin.storage.from('board-images').getPublicUrl(thumbnailPath)
      thumbnailUrl = thumbUrlData.publicUrl
    }

    // 7. Single INSERT — no placeholder→update dance; upload_status is 'complete' immediately.
    //    Column list mirrors upload/route.ts placeholderData + the subsequent UPDATE, merged.
    const ts    = Date.now()
    const rand  = Math.random().toString(36).slice(2, 8)
    const boardId = `board-${ts}-${rand}`
    const title = originalFilename ? originalFilename.replace(/\.[^.]+$/, '') : 'Untitled Board'

    const { data: savedBoard, error: insertError } = await admin
      .from('boards')
      .insert({
        id:                 boardId,
        workspace_id:       workspaceId,
        room_id:            resolvedRoomId,
        owner_id:           userId,
        owner_name:         ownerName,
        owner_color:        ownerColor,  // required; validated above
        student_name:       studentName,
        student_email:      studentEmail,
        title,
        description:        null,
        thumbnail_url:      thumbnailUrl,
        full_image_url:     fullUrl,
        tags:               isPdf ? ['pdf'] : [],
        uploaded_at:        new Date().toISOString(),
        upload_status:      'complete',
        position_wall_index: positionWallIndex,  // Fix 1: from request body
        position_x:         positionX,
        position_y:         positionY,
        position_width:     positionWidth,       // Fix 1: from widthPercent
        position_height:    positionHeight,      // Fix 1: from heightPercent
        position_side:      positionSide,        // Fix 1: null if omitted
        position_rotation:  positionRotation,
        original_width:     width,
        original_height:    height,
        aspect_ratio:       width && height && height > 0 ? width / height : null,
        physical_width:     physicalWidth,
        physical_height:    physicalHeight,
        board_width_in:     boardWidthIn,
        board_height_in:    boardHeightIn,
        link_url:           linkUrl,
      })
      .select()
      .single()

    if (insertError || !savedBoard) {
      console.error('POST /api/boards INSERT failed:', insertError)
      return NextResponse.json(
        { error: 'Internal error', detail: insertError?.message },
        { status: 500 }
      )
    }

    // 8. Transform to frontend Board shape — mirrors upload/route.ts:328-356
    const board = {
      id:           savedBoard.id,
      studioId:     savedBoard.workspace_id,
      workspaceId:  savedBoard.workspace_id,
      studentName:  savedBoard.student_name,
      studentEmail: savedBoard.student_email,
      title:        savedBoard.title,
      description:  savedBoard.description,
      thumbnailUrl: savedBoard.thumbnail_url,
      fullImageUrl: savedBoard.full_image_url,
      tags:         savedBoard.tags || [],
      uploadedAt:   savedBoard.uploaded_at,
      position: (
        savedBoard.position_wall_index !== null &&
        savedBoard.position_x         !== null &&
        savedBoard.position_y         !== null
      ) ? {
        wallIndex: Number(savedBoard.position_wall_index),
        x:         parseFloat(savedBoard.position_x),
        y:         parseFloat(savedBoard.position_y),
        width:     savedBoard.position_width  != null ? parseFloat(savedBoard.position_width)  : undefined,
        height:    savedBoard.position_height != null ? parseFloat(savedBoard.position_height) : undefined,
        side:      (String(savedBoard.position_side || '').toLowerCase() === 'back' ? 'back' : 'front') as 'front' | 'back',
        rotation:  savedBoard.position_rotation != null ? Number(savedBoard.position_rotation) : 0,
      } : undefined,
      ownerId:       savedBoard.owner_id,
      ownerName:     savedBoard.owner_name,
      ownerColor:    savedBoard.owner_color,
      originalWidth:  savedBoard.original_width,
      originalHeight: savedBoard.original_height,
      aspectRatio:    savedBoard.aspect_ratio    ? parseFloat(savedBoard.aspect_ratio)    : undefined,
      physicalWidth:  savedBoard.physical_width  ? parseFloat(savedBoard.physical_width)  : undefined,
      physicalHeight: savedBoard.physical_height ? parseFloat(savedBoard.physical_height) : undefined,
      boardWidthIn:   savedBoard.board_width_in  != null ? Number(savedBoard.board_width_in)  : undefined,
      boardHeightIn:  savedBoard.board_height_in != null ? Number(savedBoard.board_height_in) : undefined,
      linkUrl:        savedBoard.link_url ?? undefined,
    }

    return NextResponse.json({ board, fullUrl, thumbnailUrl })
  } catch (error) {
    console.error('POST /api/boards unexpected error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
