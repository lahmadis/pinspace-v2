// TODO: unused, can be deleted. Wentworth network is served by /explore.
import { NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/** GET /api/network/wentworth — returns all class workspaces in the caller's organization. */
export async function GET() {
  try {
    const supabase = await supabaseServer()
    const { data: { user }, error: userErr } = await supabase.auth.getUser()
    if (userErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = supabaseServiceRole()

    // Get user's organization_id
    const { data: profile, error: profileErr } = await admin
      .from('user_profiles')
      .select('organization_id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (profileErr) {
      console.error('network/wentworth GET profile error:', profileErr)
      return NextResponse.json({ error: 'Failed to fetch profile' }, { status: 500 })
    }

    const orgId: string | null = profile?.organization_id ?? null
    if (!orgId) {
      return NextResponse.json({ workspaces: [], orgName: null })
    }

    // Fetch org name
    const { data: org } = await admin
      .from('organizations')
      .select('name')
      .eq('id', orgId)
      .maybeSingle()

    // Fetch all class workspaces in this organization
    const { data: workspaces, error: wsErr } = await admin
      .from('workspaces')
      .select('id, name, created_at')
      .eq('organization_id', orgId)
      .eq('type', 'class')
      .order('created_at', { ascending: false })

    if (wsErr) {
      console.error('network/wentworth GET workspaces error:', wsErr)
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
      orgName: org?.name ?? null,
      workspaces: (workspaces ?? []).map((w) => ({
        id: w.id as string,
        name: w.name as string,
        subRoomCount: roomCountMap[w.id as string] ?? 0,
        createdAt: w.created_at as string,
      })),
    })
  } catch (err) {
    console.error('network/wentworth GET error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
