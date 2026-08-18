import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/server'
import { resolveGuestToken } from '@/lib/auth/guestToken'

export const dynamic = 'force-dynamic'

// Guest-critic boards feed — mirrors /api/share/[token]/boards, but gated by a
// guest_tokens link (resolveGuestToken) instead of a room_share_token. Read-only.
// Student emails are intentionally omitted (guests are external critics).
export async function GET(
  _request: NextRequest,
  { params }: { params: { token: string } }
) {
  const { token } = params
  const guest = await resolveGuestToken(token)
  if (!guest) {
    return NextResponse.json({ error: 'Invalid or expired guest link' }, { status: 404 })
  }

  const admin = supabaseServiceRole()

  const { data: room } = await admin
    .from('rooms')
    .select('id, workspace_id, name, wall_color')
    .eq('id', guest.roomId)
    .maybeSingle()

  if (!room) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  }

  const { data: boards, error: boardsError } = await admin
    .from('boards')
    .select('*')
    .eq('room_id', guest.roomId)
    .neq('upload_status', 'pending')
    .order('uploaded_at', { ascending: false })

  if (boardsError) {
    console.error('[/api/crit/[token]/boards] Error fetching boards:', boardsError)
    return NextResponse.json({ error: 'Failed to fetch boards' }, { status: 500 })
  }

  const transformedBoards = (boards || []).map((board) => ({
    id: board.id,
    studioId: board.workspace_id,
    workspaceId: board.workspace_id,
    studentName: board.student_name,
    title: board.title,
    description: board.description,
    thumbnailUrl: board.thumbnail_url,
    fullImageUrl: board.full_image_url,
    tags: board.tags || [],
    uploadedAt: board.uploaded_at,
    position:
      board.position_wall_index != null &&
      board.position_x != null &&
      board.position_y != null
        ? {
            wallIndex: Number(board.position_wall_index),
            x: Number(board.position_x),
            y: Number(board.position_y),
            width: board.position_width != null ? Number(board.position_width) : undefined,
            height: board.position_height != null ? Number(board.position_height) : undefined,
            side: (
              String(board.position_side || '')
                .trim()
                .toLowerCase() === 'back'
                ? 'back'
                : 'front'
            ) as 'front' | 'back',
            rotation: board.position_rotation != null ? Number(board.position_rotation) : 0,
          }
        : undefined,
    position_rotation: board.position_rotation != null ? Number(board.position_rotation) : 0,
    originalWidth: board.original_width,
    originalHeight: board.original_height,
    aspectRatio: board.aspect_ratio ? parseFloat(board.aspect_ratio) : undefined,
    physicalWidth: board.physical_width ? parseFloat(board.physical_width) : undefined,
    physicalHeight: board.physical_height ? parseFloat(board.physical_height) : undefined,
    boardWidthIn: board.board_width_in != null ? Number(board.board_width_in) : undefined,
    boardHeightIn: board.board_height_in != null ? Number(board.board_height_in) : undefined,
    linkUrl: board.link_url ?? undefined,
    // Per-room slideshow position, consumed by the lightbox only (see
    // lib/boardOrder.ts). Must be returned here too: guest crit runs the same
    // lightbox, and without it every board would rank null and the sequence
    // would fall through to the upload-time tiebreaker.
    sortOrder: board.sort_order ?? null,
  }))

  const response = NextResponse.json({
    boards: transformedBoards,
    room: {
      id: room.id,
      workspaceId: room.workspace_id,
      name: room.name,
      wallColor: room.wall_color === 'white' ? 'white' : 'grey',
    },
    guest: {
      tokenId: guest.tokenId,
      label: guest.label,
      canComment: guest.canComment,
      canTrace: guest.canTrace,
    },
  })
  response.headers.set('Cache-Control', 'no-store')
  return response
}
