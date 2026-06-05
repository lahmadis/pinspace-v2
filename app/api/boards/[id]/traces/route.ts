import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'
import { isSuperadmin } from '@/lib/auth/superadmin'

export const dynamic = 'force-dynamic'

// Trace layer: per-author freehand drawing over a board, stored as JSON strokes
// in image-fraction coords (resolution-independent). Privacy + auth gates mirror
// board-comments exactly:
//   GET    → session required; workspace owner OR member OR superadmin, else 403.
//            No public path. (Phase A.5 will add a guest_token path.)
//   PUT    → session required (401); owner OR member OR superadmin. Upserts the
//            CURRENT USER's single row for this board.
//   DELETE → session required (401); clears the current user's own row only.
// One row per (board, author) — enforced by board_traces_board_author_ux. The
// upsert is manual (select-then-update/insert) because that unique index is a
// functional expression, not a plain column set `onConflict` can target.

const MAX_PAYLOAD_BYTES = 1_000_000 // 1 MB cap on the request body

interface BoardTraceRow {
  id: string
  board_id: string
  room_id: string
  author_id: string | null
  guest_token_id: string | null
  author_name: string
  author_color: string | null
  strokes: unknown
  created_at: string
  updated_at: string
}

function transformRow(t: BoardTraceRow) {
  return {
    id: t.id,
    boardId: t.board_id,
    roomId: t.room_id,
    authorId: t.author_id,
    guestTokenId: t.guest_token_id,
    authorName: t.author_name,
    authorColor: t.author_color,
    strokes: Array.isArray(t.strokes) ? t.strokes : [],
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  }
}

// Validate + normalize strokes: array of { color, width, points: [[x,y],...] }
// with x,y in 0..1. Strips any extra fields so only the known shape is stored.
function normalizeStrokes(
  input: unknown
): { strokes?: Array<{ color: string; width: number; points: [number, number][] }>; error?: string } {
  if (!Array.isArray(input)) return { error: 'strokes must be an array' }
  const out: Array<{ color: string; width: number; points: [number, number][] }> = []
  for (const s of input) {
    if (!s || typeof s !== 'object') return { error: 'each stroke must be an object' }
    const stroke = s as Record<string, unknown>
    if (typeof stroke.color !== 'string') return { error: 'stroke.color must be a string' }
    if (typeof stroke.width !== 'number' || !Number.isFinite(stroke.width) || stroke.width <= 0) {
      return { error: 'stroke.width must be a positive number' }
    }
    if (!Array.isArray(stroke.points)) return { error: 'stroke.points must be an array' }
    const points: [number, number][] = []
    for (const p of stroke.points) {
      if (!Array.isArray(p) || p.length !== 2) return { error: 'each point must be [x, y]' }
      const x = p[0]
      const y = p[1]
      if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
        return { error: 'point coords must be finite numbers' }
      }
      if (x < 0 || x > 1 || y < 0 || y > 1) return { error: 'point coords must be within 0..1' }
      points.push([x, y])
    }
    out.push({ color: stroke.color.slice(0, 32), width: stroke.width, points })
  }
  return { strokes: out }
}

// GET /api/boards/[id]/traces — all traces for the board (every author's layer).
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const boardId = params.id

    const supabase = supabaseServer()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    const userId = session?.user?.id
    if (!userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

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

    const { data: traces, error } = await serviceSupabase
      .from('board_traces')
      .select('*')
      .eq('board_id', boardId)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('Error fetching board traces:', error)
      return NextResponse.json({ error: 'Failed to fetch traces' }, { status: 500 })
    }

    return NextResponse.json({
      traces: (traces || []).map((t) => transformRow(t as BoardTraceRow)),
    })
  } catch (error) {
    console.error('Error fetching board traces:', error)
    return NextResponse.json({ error: 'Failed to fetch traces' }, { status: 500 })
  }
}

// PUT /api/boards/[id]/traces — upsert the current user's single trace row.
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const boardId = params.id

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

    const rawBody = await request.text()
    if (rawBody.length > MAX_PAYLOAD_BYTES) {
      return NextResponse.json({ error: 'Trace payload too large (max 1 MB)' }, { status: 413 })
    }
    let body: { strokes?: unknown; authorColor?: unknown }
    try {
      body = JSON.parse(rawBody)
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const { strokes, error: strokesError } = normalizeStrokes(body?.strokes)
    if (strokesError || !strokes) {
      return NextResponse.json({ error: strokesError || 'Invalid strokes' }, { status: 400 })
    }
    const authorColor = typeof body?.authorColor === 'string' ? body.authorColor.slice(0, 32) : null

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
    const roomId = board.room_id as string | null
    if (!roomId) {
      return NextResponse.json({ error: 'Board has no room' }, { status: 404 })
    }

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

    // author_name from profile (mirrors board-comments POST).
    const { data: userProfile } = await admin
      .from('user_profiles')
      .select('full_name')
      .eq('user_id', userId)
      .maybeSingle()
    const profileName = userProfile?.full_name?.trim() || null
    const authorName = profileName || session.user.email?.split('@')[0] || 'Anonymous'

    // Manual upsert keyed by (board_id, author_id) — the unique index is a
    // functional expression, so we select-then-update/insert.
    const { data: existing } = await admin
      .from('board_traces')
      .select('id')
      .eq('board_id', boardId)
      .eq('author_id', userId)
      .maybeSingle()

    let row: BoardTraceRow | null = null
    if (existing) {
      const { data: updated, error: updateError } = await admin
        .from('board_traces')
        .update({
          strokes,
          author_color: authorColor,
          author_name: authorName,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select()
        .single()
      if (updateError || !updated) {
        console.error('Error updating board trace:', updateError)
        return NextResponse.json({ error: 'Failed to save trace' }, { status: 500 })
      }
      row = updated as BoardTraceRow
    } else {
      const traceId = `bt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
      const { data: inserted, error: insertError } = await admin
        .from('board_traces')
        .insert({
          id: traceId,
          board_id: boardId,
          room_id: roomId,
          author_id: userId,
          author_name: authorName,
          author_color: authorColor,
          strokes,
        })
        .select()
        .single()
      if (insertError || !inserted) {
        console.error('Error inserting board trace:', insertError)
        return NextResponse.json({ error: 'Failed to save trace' }, { status: 500 })
      }
      row = inserted as BoardTraceRow
    }

    return NextResponse.json({ trace: transformRow(row), success: true })
  } catch (error) {
    console.error('Error saving board trace:', error)
    return NextResponse.json({ error: 'Failed to save trace' }, { status: 500 })
  }
}

// DELETE /api/boards/[id]/traces — clear the current user's own trace.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const boardId = params.id

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

    // Author-scoped: the WHERE clause restricts deletion to the caller's own row.
    const admin = supabaseServiceRole()
    const { error } = await admin
      .from('board_traces')
      .delete()
      .eq('board_id', boardId)
      .eq('author_id', userId)

    if (error) {
      console.error('Error deleting board trace:', error)
      return NextResponse.json({ error: 'Failed to clear trace' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting board trace:', error)
    return NextResponse.json({ error: 'Failed to clear trace' }, { status: 500 })
  }
}
