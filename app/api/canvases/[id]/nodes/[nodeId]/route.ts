import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/server'
import {
  resolveCanvasAccess,
  transformNode,
  isValidGeometry,
  isValidZ,
  isValidProps,
  readCappedJson,
  type CanvasAccess,
  type CanvasNodeRow,
} from '@/lib/canvas/access'

export const dynamic = 'force-dynamic'

// One canvas node: move/resize/edit (PATCH) and remove (DELETE).
//
// Concurrency is last-write-wins per NODE — see the header of migration 036 for
// why that's the right trade for direct manipulation, and why the alternative
// (one JSON document per canvas, as wall-config does) would conflict constantly
// during a live crit. There is no version check here on purpose: whoever is
// dragging a thing right now should win. `updated_at` is maintained by a
// database trigger, so ordering uses server time rather than client clocks.

/** Fields a PATCH may set. Anything else in the body is ignored. */
const PATCHABLE_GEOMETRY = ['x', 'y', 'w', 'h', 'rotation'] as const

/**
 * Who may modify an existing node.
 *
 * Account holders — owner, members, superadmin — may edit anything on the
 * canvas. That is the point of a shared surface: rearranging someone's sticky
 * during a crit is collaboration, and the workspace already decides who gets in.
 *
 * GUESTS are confined to their own rows. A guest token is a link handed to an
 * outside critic; `canTrace` lets them mark up work, not reorganise or delete
 * the studio's record of it. board_traces already draws the line exactly here,
 * so letting a guest edit every node would be a widening of an existing rule
 * rather than a new surface's own choice.
 */
function scopeToWriter<T extends { eq(col: string, val: string): T }>(query: T, access: CanvasAccess): T {
  return access.guestTokenId ? query.eq('guest_token_id', access.guestTokenId) : query
}

/**
 * Distinguish "no such node" from "not yours" AFTER a write matched nothing.
 *
 * Only reached on the miss path, so it costs a query only when something has
 * already gone wrong. A guest who aims at someone else's node gets 403 rather
 * than a 404 that would wrongly suggest the node is gone.
 */
async function explainMiss(canvasId: string, nodeId: string): Promise<NextResponse> {
  const { data: exists } = await supabaseServiceRole()
    .from('canvas_nodes')
    .select('id')
    .eq('id', nodeId)
    .eq('canvas_id', canvasId)
    .maybeSingle()
  return exists
    ? NextResponse.json({ error: 'You can only change your own items' }, { status: 403 })
    : NextResponse.json({ error: 'Node not found' }, { status: 404 })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; nodeId: string } }
) {
  try {
    const result = await resolveCanvasAccess(request, params.id)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    const { access } = result
    if (!access.canWrite) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const parsed = await readCappedJson(request)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status })
    }
    const body = parsed.body

    const patch: Record<string, unknown> = { updated_by: access.updatedBy }

    for (const key of PATCHABLE_GEOMETRY) {
      const value = body[key]
      if (value === undefined) continue
      if (!isValidGeometry(value)) {
        return NextResponse.json({ error: `${key} must be a finite number within bounds` }, { status: 400 })
      }
      if ((key === 'w' || key === 'h') && value < 0) {
        return NextResponse.json({ error: `${key} must not be negative` }, { status: 400 })
      }
      patch[key] = value
    }

    // z is bounded to INTEGER range, not just checked for finiteness — the
    // column is INTEGER, so 3e9 would pass Number.isFinite and then fail in
    // Postgres as 22003, turning a bad request into a 500.
    const z = body.z
    if (z !== undefined) {
      if (!isValidZ(z)) {
        return NextResponse.json({ error: 'z must be a number within layer bounds' }, { status: 400 })
      }
      patch.z = Math.trunc(z)
    }

    const props = body.props
    if (props !== undefined) {
      if (!isValidProps(props)) {
        return NextResponse.json({ error: 'props must be an object' }, { status: 400 })
      }
      // Replaced wholesale, not merged. A merge would make "remove a key"
      // unexpressible, and the client always holds the full node anyway.
      patch.props = props
    }

    // canvas_id, room_id, type, id and authorship are deliberately NOT
    // patchable. room_id in particular is what the realtime SELECT policies
    // pivot on, so letting a client move a node between rooms would be a
    // visibility hole, not a feature. author_name is not patchable either —
    // attribution is stamped at creation from the server's own resolution.

    // Scoped by canvas_id as well as id so a node id from another canvas can't
    // be edited through a canvas the caller happens to have access to, and by
    // writer so a guest reaches only their own rows.
    const { data, error } = await scopeToWriter(
      supabaseServiceRole()
        .from('canvas_nodes')
        .update(patch)
        .eq('id', params.nodeId)
        .eq('canvas_id', params.id),
      access
    )
      .select('*')
      .maybeSingle()

    if (error) {
      console.error('Error updating canvas node:', error)
      return NextResponse.json({ error: 'Failed to update canvas node' }, { status: 500 })
    }
    if (!data) {
      return explainMiss(params.id, params.nodeId)
    }

    return NextResponse.json({ node: transformNode(data as CanvasNodeRow) })
  } catch (err) {
    console.error('Unexpected error updating canvas node:', err)
    return NextResponse.json({ error: 'Failed to update canvas node' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; nodeId: string } }
) {
  try {
    const result = await resolveCanvasAccess(request, params.id)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    const { access } = result
    if (!access.canWrite) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Any connectors attached to this node go with it, via the self-referencing
    // FK's ON DELETE CASCADE (migration 036) — the database emits their DELETE
    // events too, so subscribers see the connectors disappear without the
    // client having to find and remove them.
    //
    // KNOWN LIMIT of the guest confinement below: that cascade is the database's
    // and does not consult authorship, so a guest deleting their OWN node also
    // removes an account holder's connector attached to it. Confinement holds
    // for the node itself, not for what the schema hangs off it. Left as-is
    // because the alternative — refusing the delete, or orphaning connectors —
    // is worse than losing a line that had nothing left to point at.
    //
    // .select() so we can tell "deleted" from "matched nothing"; without it a
    // guest aiming at someone else's node would get a cheerful 200 and no
    // deletion, which is worse than an error.
    const { data, error } = await scopeToWriter(
      supabaseServiceRole()
        .from('canvas_nodes')
        .delete()
        .eq('id', params.nodeId)
        .eq('canvas_id', params.id),
      access
    ).select('id')

    if (error) {
      console.error('Error deleting canvas node:', error)
      return NextResponse.json({ error: 'Failed to delete canvas node' }, { status: 500 })
    }

    // Idempotent: deleting an already-deleted node is a success, so a retry
    // after a dropped response doesn't surface an error. explainMiss keeps that
    // true while still refusing a guest who aimed at a node that IS there but
    // isn't theirs.
    if (!data || data.length === 0) {
      const miss = await explainMiss(params.id, params.nodeId)
      if (miss.status === 403) return miss
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Unexpected error deleting canvas node:', err)
    return NextResponse.json({ error: 'Failed to delete canvas node' }, { status: 500 })
  }
}
