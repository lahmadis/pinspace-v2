import { NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/** GET /api/network/personal — returns the calling user's personal workspaces with sub-room counts. */
export async function GET() {
  try {
    const supabase = await supabaseServer()
    const { data: { user }, error: userErr } = await supabase.auth.getUser()
    if (userErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = supabaseServiceRole()

    const { data: workspaces, error: wsErr } = await admin
      .from('workspaces')
      .select('id, name, created_at')
      .eq('owner_id', user.id)
      .eq('type', 'personal')
      .order('created_at', { ascending: false })

    if (wsErr) {
      console.error('network/personal GET workspaces error:', wsErr)
      return NextResponse.json({ error: 'Failed to fetch workspaces' }, { status: 500 })
    }

    const wsIds = (workspaces ?? []).map((w) => w.id as string)
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
      workspaces: (workspaces ?? []).map((w) => ({
        id: w.id as string,
        name: w.name as string,
        subRoomCount: roomCountMap[w.id as string] ?? 0,
        createdAt: w.created_at as string,
      })),
    })
  } catch (err) {
    console.error('network/personal GET error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
