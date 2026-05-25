import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'
import { validateName } from '@/lib/validation/safeName'

export const dynamic = 'force-dynamic'

/**
 * POST /api/workspaces/[id]/rooms — create a new room in this workspace.
 * Workspace owner only. New room's display_order is max(existing)+1 so it
 * appears at the bottom of the list. Returns the created room.
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
    const nameResult = validateName(body?.name, { maxLength: 100, fieldLabel: 'Room name' })
    if (!nameResult.ok) {
      return NextResponse.json({ error: nameResult.error }, { status: 400 })
    }
    const rawName = nameResult.value

    const admin = supabaseServiceRole()
    const { data: workspace, error: wsError } = await admin
      .from('workspaces')
      .select('owner_id')
      .eq('id', workspaceId)
      .maybeSingle()

    if (wsError || !workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }
    if (workspace.owner_id !== userId) {
      return NextResponse.json({ error: 'Only workspace owners can create rooms' }, { status: 403 })
    }

    // Resolve next display_order. Reading max+1 isn't strictly serializable —
    // two concurrent inserts could race and produce duplicates — but display_order
    // isn't a unique key, so the worst case is two rooms ordering arbitrarily
    // among themselves until someone reorders. Acceptable for instructor flows.
    const { data: existingRooms } = await admin
      .from('rooms')
      .select('display_order')
      .eq('workspace_id', workspaceId)
      .order('display_order', { ascending: false })
      .limit(1)
    const nextOrder = existingRooms && existingRooms.length > 0
      ? Number(existingRooms[0].display_order ?? 0) + 1
      : 0

    const { data: room, error: insertError } = await admin
      .from('rooms')
      .insert({
        workspace_id: workspaceId,
        name: rawName,
        display_order: nextOrder,
      })
      .select()
      .single()

    if (insertError || !room) {
      console.error('Error creating room:', insertError)
      return NextResponse.json({ error: 'Failed to create room' }, { status: 500 })
    }

    return NextResponse.json({ room }, { status: 201 })
  } catch (error) {
    console.error('Unexpected error in POST /api/workspaces/[id]/rooms:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
