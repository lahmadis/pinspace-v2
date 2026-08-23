import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * POST /api/workspaces/[id]/rooms/reorder — bulk-set every room's
 * display_order to match a client-provided ordering.
 *
 * OWNER ONLY. Unlike room create/rename (which admit any workspace member),
 * reordering the whole list is a curation power reserved for the workspace
 * owner — the same primitive authorizeRoomMutation uses for its non-rename
 * (destructive/ordering) path, lifted to the workspace level.
 *
 * Body: { orderedRoomIds: string[] } — the FULL set of this workspace's room
 * ids in their new order. We require it to be EXACTLY the current set (same
 * length, same members, no dupes) before writing anything. A stale client that
 * omits a freshly-created room, includes a deleted one, or duplicates an id is
 * rejected with 400 rather than silently corrupting order via a partial write.
 *
 * display_order is derived PURELY from array position (0..N-1). Any numbers the
 * client might send are ignored — position is the only source of truth.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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

    const workspaceId = params.id
    const body = await request.json().catch(() => ({}))
    const orderedRoomIds: unknown = body?.orderedRoomIds

    if (!Array.isArray(orderedRoomIds) || orderedRoomIds.some((id) => typeof id !== 'string')) {
      return NextResponse.json(
        { error: 'orderedRoomIds must be an array of strings' },
        { status: 400 }
      )
    }
    const ordered = orderedRoomIds as string[]

    const admin = supabaseServiceRole()

    // Owner-only gate. Read via service role (workspaces RLS has no
    // membership-based SELECT policy) and enforce ownership in app code.
    const { data: workspace, error: wsError } = await admin
      .from('workspaces')
      .select('owner_id')
      .eq('id', workspaceId)
      .maybeSingle()
    if (wsError || !workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }
    if (workspace.owner_id !== userId) {
      return NextResponse.json(
        { error: 'Only workspace owners can reorder spaces' },
        { status: 403 }
      )
    }

    // Validate the payload is EXACTLY the current room set before touching the
    // DB — prevents drift and partial writes from a stale client.
    const { data: existingRooms, error: roomsError } = await admin
      .from('rooms')
      .select('id')
      .eq('workspace_id', workspaceId)
    if (roomsError) {
      console.error('Error loading rooms for reorder:', roomsError)
      return NextResponse.json({ error: 'Failed to load spaces' }, { status: 500 })
    }

    const existingIds = new Set((existingRooms ?? []).map((r) => r.id as string))
    const orderedUnique = new Set(ordered)
    const sameSet =
      ordered.length === existingIds.size &&
      orderedUnique.size === ordered.length &&
      ordered.every((id) => existingIds.has(id))
    if (!sameSet) {
      return NextResponse.json(
        { error: 'orderedRoomIds must be exactly the current set of spaces in this workspace' },
        { status: 400 }
      )
    }

    // Per-row UPDATEs — deliberately NOT an upsert. rooms.name and
    // rooms.workspace_id are NOT NULL; a partial-column upsert ({id,
    // display_order}) evaluates its INSERT path's constraints even when every
    // row already conflicts, so it fails with a NOT NULL violation (surfaces as
    // a 500). An UPDATE only ever touches display_order and never has an insert
    // path. N is small and this route is owner-only, so sequential writes —
    // scoped by workspace_id as defense-in-depth on top of the set-equality
    // validation above — are both safe and cheap.
    for (let index = 0; index < ordered.length; index++) {
      const id = ordered[index]
      const { error: updateError } = await admin
        .from('rooms')
        .update({ display_order: index })
        .eq('id', id)
        .eq('workspace_id', workspaceId)
      if (updateError) {
        console.error('Error reordering rooms:', updateError, { id, index })
        return NextResponse.json({ error: 'Failed to reorder spaces' }, { status: 500 })
      }
    }

    // Return the new ordered list so the client can reconcile if it wants.
    const { data: updatedRooms } = await admin
      .from('rooms')
      .select('id, name, display_order, is_published, published_at, created_at')
      .eq('workspace_id', workspaceId)
      .order('display_order', { ascending: true })
      .order('created_at', { ascending: true })

    return NextResponse.json({
      rooms: (updatedRooms ?? []).map((r) => ({
        id: r.id as string,
        name: r.name as string,
        displayOrder: Number(r.display_order ?? 0),
        isPublished: Boolean(r.is_published),
        publishedAt: (r.published_at as string | null) ?? null,
        createdAt: (r.created_at as string | null) ?? null,
      })),
    })
  } catch (error) {
    console.error('Unexpected error in POST /api/workspaces/[id]/rooms/reorder:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
