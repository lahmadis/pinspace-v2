import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'
import { validateName } from '@/lib/validation/safeName'
import { DEFAULT_WALL_CONFIG } from '@/lib/wallLayout'

const CONFIG_BUCKET = 'board-images'
const CONFIG_PREFIX = 'wall-configs'

/**
 * Seed a fresh per-room wall-config blob so the new room doesn't fall back to
 * the workspace's legacy blob (which would inherit a sibling room's edits).
 * Best-effort: a storage failure here is logged but does not fail the room
 * insert. The wall-config GET treats a missing blob as "use defaults" anyway.
 */
async function seedDefaultWallConfig(workspaceId: string, roomId: string): Promise<void> {
  try {
    const admin = supabaseServiceRole()
    const filePath = `${CONFIG_PREFIX}/${workspaceId}/${roomId}.json`
    const blob = { ...DEFAULT_WALL_CONFIG, version: 0 }
    const payload = Buffer.from(JSON.stringify(blob), 'utf-8')
    const { error } = await admin.storage.from(CONFIG_BUCKET).upload(filePath, payload, {
      upsert: true,
      contentType: 'application/json',
    })
    if (error) console.warn('Failed to seed default wall config for new room', { workspaceId, roomId, error })
  } catch (err) {
    console.warn('Unexpected error seeding default wall config', { workspaceId, roomId, err })
  }
}

export const dynamic = 'force-dynamic'

/**
 * POST /api/workspaces/[id]/rooms — create a new room in this workspace.
 *
 * Allowed for: the workspace owner OR anyone with a workspace_members row
 * (regardless of role). Shared projects add collaborators as `student`-role
 * members via the join route, so a strict instructor-only check would lock
 * them out of adding rooms to a project they're collaborating on. Class
 * workspaces still hide the "+ New Room" affordance from non-instructor
 * members in the UI, so functional class behavior is unchanged — a student
 * with the gumption to curl this endpoint directly would now succeed,
 * matching the wall-config route's existing membership check.
 *
 * New room's display_order is max(existing)+1 so it appears at the bottom
 * of the list. Returns the created room.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await supabaseServer()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = user.id

    const workspaceId = (await params).id
    const body = await request.json().catch(() => ({}))
    const nameResult = validateName(body?.name, { maxLength: 100, fieldLabel: 'Space name' })
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
      const { data: membership } = await admin
        .from('workspace_members')
        .select('user_id')
        .eq('workspace_id', workspaceId)
        .eq('user_id', userId)
        .maybeSingle()
      if (!membership) {
        return NextResponse.json({ error: 'Not a member of this workspace' }, { status: 403 })
      }
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
      return NextResponse.json({ error: 'Failed to create space' }, { status: 500 })
    }

    await seedDefaultWallConfig(workspaceId, room.id as string)

    return NextResponse.json({ room }, { status: 201 })
  } catch (error) {
    console.error('Unexpected error in POST /api/workspaces/[id]/rooms:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
