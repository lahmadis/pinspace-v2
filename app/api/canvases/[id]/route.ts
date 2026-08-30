import { NextRequest, NextResponse } from 'next/server'
import { normaliseCritPhase } from '@/lib/constants/critPhases'
import { supabaseServiceRole } from '@/lib/supabase/server'
import { resolveCanvasAccess, readCappedJson } from '@/lib/canvas/access'

export const dynamic = 'force-dynamic'

// One canvas: read its title (GET), rename it (PATCH), remove it (DELETE).
//
// Access for all three is resolveCanvasAccess, which picks the room or the
// personal branch off the row itself — so a personal desk crit is reachable
// only by its owner without this file having to know that.

function transformCanvas(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    roomId: (row.room_id as string) ?? null,
    ownerId: (row.owner_id as string) ?? null,
    title: (row.title as string) ?? '',
    createdBy: (row.created_by as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const result = await resolveCanvasAccess(request, (await params).id)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    const { data, error } = await supabaseServiceRole()
      .from('canvases')
      .select('*')
      .eq('id', (await params).id)
      .maybeSingle()

    if (error) {
      console.error('Error fetching canvas:', error)
      return NextResponse.json({ error: 'Failed to fetch canvas' }, { status: 500 })
    }
    // resolveCanvasAccess already 404s on a missing row; reaching here means it
    // was deleted between the two reads.
    if (!data) return NextResponse.json({ error: 'Canvas not found' }, { status: 404 })

    return NextResponse.json({ canvas: transformCanvas(data) })
  } catch (err) {
    console.error('Unexpected error fetching canvas:', err)
    return NextResponse.json({ error: 'Failed to fetch canvas' }, { status: 500 })
  }
}

/**
 * Rename and delete are confined to PERSONAL canvases.
 *
 * Not an oversight — a deliberate narrowing. On a room canvas `canWrite` is
 * true for every workspace member and every superadmin, so without this a
 * member could permanently delete a space's shared canvas and cascade away
 * every node on it. That capability did not exist before this route did, and
 * nothing in the product asks for it: the room canvas has no rename or delete
 * UI, and desk crits are the only surface that needs either verb.
 *
 * Widening it later means deciding who owns a shared canvas — the creator, the
 * workspace owner, any member — which is a real question, not a default.
 */
function ownsPersonally(access: { ownerId: string | null; authorId: string | null }): boolean {
  return Boolean(access.ownerId) && access.ownerId === access.authorId
}

// PATCH — rename. Title is the only mutable field: room_id and owner_id are the
// ACCESS ANCHORS, and letting a client move a canvas between them would be a
// visibility change dressed up as an edit.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const result = await resolveCanvasAccess(request, (await params).id)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    const { access } = result
    // authorId as well as canWrite: a guest token can carry canTrace, which
    // means "may mark up work", not "may rename the surface it sits on". Same
    // line the create route draws. And personal-only — see ownsPersonally.
    if (!access.canWrite || !access.authorId || !ownsPersonally(access)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const parsed = await readCappedJson(request)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status })
    }
    const { title, phase, project } = parsed.body

    // Either field, or both. Renaming and re-phasing are separate gestures on
    // the card, and requiring the title on a phase change would make the
    // dropdown able to overwrite a rename that happened between renders.
    const patch: Record<string, string | null> = {}
    if (title !== undefined) {
      if (typeof title !== 'string' || !title.trim()) {
        return NextResponse.json({ error: 'title must not be empty' }, { status: 400 })
      }
      patch.title = title.trim().slice(0, 200)
    }
    if (phase !== undefined) {
      // Any usable label, not just one off the list: the dropdown's "Other…"
      // entry exists so a studio can file a crit under the phase it actually
      // ran. normaliseCritPhase trims it, caps it and folds a typed "final
      // review" back onto the listed spelling — see its note.
      const cleaned = normaliseCritPhase(phase)
      if (!cleaned) {
        return NextResponse.json({ error: 'phase must not be empty' }, { status: 400 })
      }
      patch.phase = cleaned
    }
    if (project !== undefined) {
      if (typeof project !== 'string') {
        return NextResponse.json({ error: 'project must be text' }, { status: 400 })
      }
      // '' clears it. Sent as null so "no project" has one representation.
      patch.project = project.trim() ? project.trim().slice(0, 120) : null
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }

    const { data, error } = await supabaseServiceRole()
      .from('canvases')
      .update(patch)
      .eq('id', (await params).id)
      .select('*')
      .maybeSingle()

    if (error) {
      console.error('Error renaming canvas:', error)
      return NextResponse.json({ error: 'Failed to rename canvas' }, { status: 500 })
    }
    if (!data) return NextResponse.json({ error: 'Canvas not found' }, { status: 404 })

    return NextResponse.json({ canvas: transformCanvas(data) })
  } catch (err) {
    console.error('Unexpected error renaming canvas:', err)
    return NextResponse.json({ error: 'Failed to rename canvas' }, { status: 500 })
  }
}

// DELETE — remove the canvas and, by cascade, every node on it.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const result = await resolveCanvasAccess(request, (await params).id)
    if (!result.ok) {
      // Idempotent on a missing canvas: a retry after a dropped response should
      // not surface an error for work that already succeeded. 403 still stands.
      if (result.status === 404) return NextResponse.json({ ok: true })
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    const { access } = result
    if (!access.canWrite || !access.authorId || !ownsPersonally(access)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // canvas_nodes.canvas_id is ON DELETE CASCADE (migration 036), so the nodes
    // go with it.
    //
    // Their DELETE events are NOT reliably delivered, though. Migration 038's
    // node policy resolves through a subquery against `canvases`, and that row
    // is gone in the same transaction — so a second tab watching this canvas is
    // starved of exactly the events telling it the canvas emptied. Harmless
    // here: the tab that issued this navigates away, and any other is showing a
    // canvas that no longer exists and will 404 on its next load.
    const { error } = await supabaseServiceRole()
      .from('canvases')
      .delete()
      .eq('id', (await params).id)

    if (error) {
      console.error('Error deleting canvas:', error)
      return NextResponse.json({ error: 'Failed to delete canvas' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Unexpected error deleting canvas:', err)
    return NextResponse.json({ error: 'Failed to delete canvas' }, { status: 500 })
  }
}
