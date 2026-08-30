import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/server'
import { resolveCanvasAccess } from '@/lib/canvas/access'
import { resolveDeskCritWorkspaceId } from '@/lib/deskCrits/workspace'

export const dynamic = 'force-dynamic'

/**
 * A desk crit's sheets — real boards, joined through crit_boards.
 *
 * They are boards and not canvas nodes so the LIGHTBOX can open them. Trace
 * strokes and callouts are keyed by boards.id (board_traces, board_comments),
 * so a crit sheet that was not a board could not be marked up at all — on the
 * one surface where marking up work is the entire point. See migration 042.
 *
 * Access rides resolveCanvasAccess, the same owner/member/guest resolution
 * every other canvas route uses, so a desk crit's privacy is decided in exactly
 * one place.
 */

/** Sparse ordering, so a sheet can be moved between two others later. */
const POSITION_STEP = 10

/** GET — the crit's sheets in display order, each with its pinned flag. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const critId = (await params).id
    const result = await resolveCanvasAccess(request, critId)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    const db = supabaseServiceRole()
    const { data: links, error } = await db
      .from('crit_boards')
      .select('board_id, pinned, position')
      .eq('crit_id', critId)
      .order('position', { ascending: true })

    if (error) {
      console.error('crit boards GET links error:', error)
      return NextResponse.json({ error: 'Failed to load sheets' }, { status: 500 })
    }

    const boardIds = (links ?? []).map((l) => l.board_id as string)
    if (boardIds.length === 0) return NextResponse.json({ boards: [] })

    const { data: boards, error: boardErr } = await db
      .from('boards')
      .select('*')
      .in('id', boardIds)

    if (boardErr) {
      console.error('crit boards GET boards error:', boardErr)
      return NextResponse.json({ error: 'Failed to load sheets' }, { status: 500 })
    }

    // Ordered by the JOIN's position, not by the boards query — `.in()` makes
    // no ordering promise, and the crit's running order is a property of the
    // crit, not of the board rows.
    const byId = new Map((boards ?? []).map((b) => [b.id as string, b]))
    const ordered = (links ?? [])
      .map((l) => {
        const b = byId.get(l.board_id as string)
        if (!b) return null
        return {
          id: b.id,
          workspaceId: b.workspace_id,
          studioId: b.workspace_id,
          studentName: b.student_name,
          title: b.title,
          description: b.description,
          thumbnailUrl: b.thumbnail_url,
          fullImageUrl: b.full_image_url,
          originalWidth: b.original_width,
          originalHeight: b.original_height,
          aspectRatio: b.aspect_ratio ? parseFloat(b.aspect_ratio) : undefined,
          uploadedAt: b.uploaded_at,
          ownerId: b.owner_id,
          ownerName: b.owner_name,
          pinned: Boolean(l.pinned),
        }
      })
      .filter(Boolean)

    return NextResponse.json({ boards: ordered })
  } catch (err) {
    console.error('crit boards GET error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

/**
 * POST — add a sheet to the crit from a finished direct upload.
 *
 * The bytes are already in storage (the client uses useDirectUpload, same as
 * every other upload path); this writes the board row and links it.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const critId = (await params).id
    const result = await resolveCanvasAccess(request, critId)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    const { access } = result
    if (!access.canWrite || !access.authorId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json().catch(() => null)
    const fullImageUrl = typeof body?.fullImageUrl === 'string' ? body.fullImageUrl : ''
    const thumbnailUrl = typeof body?.thumbnailUrl === 'string' ? body.thumbnailUrl : fullImageUrl
    if (!fullImageUrl) {
      return NextResponse.json({ error: 'fullImageUrl is required' }, { status: 400 })
    }
    const title = typeof body?.title === 'string' && body.title.trim()
      ? body.title.trim().slice(0, 200)
      : 'Sheet'

    const db = supabaseServiceRole()
    const workspaceId = await resolveDeskCritWorkspaceId(db, access.authorId)
    if (!workspaceId) {
      return NextResponse.json({ error: 'Could not resolve desk-crit workspace' }, { status: 500 })
    }

    // Same id shape the other upload paths mint, so nothing downstream has to
    // tell a crit sheet apart from any other board by its key.
    const boardId = `board-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    const { error: boardErr } = await db.from('boards').insert({
      id: boardId,
      workspace_id: workspaceId,
      owner_id: access.authorId,
      owner_name: access.authorName,
      student_name: access.authorName,
      title,
      thumbnail_url: thumbnailUrl,
      full_image_url: fullImageUrl,
      upload_status: 'complete',
      original_width: Number.isFinite(body?.width) ? body.width : null,
      original_height: Number.isFinite(body?.height) ? body.height : null,
    })

    if (boardErr) {
      console.error('crit boards POST board error:', boardErr)
      return NextResponse.json({ error: 'Failed to save sheet' }, { status: 500 })
    }

    const { data: last } = await db
      .from('crit_boards')
      .select('position')
      .eq('crit_id', critId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle()

    const { error: linkErr } = await db.from('crit_boards').insert({
      crit_id: critId,
      board_id: boardId,
      position: ((last?.position as number | undefined) ?? 0) + POSITION_STEP,
    })

    if (linkErr) {
      // The board exists but is in no crit, which would leave it orphaned in a
      // workspace nothing lists. Delete it rather than leak it.
      await db.from('boards').delete().eq('id', boardId)
      console.error('crit boards POST link error:', linkErr)
      return NextResponse.json({ error: 'Failed to add sheet to crit' }, { status: 500 })
    }

    return NextResponse.json({ boardId }, { status: 201 })
  } catch (err) {
    console.error('crit boards POST error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
