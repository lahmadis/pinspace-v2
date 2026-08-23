import { NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/** GET /api/network/shared — returns shared workspaces the caller owns or is a member of. */
export async function GET() {
  try {
    const supabase = supabaseServer()
    const { data: { user }, error: userErr } = await supabase.auth.getUser()
    if (userErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = supabaseServiceRole()

    const { data: owned, error: ownedErr } = await admin
      .from('workspaces')
      .select('id, name, created_at')
      .eq('type', 'shared')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: false })

    if (ownedErr) {
      console.error('network/shared GET owned error:', ownedErr)
      return NextResponse.json({ error: 'Failed to fetch workspaces' }, { status: 500 })
    }

    const { data: memberRows } = await admin
      .from('workspace_members')
      .select('workspace_id')
      .eq('user_id', user.id)

    const memberIds = (memberRows ?? []).map((r) => r.workspace_id as string)
    let memberWorkspaces: { id: string; name: string; created_at: string }[] = []

    if (memberIds.length > 0) {
      const { data: mws, error: mwsErr } = await admin
        .from('workspaces')
        .select('id, name, created_at')
        .eq('type', 'shared')
        .in('id', memberIds)

      if (mwsErr) {
        console.error('network/shared GET member workspaces error:', mwsErr)
        return NextResponse.json({ error: 'Failed to fetch workspaces' }, { status: 500 })
      }
      memberWorkspaces = mws ?? []
    }

    const all = Array.from(
      new Map(
        [...(owned ?? []), ...memberWorkspaces].map((w) => [w.id, w])
      ).values()
    )

    const wsIds = all.map((w) => w.id as string)
    const roomCountMap: Record<string, number> = {}

    if (wsIds.length > 0) {
      const { data: roomRows } = await admin
        .from('rooms')
        .select('workspace_id')
        .in('workspace_id', wsIds)
      for (const row of roomRows ?? []) {
        const k = row.workspace_id as string
        roomCountMap[k] = (roomCountMap[k] ?? 0) + 1
      }
    }

    return NextResponse.json({
      workspaces: all.map((w) => ({
        id: w.id as string,
        name: w.name as string,
        subRoomCount: roomCountMap[w.id as string] ?? 0,
        createdAt: w.created_at as string,
      })),
    })
  } catch (err) {
    console.error('network/shared GET error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
