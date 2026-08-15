import { NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/** GET /api/network/shared/[workspaceId] — returns a shared workspace and its rooms.
 *  Returns 404 if the workspace doesn't exist, isn't type='shared', or the caller
 *  is neither the owner nor a member.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params
  try {
    const supabase = await supabaseServer()
    const { data: { user }, error: userErr } = await supabase.auth.getUser()
    if (userErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = supabaseServiceRole()

    const { data: workspace } = await admin
      .from('workspaces')
      .select('id, name, owner_id')
      .eq('id', workspaceId)
      .eq('type', 'shared')
      .maybeSingle()

    if (!workspace) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    if ((workspace.owner_id as string) !== user.id) {
      const { data: membership } = await admin
        .from('workspace_members')
        .select('user_id')
        .eq('workspace_id', workspaceId)
        .eq('user_id', user.id)
        .maybeSingle()

      if (!membership) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }
    }

    const { data: rooms, error: roomsErr } = await admin
      .from('rooms')
      .select('id, name')
      .eq('workspace_id', workspaceId)
      .order('display_order', { ascending: true })

    if (roomsErr) {
      console.error('network/shared/[workspaceId] GET rooms error:', roomsErr)
      return NextResponse.json({ error: 'Failed to fetch rooms' }, { status: 500 })
    }

    const roomIds = (rooms ?? []).map((r) => r.id as string)
    const boardCountMap: Record<string, number> = {}

    if (roomIds.length > 0) {
      const { data: boardRows } = await admin
        .from('boards')
        .select('room_id')
        .in('room_id', roomIds)
      for (const row of boardRows ?? []) {
        const k = row.room_id as string
        boardCountMap[k] = (boardCountMap[k] ?? 0) + 1
      }
    }

    return NextResponse.json({
      workspace: { id: workspace.id as string, name: workspace.name as string },
      rooms: (rooms ?? []).map((r) => ({
        id: r.id as string,
        name: r.name as string,
        boardCount: boardCountMap[r.id as string] ?? 0,
      })),
    })
  } catch (err) {
    console.error('network/shared/[workspaceId] GET error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
