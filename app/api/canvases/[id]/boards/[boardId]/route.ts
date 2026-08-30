import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/server'
import { resolveCanvasAccess } from '@/lib/canvas/access'

export const dynamic = 'force-dynamic'

/**
 * One sheet's membership of one crit: pin it, or take it out.
 *
 * `pinned` lives on the JOIN and not on the board because it is a fact about
 * this sheet's role in THIS crit — "we talked about this one" — and not about
 * the image. Putting it on boards would have made every surface in the app
 * carry a column that only the desk crit means anything by.
 */

/** PATCH — toggle whether this sheet was pinned during the crit. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; boardId: string }> }
) {
  try {
    const { id: critId, boardId } = await params
    const result = await resolveCanvasAccess(request, critId)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    if (!result.access.canWrite) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json().catch(() => null)
    if (typeof body?.pinned !== 'boolean') {
      return NextResponse.json({ error: 'pinned must be a boolean' }, { status: 400 })
    }

    const db = supabaseServiceRole()
    // Scoped by crit_id as well as board_id: the pair is the primary key, and
    // matching on board alone would repin the same sheet in another crit.
    const { data, error } = await db
      .from('crit_boards')
      .update({ pinned: body.pinned })
      .eq('crit_id', critId)
      .eq('board_id', boardId)
      .select('board_id')
      .maybeSingle()

    if (error) {
      console.error('crit board PATCH error:', error)
      return NextResponse.json({ error: 'Failed to update sheet' }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json({ error: 'Sheet not in this crit' }, { status: 404 })
    }

    return NextResponse.json({ ok: true, pinned: body.pinned })
  } catch (err) {
    console.error('crit board PATCH error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

/**
 * DELETE — remove a sheet from the crit, and delete the board with it.
 *
 * A crit sheet has exactly one home: it was uploaded into this crit and lives
 * in the desk-crit workspace, which nothing else lists. Unlinking alone would
 * leave the board in a container no surface shows — unreachable, undeletable,
 * still paying for its storage. So the row goes too, and its image bytes go
 * with it the way any board delete works.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; boardId: string }> }
) {
  try {
    const { id: critId, boardId } = await params
    const result = await resolveCanvasAccess(request, critId)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    if (!result.access.canWrite) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const db = supabaseServiceRole()

    // Confirm the sheet is actually in THIS crit before deleting the board —
    // otherwise a crit you can write to would be a way to delete any board id
    // you can guess.
    const { data: link } = await db
      .from('crit_boards')
      .select('board_id')
      .eq('crit_id', critId)
      .eq('board_id', boardId)
      .maybeSingle()

    if (!link) {
      return NextResponse.json({ error: 'Sheet not in this crit' }, { status: 404 })
    }

    // crit_boards cascades from boards (migration 042), so deleting the board
    // removes the link as well.
    const { error } = await db.from('boards').delete().eq('id', boardId)
    if (error) {
      console.error('crit board DELETE error:', error)
      return NextResponse.json({ error: 'Failed to remove sheet' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('crit board DELETE error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
