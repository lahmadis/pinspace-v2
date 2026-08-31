import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/** How many pins the dashboard shelf will show. */
const MAX_PINS = 24

interface BoardRow {
  id: string
  title: string | null
  thumbnail_url: string | null
  full_image_url: string | null
  room_id: string | null
  workspace_id: string | null
  owner_name: string | null
  student_name: string | null
}

/**
 * May this person pin this board?
 *
 * Checked server-side rather than trusted from the client because a pin is a
 * durable reference — an unchecked POST would let anyone keep a tile pointing
 * into a studio they cannot open, and the tile would then fail forever with no
 * way to tell why.
 *
 * FOUR ways in, and the ROOM one is the load-bearing one:
 *
 *   rooms.is_published is what the archive actually publishes. A studio reaches
 *   the network by publishing a ROOM; workspaces.is_public is a separate, older
 *   flag that is set on some published spaces and not others — false on SEED 3,
 *   Studio 03 and Studio 06 while all three are in the network and browsable.
 *   Gating on it alone (as this first did) 403'd exactly the case the feature
 *   exists for: keeping somebody else's sheet that you found in the archive.
 *
 * The other three are the ordinary ones: a public workspace, your own, or one
 * you are a member of.
 */
async function canSeeBoard(
  admin: ReturnType<typeof supabaseServiceRole>,
  workspaceId: string | null,
  roomId: string | null,
  userId: string,
): Promise<boolean> {
  // Published to the network — the archive shows it, so it can be kept.
  if (roomId) {
    const { data: room } = await admin
      .from('rooms')
      .select('is_published')
      .eq('id', roomId)
      .maybeSingle()
    if (room?.is_published === true) return true
  }

  if (!workspaceId) return false

  const { data: workspace } = await admin
    .from('workspaces')
    .select('owner_id, is_public')
    .eq('id', workspaceId)
    .maybeSingle()
  if (!workspace) return false

  if (workspace.is_public === true) return true
  if (workspace.owner_id === userId) return true

  const { data: membership } = await admin
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle()
  return membership !== null
}

/**
 * GET /api/pinspaces — the boards this person kept.
 *
 * Returns enough to draw the tile (thumbnail, title, who made it) and to act on
 * it (roomId, for the lightbox's "Open 3D space"). Newest first, which is the
 * order the shelf reads in.
 *
 * A pin whose board has vanished is dropped rather than returned as a hole:
 * the FK cascades on delete, so this only happens in the window where a board
 * row is gone but the response was already in flight.
 */
export async function GET() {
  try {
    const supabase = await supabaseServer()
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = supabaseServiceRole()
    const { data: pins, error: pinsError } = await admin
      .from('pinned_boards')
      .select('board_id, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(MAX_PINS)
    if (pinsError) {
      console.error('Error loading pinned boards:', pinsError)
      return NextResponse.json({ error: 'Failed to load your pins' }, { status: 500 })
    }

    const boardIds = (pins ?? []).map((p) => String(p.board_id))
    if (boardIds.length === 0) return NextResponse.json({ pins: [] })

    const { data: boards, error: boardsError } = await admin
      .from('boards')
      .select('id, title, thumbnail_url, full_image_url, room_id, workspace_id, owner_name, student_name')
      .in('id', boardIds)
    if (boardsError) {
      console.error('Error loading boards for pins:', boardsError)
      return NextResponse.json({ error: 'Failed to load your pins' }, { status: 500 })
    }

    const byId = new Map<string, BoardRow>()
    for (const b of (boards ?? []) as BoardRow[]) byId.set(String(b.id), b)

    // Ordered by the PIN, not by the board query, which returns rows in
    // whatever order the id list resolved in.
    const result = boardIds
      .map((id) => {
        const board = byId.get(id)
        if (!board) return null
        return {
          boardId: board.id,
          title: board.title || 'Untitled',
          thumbnailUrl: board.thumbnail_url || board.full_image_url || null,
          fullImageUrl: board.full_image_url || board.thumbnail_url || null,
          roomId: board.room_id,
          workspaceId: board.workspace_id,
          author: board.student_name || board.owner_name || null,
        }
      })
      .filter(Boolean)

    return NextResponse.json({ pins: result })
  } catch (err) {
    console.error('Unexpected error loading pins:', err)
    return NextResponse.json({ error: 'Failed to load your pins' }, { status: 500 })
  }
}

/** POST /api/pinspaces — keep this board. Body: { boardId }. */
export async function POST(request: NextRequest) {
  try {
    const supabase = await supabaseServer()
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const boardId = typeof body?.boardId === 'string' ? body.boardId.trim() : ''
    if (!boardId) {
      return NextResponse.json({ error: 'boardId is required' }, { status: 400 })
    }

    const admin = supabaseServiceRole()
    const { data: board } = await admin
      .from('boards')
      .select('id, workspace_id, room_id')
      .eq('id', boardId)
      .maybeSingle()
    if (!board) {
      return NextResponse.json({ error: 'Board not found' }, { status: 404 })
    }

    const allowed = await canSeeBoard(
      admin,
      board.workspace_id as string | null,
      board.room_id as string | null,
      user.id,
    )
    if (!allowed) {
      return NextResponse.json(
        { error: 'You can only pin work from spaces you can open.' },
        { status: 403 }
      )
    }

    // Upsert on the unique pair rather than read-then-insert: pinning twice is
    // the same pin, and a double press must not make two tiles of one sheet.
    const { error: insertError } = await admin
      .from('pinned_boards')
      .upsert(
        { user_id: user.id, board_id: boardId },
        { onConflict: 'user_id,board_id', ignoreDuplicates: true },
      )
    if (insertError) {
      console.error('Error pinning board:', insertError)
      return NextResponse.json({ error: 'Failed to pin that board' }, { status: 500 })
    }

    return NextResponse.json({ pinned: true })
  } catch (err) {
    console.error('Unexpected error pinning board:', err)
    return NextResponse.json({ error: 'Failed to pin that board' }, { status: 500 })
  }
}

/**
 * DELETE /api/pinspaces?boardId=… — unpin.
 *
 * No access check beyond ownership of the PIN: unpinning is removing your own
 * row, and someone who has lost access to a board must still be able to clear
 * the tile it left on their dashboard.
 */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await supabaseServer()
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const boardId = request.nextUrl.searchParams.get('boardId')?.trim()
    if (!boardId) {
      return NextResponse.json({ error: 'boardId is required' }, { status: 400 })
    }

    const { error } = await supabaseServiceRole()
      .from('pinned_boards')
      .delete()
      .eq('user_id', user.id)
      .eq('board_id', boardId)
    if (error) {
      console.error('Error unpinning board:', error)
      return NextResponse.json({ error: 'Failed to unpin that board' }, { status: 500 })
    }

    return NextResponse.json({ pinned: false })
  } catch (err) {
    console.error('Unexpected error unpinning board:', err)
    return NextResponse.json({ error: 'Failed to unpin that board' }, { status: 500 })
  }
}
