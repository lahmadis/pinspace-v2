import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/server'
import {
  resolveCanvasAccess,
  transformNode,
  isValidGeometry,
  isValidZ,
  isValidProps,
  readCappedJson,
  CANVAS_NODE_TYPES,
  type CanvasNodeRow,
} from '@/lib/canvas/access'

export const dynamic = 'force-dynamic'

// Canvas nodes — every object on one infinite canvas.
//
// Auth for both verbs is resolved by resolveCanvasAccess: owner OR member OR
// superadmin, or a guest token scoped to this canvas's room (drawing requires
// canTrace). Canvas content is private to the workspace; there is no public
// path. See lib/canvas/access.ts.

/** Read ceiling, as a backstop against an unbounded paging loop. */
const MAX_CANVAS_NODES = 20000

// GET /api/canvases/[id]/nodes — the whole canvas, in paint order.
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const result = await resolveCanvasAccess(request, params.id)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    // Paged deliberately. PostgREST caps an unbounded select at its db-max-rows
    // setting and returns the truncated set WITHOUT an error, so an unpaged
    // query would silently drop the tail of a busy canvas — and since ink is one
    // row per stroke, a real crit board reaches four figures easily. A canvas
    // that loses half its strokes on reload with no error is the worst possible
    // failure here, so we page until short.
    //
    // Ordering is (z, created_at, id): z alone leaves ties, and two clients that
    // break them differently stack overlapping nodes in different orders. The
    // tie break has to be total and stable — hence id last. It also has to be
    // total for paging to be correct, or rows can repeat or vanish across pages.
    const db = supabaseServiceRole()
    const PAGE = 1000
    const rows: CanvasNodeRow[] = []

    // Advances by data.length, NOT by PAGE. PostgREST caps a range at its
    // db-max-rows setting, so if that is ever lowered below PAGE the server
    // returns fewer rows than asked for — stepping by PAGE would then skip the
    // difference on every iteration, and `data.length < PAGE` would call it
    // done. Stepping by what actually arrived is correct for any cap.
    let from = 0
    while (from < MAX_CANVAS_NODES) {
      const { data, error } = await db
        .from('canvas_nodes')
        .select('*')
        .eq('canvas_id', params.id)
        .order('z', { ascending: true })
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1)

      if (error) {
        console.error('Error fetching canvas nodes:', error)
        return NextResponse.json({ error: 'Failed to fetch canvas nodes' }, { status: 500 })
      }
      const batch = (data || []) as CanvasNodeRow[]
      rows.push(...batch)
      // ONLY an empty page ends the loop. A short page is ambiguous — it means
      // either "table exhausted" or "the server capped this range below what we
      // asked for", and those need opposite responses. Breaking on short would
      // truncate silently in exactly the case the increment above exists to
      // survive, so the two would encode contradictory assumptions and the
      // stepping would be dead code. The cost of resolving it this way is one
      // extra empty request at the end of a full read.
      if (batch.length === 0) break
      from += batch.length
    }

    // If we ever hit the ceiling, say so in the log rather than quietly serving
    // a partial canvas — the same silent-truncation trap the paging avoids.
    if (rows.length >= MAX_CANVAS_NODES) {
      console.warn(`Canvas ${params.id} hit the ${MAX_CANVAS_NODES}-node read ceiling; result may be partial`)
    }

    return NextResponse.json({ nodes: rows.map(transformNode) })
  } catch (err) {
    console.error('Unexpected error fetching canvas nodes:', err)
    return NextResponse.json({ error: 'Failed to fetch canvas nodes' }, { status: 500 })
  }
}

// POST /api/canvases/[id]/nodes — create one node.
//
// `id` comes from the CLIENT so a newly drawn object can render and be
// addressed before the round-trip completes; same reason boards and traces do
// it. That makes this insert naturally idempotent under retry: a duplicate id
// conflicts rather than creating a second object.
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
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

    const { id, type, x, y, w, h, rotation, z, props, fromNodeId, toNodeId, authorName } = body as Record<string, unknown>

    if (typeof id !== 'string' || !id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }
    if (typeof type !== 'string' || !(CANVAS_NODE_TYPES as readonly string[]).includes(type)) {
      return NextResponse.json({ error: `type must be one of ${CANVAS_NODE_TYPES.join(', ')}` }, { status: 400 })
    }
    // Validated here so bad geometry is a 400 with a message rather than a 500
    // from the database's CHECK. The DB constraint remains the guarantee.
    for (const [key, value] of Object.entries({ x, y, w, h, rotation })) {
      if (value !== undefined && !isValidGeometry(value)) {
        return NextResponse.json({ error: `${key} must be a finite number within bounds` }, { status: 400 })
      }
    }
    if ((w !== undefined && (w as number) < 0) || (h !== undefined && (h as number) < 0)) {
      return NextResponse.json({ error: 'w and h must not be negative' }, { status: 400 })
    }
    // z is checked to INTEGER range, not merely finiteness: 3e9 is finite and
    // survives Math.trunc, then fails in Postgres as 22003 — a 500 for what is
    // really a bad request. Rejected rather than coerced so a client bug
    // surfaces here instead of silently flattening a node to layer 0, and so
    // POST and PATCH agree on what a valid z is.
    if (z !== undefined && !isValidZ(z)) {
      return NextResponse.json({ error: 'z must be a number within layer bounds' }, { status: 400 })
    }
    // props is JSONB, which accepts "str", 42 and [] just as happily as an
    // object — none of which match the Record<string, unknown> the client type
    // promises, so transformNode would hand every reader a lie.
    if (props !== undefined && !isValidProps(props)) {
      return NextResponse.json({ error: 'props must be an object' }, { status: 400 })
    }
    // Endpoints belong to connectors; the DB enforces this too.
    if ((fromNodeId != null || toNodeId != null) && type !== 'connector') {
      return NextResponse.json({ error: 'Only a connector may have endpoints' }, { status: 400 })
    }
    for (const [key, value] of Object.entries({ fromNodeId, toNodeId })) {
      if (value != null && (typeof value !== 'string' || !value)) {
        return NextResponse.json({ error: `${key} must be a node id` }, { status: 400 })
      }
    }

    const db = supabaseServiceRole()

    // Connector endpoints are verified to exist IN THIS CANVAS. Two reasons:
    // an id that doesn't exist raises 23503 and would surface as a 500, and an
    // id that exists in a different canvas would otherwise be accepted by the
    // FK — letting a connector reach across canvases and, once the client
    // resolves endpoints for drawing, leak the existence of another
    // workspace's nodes.
    const endpointIds = [fromNodeId, toNodeId].filter((v): v is string => typeof v === 'string')
    if (endpointIds.length > 0) {
      const { data: found, error: endpointError } = await db
        .from('canvas_nodes')
        .select('id')
        .eq('canvas_id', params.id)
        .in('id', endpointIds)

      if (endpointError) {
        console.error('Error validating connector endpoints:', endpointError)
        return NextResponse.json({ error: 'Failed to create canvas node' }, { status: 500 })
      }
      const present = new Set((found || []).map((r) => r.id as string))
      if (endpointIds.some((endpointId) => !present.has(endpointId))) {
        return NextResponse.json({ error: 'Connector endpoints must be nodes on this canvas' }, { status: 400 })
      }
    }

    // Attribution is resolved server-side for account holders — see the
    // authorName note on CanvasAccess. Only a guest, who has no profile to read,
    // may supply one, and only as an override of their token label.
    const supplied = typeof authorName === 'string' ? authorName.trim() : ''
    const name = access.guestTokenId
      ? (supplied || access.authorName).slice(0, 80)
      : access.authorName

    const { data, error } = await db
      .from('canvas_nodes')
      .insert({
        id,
        canvas_id: params.id,
        // From the canvas, never the request. See resolveCanvasAccess.
        room_id: access.roomId,
        type,
        x: (x as number) ?? 0,
        y: (y as number) ?? 0,
        w: (w as number) ?? 0,
        h: (h as number) ?? 0,
        rotation: (rotation as number) ?? 0,
        z: z === undefined ? 0 : Math.trunc(z as number),
        props: (props as Record<string, unknown>) ?? {},
        from_node_id: (fromNodeId as string) ?? null,
        to_node_id: (toNodeId as string) ?? null,
        author_id: access.authorId,
        guest_token_id: access.guestTokenId,
        author_name: name,
        updated_by: access.updatedBy,
      })
      .select('*')
      .single()

    if (error) {
      // 23505 = unique violation. Two very different situations share this code,
      // and conflating them is a data leak:
      //
      //   (a) This canvas already has the id — the client retried an insert that
      //       already landed. Return the existing node; the retry succeeded.
      //   (b) ANOTHER canvas has the id — canvas_nodes.id is a client-supplied
      //       TEXT primary key, so it is globally unique across every workspace.
      //       Returning that row would hand a caller a node out of a workspace
      //       they cannot read, and even a bare 200/404 split would make this an
      //       id-existence oracle. So the lookup is scoped to this canvas, and a
      //       miss is a flat 409 that says nothing about who holds the id.
      //
      // Scoping this select is what keeps the room_id derivation the rest of
      // this file is careful about from being defeated at the last step.
      if ((error as { code?: string }).code === '23505') {
        const { data: existing } = await db
          .from('canvas_nodes')
          .select('*')
          .eq('id', id)
          .eq('canvas_id', params.id)
          .maybeSingle()
        if (existing) {
          return NextResponse.json({ node: transformNode(existing as CanvasNodeRow) })
        }
        return NextResponse.json({ error: 'That node id is already taken' }, { status: 409 })
      }
      console.error('Error creating canvas node:', error)
      return NextResponse.json({ error: 'Failed to create canvas node' }, { status: 500 })
    }

    return NextResponse.json({ node: transformNode(data as CanvasNodeRow) })
  } catch (err) {
    console.error('Unexpected error creating canvas node:', err)
    return NextResponse.json({ error: 'Failed to create canvas node' }, { status: 500 })
  }
}
