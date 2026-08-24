import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'
import { getDemoBoards, transformDemoBoard } from '@/lib/mockData'
import { getSampleBoards } from '@/lib/sampleData'
import { resolveMainRoomId } from '@/lib/rooms'
import { validateLinkUrl } from '@/lib/linkUrl'
import { isSuperadmin, isNetworkPublished } from '@/lib/auth/superadmin'
import { isUuid } from '@/lib/validation/uuid'
import { cleanDisplayName } from '@/lib/displayName'

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
          return NextResponse.json({ error: 'Space not found' }, { status: 404 })
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

    // --- Callout count badge (per board) ----------------------------------
    // Same visibility gate as the critique layer (see the board-comments
    // route): an authenticated workspace owner OR member OR superadmin. Public /
    // unauthenticated viewers and guest links get NO counts — never leak private
    // comment volume. The private-workspace auth branch above already guarantees
    // this, but the public-workspace branch serves non-members too, so we resolve
    // it uniformly here.
    let canSeeCallouts = false
    const { data: { session: calloutSession } } = await supabase.auth.getSession()
    const calloutUserId = calloutSession?.user?.id
    if (calloutUserId) {
      const { data: calloutWs } = await adminDb
        .from('workspaces').select('owner_id').eq('id', scopedWorkspaceId).maybeSingle()
      if (calloutWs?.owner_id === calloutUserId) canSeeCallouts = true
      if (!canSeeCallouts) {
        const { data: calloutMember } = await adminDb
          .from('workspace_members').select('user_id')
          .eq('workspace_id', scopedWorkspaceId).eq('user_id', calloutUserId).maybeSingle()
        canSeeCallouts = calloutMember != null
      }
      if (!canSeeCallouts) canSeeCallouts = await isSuperadmin(calloutUserId, adminDb)
    }

    // One grouped read (NOT N+1): fetch the root callout rows for the returned
    // boards and tally per board_id in app code. Root pins only (parent_id NULL)
    // = the number of callout markers on the board; replies live within a thread.
    const calloutCountByBoard = new Map<string, number>()
    if (canSeeCallouts) {
      const boardIds = (boards || []).map((b) => b.id as string)
      if (boardIds.length > 0) {
        const { data: calloutRows } = await adminDb
          .from('board_comments')
          .select('board_id')
          .is('parent_id', null)
          .in('board_id', boardIds)
        for (const r of calloutRows || []) {
          const bid = r.board_id as string
          calloutCountByBoard.set(bid, (calloutCountByBoard.get(bid) ?? 0) + 1)
        }
      }
    }

    // TEMP DEBUG — callout badge visibility (strip after diagnosing in Vercel logs).
    console.log('[CALLOUT-BADGE-DEBUG]', {
      canSeeCallouts,
      calloutCountByBoardSize: calloutCountByBoard.size,
      scopedRoomId,
      boardsReturned: (boards || []).length,
    })

    // Owner display names are resolved LIVE from user_profiles instead of being
    // read back from the denormalized boards.owner_name snapshot. That column is
    // written once at upload time, so it goes stale as soon as a student edits
    // their display name, and legacy rows carry placeholder values ('User',
    // 'Anonymous') from upload paths that could not resolve a name at all.
    //
    // One grouped read, not N+1. owner_id is TEXT while user_profiles.user_id is
    // UUID, and pre-Supabase rows can hold non-UUID ids — passing one of those to
    // .in() raises 22P02 and fails the whole request, so they are filtered out
    // first (same guard as app/api/admin/instructors/route.ts).
    const ownerNameById = new Map<string, string>()
    const ownerIds = Array.from(
      new Set(
        (boards || [])
          .map((b) => b.owner_id as string | null)
          .filter((id): id is string => typeof id === 'string' && id.length > 0)
      )
    ).filter(isUuid)

    if (ownerIds.length > 0) {
      const { data: ownerProfiles, error: ownerProfileError } = await adminDb
        .from('user_profiles')
        .select('user_id, full_name')
        .in('user_id', ownerIds)
      if (ownerProfileError) {
        // Non-fatal: fall through to the stored snapshot rather than failing the
        // whole board fetch over a label.
        console.error('Failed to resolve board owner display names:', ownerProfileError)
      }
      for (const row of ownerProfiles || []) {
        const name = cleanDisplayName(row.full_name)
        if (name) ownerNameById.set(row.user_id as string, name)
      }
    }

    /** Live profile name first, then the stored snapshots, placeholders removed. */
    const resolveOwnerName = (board: Record<string, unknown>): string | undefined => {
      const ownerId = typeof board.owner_id === 'string' ? board.owner_id : null
      const live = ownerId ? ownerNameById.get(ownerId) : undefined
      return live || cleanDisplayName(board.owner_name) || cleanDisplayName(board.student_name) || undefined
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
      ownerName: resolveOwnerName(board),
      ownerColor: board.owner_color,
      originalWidth: board.original_width,
      originalHeight: board.original_height,
      aspectRatio: board.aspect_ratio ? parseFloat(board.aspect_ratio) : undefined,
      physicalWidth: board.physical_width ? parseFloat(board.physical_width) : undefined,
      physicalHeight: board.physical_height ? parseFloat(board.physical_height) : undefined,
      boardWidthIn: board.board_width_in != null ? Number(board.board_width_in) : undefined,
      boardHeightIn: board.board_height_in != null ? Number(board.board_height_in) : undefined,
      linkUrl: board.link_url ?? undefined,
      // Present only for permitted viewers; undefined omits it from JSON so
      // guests/public viewers never receive a count (and the client renders no badge).
      calloutCount: canSeeCallouts ? (calloutCountByBoard.get(board.id) ?? 0) : undefined,
      // Per-room slideshow position. The ORDER BY above stays uploaded_at DESC
      // (the 3D room and wall editor consume that order); only the lightbox
      // re-sorts on this, client-side via lib/boardOrder.ts.
      sortOrder: board.sort_order ?? null,
    }))

    // Room-level wall color (migration 031) so the 3D renderer can paint the
    // walls without a second round-trip. One tiny read keyed by the resolved
    // room; defaults to 'grey' (the current look) when absent.
    let scopedRoomWallColor: 'grey' | 'white' = 'grey'
    if (scopedRoomId) {
      const { data: roomRow } = await adminDb
        .from('rooms')
        .select('wall_color')
        .eq('id', scopedRoomId)
        .maybeSingle()
      if (roomRow?.wall_color === 'white') scopedRoomWallColor = 'white'
    }

    // Surface the resolved room so the studio page can subscribe to realtime
    // changes scoped to room_id without making a second round-trip.
    const response = NextResponse.json({
      boards: transformedBoards,
      room: scopedRoomId
        ? { id: scopedRoomId, workspaceId: scopedWorkspaceId, name: scopedRoomName, wallColor: scopedRoomWallColor }
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

    if (board.position === null) {
      // Explicit clear (un-place): the client sends `position: null` to remove a
      // board from its wall. Absent/undefined still means "don't touch position"
      // (else-if below), so author-only / link-only PUTs never wipe placement.
      updateData.position_wall_index = null
      updateData.position_x = null
      updateData.position_y = null
      updateData.position_width = null
      updateData.position_height = null
      updateData.position_side = null
    } else if (board.position) {
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
      // Carried so a caller merging this response into its boards cache keeps
      // the board's slideshow slot. Omitting it would merge in as null and send
      // the board to the end of the lightbox sequence (lib/boardOrder.ts).
      sortOrder: updatedBoard.sort_order ?? null,
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
    const extractStoragePath = (url: string | null | undefined): string | null => {
      if (!url) return null
      const marker = '/board-images/'
      const idx = url.indexOf(marker)
      if (idx === -1) return null
      const raw = url.slice(idx + marker.length).split('?')[0]
      // A malformed percent-escape makes decodeURIComponent throw. Since the
      // reference check below runs this over OTHER boards' URLs, one poisoned
      // row would otherwise 500 every delete that scans past it — including
      // deletes of unrelated boards. Fall back to the undecoded slice.
      try {
        return decodeURIComponent(raw)
      } catch {
        return raw
      }
    }

    // ALIASING INVARIANT — DO NOT REMOVE THIS GUARD WITHOUT ALSO FIXING
    // /api/boards/duplicate. Multiple board rows can reference the SAME storage
    // object: duplicate (copy/paste) copies the source's thumbnail_url and
    // full_image_url VERBATIM instead of creating its own file, so a copy, its
    // source, and sibling copies all point at one object. Removing that object
    // while another row still references it permanently blanks those boards
    // (three boards were already destroyed this way). So: only remove an object
    // when NO other board still references its storage path.
    //
    // Ordering: this CHECK runs before the row delete, so the row being deleted
    // still exists and would match its own URLs — we exclude it explicitly with
    // .neq('id', boardId). The REMOVAL itself runs after the row delete
    // succeeds; see the note at that call. Service role (admin), NOT
    // supabaseServer(): an RLS-bound query can't see boards in workspaces this
    // user cannot access, which would UNDER-count references and delete a live
    // object — the exact failure this guard exists to prevent.
    //
    // thumbnail_url and full_image_url are evaluated INDEPENDENTLY (distinct
    // objects, distinct fates); URLs that resolve to the SAME storage path
    // (e.g. PDFs where thumb === full) are de-duped so we don't query twice.
    //
    // The count keys on the extracted storage PATH, not the raw URL. Two rows
    // can address one object through different URL strings — a query string, a
    // percent-encoding difference, a changed CDN base — and a raw-URL equality
    // check would miss that and delete a live object.
    //
    // `_` is a LIKE single-char wildcard and DOES occur in generated paths
    // (model filenames sanitise to `_`), so LIKE metacharacters are escaped.
    // Over-matching is harmless — every candidate is re-verified in JS — but
    // under-matching is not.
    const escapeLike = (s: string): string => s.replace(/([\\%_])/g, '\\$1')

    // Candidate page size. A full page means we cannot PROVE the object is
    // unreferenced (a true alias could sit past the end), so a full page is
    // treated as referenced. Leak, not loss.
    const CANDIDATE_LIMIT = 500

    const isPathReferencedByOtherBoard = async (path: string): Promise<boolean> => {
      // A path may be referenced by another board via EITHER column, so check
      // both. On query error, fail safe (treat as referenced → skip removal):
      // leaving an orphan object is recoverable; destroying a live aliased
      // image is not.
      //
      // Stored URLs come from getPublicUrl, which encodeURI()s the whole URL,
      // whereas `path` is decoded — so a LIKE built from the decoded form
      // cannot match a stored URL containing any character encodeURI escapes
      // (space, %, non-ASCII, ...). Every path we generate today is
      // [a-zA-Z0-9._/-] so the two forms coincide, but matching BOTH means this
      // does not quietly start under-counting the day that stops being true.
      const variants = Array.from(new Set([path, encodeURI(path)]))

      for (const variant of variants) {
        const pattern = `%${escapeLike(variant)}%`

        const { data: thumbRows, error: thumbErr } = await admin
          .from('boards')
          .select('id, thumbnail_url')
          .neq('id', boardId)
          .like('thumbnail_url', pattern)
          .limit(CANDIDATE_LIMIT)
        if (thumbErr) {
          console.error('Reference check (thumbnail_url) failed; skipping removal to be safe', boardId, thumbErr)
          return true
        }
        const thumbCandidates = thumbRows ?? []
        if (thumbCandidates.length >= CANDIDATE_LIMIT) {
          console.warn('Reference check (thumbnail_url) hit the candidate cap; skipping removal to be safe', { boardId, path })
          return true
        }
        if (thumbCandidates.some((r) => extractStoragePath(r.thumbnail_url) === path)) return true

        const { data: fullRows, error: fullErr } = await admin
          .from('boards')
          .select('id, full_image_url')
          .neq('id', boardId)
          .like('full_image_url', pattern)
          .limit(CANDIDATE_LIMIT)
        if (fullErr) {
          console.error('Reference check (full_image_url) failed; skipping removal to be safe', boardId, fullErr)
          return true
        }
        const fullCandidates = fullRows ?? []
        if (fullCandidates.length >= CANDIDATE_LIMIT) {
          console.warn('Reference check (full_image_url) hit the candidate cap; skipping removal to be safe', { boardId, path })
          return true
        }
        if (fullCandidates.some((r) => extractStoragePath(r.full_image_url) === path)) return true
      }
      return false
    }

    const checkedPaths = new Set<string>()
    const storagePathsToDelete = new Set<string>()
    for (const url of [boardData.thumbnail_url, boardData.full_image_url]) {
      if (!url) continue
      const path = extractStoragePath(url)
      if (!path) {
        // Legacy /uploads/... URLs and anything not in this bucket. Nothing to
        // remove, but say so rather than dropping it silently.
        console.warn('Skipping storage removal: URL is not a board-images object', { boardId, url })
        continue
      }
      if (checkedPaths.has(path)) continue
      checkedPaths.add(path)
      if (await isPathReferencedByOtherBoard(path)) {
        console.warn(
          'Skipping storage removal: object still referenced by another board (aliased copy)',
          { boardId, path }
        )
        continue
      }
      storagePathsToDelete.add(path)
    }

    const { error } = await admin
      .from('boards')
      .delete()
      .eq('id', boardId)

    if (error) {
      console.error('Error deleting board:', error)
      return NextResponse.json({ error: 'Failed to delete board' }, { status: 500 })
    }

    // Storage removal runs only AFTER the row delete succeeds. Removing first
    // meant a failed row delete left the surviving row pointing at an object
    // that no longer existed — a blanked board, the same loss the reference
    // guard above exists to prevent. Orphaning an object on the reverse failure
    // (row gone, remove fails) is logged and recoverable.
    if (storagePathsToDelete.size > 0) {
      // Re-check each path immediately before removing it. Between the first
      // check and here we issued a row delete, and a concurrent
      // /api/boards/duplicate could have inserted a row aliasing one of these
      // objects in that window — that fresh copy would arrive already blanked.
      // This does not close the window completely (nothing short of a
      // transaction or real storage copies does), but it narrows it to the
      // remove call itself.
      const confirmedUnreferenced: string[] = []
      for (const path of storagePathsToDelete) {
        if (await isPathReferencedByOtherBoard(path)) {
          console.warn('Skipping storage removal: object became referenced during delete', { boardId, path })
          continue
        }
        confirmedUnreferenced.push(path)
      }

      if (confirmedUnreferenced.length > 0) {
        try {
          const { error: storageError } = await admin
            .storage
            .from('board-images')
            .remove(confirmedUnreferenced)
          if (storageError) {
            console.error('Failed to cascade delete storage objects for board', boardId, storageError)
          }
        } catch (storageThrow) {
          // Never let this surface as a 500: the row is already gone, so the
          // delete succeeded as far as the caller is concerned. Reporting
          // failure here would invite a retry of an already-completed delete.
          console.error('Storage removal threw for board', boardId, storageThrow)
        }
      }
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
        return NextResponse.json({ error: 'Space not found' }, { status: 404 })
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
    // Default title = original filename with its extension stripped, control
    // chars removed, trimmed, and capped at 120. Fall back to a friendly label
    // only when the filename is missing or sanitizes to nothing (e.g. ".png").
    const deriveDefaultTitle = (fn: string | null): string => {
      if (!fn) return 'Untitled board'
      let cleaned = ''
      for (const ch of fn.replace(/\.[^.]+$/, '')) {
        const code = ch.charCodeAt(0)
        if (code > 0x1f && code !== 0x7f) cleaned += ch
      }
      cleaned = cleaned.trim().slice(0, 120).trim()
      return cleaned.length > 0 ? cleaned : 'Untitled board'
    }
    const title = deriveDefaultTitle(originalFilename)

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
      // Assigned by the boards_set_default_sort_order trigger (migration 035),
      // so a freshly inserted board merges into the caller's cache already
      // holding its slideshow slot instead of null-ranking to the end.
      sortOrder:      savedBoard.sort_order ?? null,
    }

    return NextResponse.json({ board, fullUrl, thumbnailUrl })
  } catch (error) {
    console.error('POST /api/boards unexpected error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
