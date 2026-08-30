import { NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * GET /api/network/personal — the caller's own spaces, with sub-room counts and
 * a derived `shared` flag.
 *
 * Owned OR joined, because a space someone shared WITH you is one of your
 * spaces and would otherwise be invisible here — the network page's Shared tab
 * is mostly those.
 *
 * Excludes 'deskcrit' too — that workspace is a container for desk-crit
 * sheets, not a space (see lib/deskCrits/workspace).
 *
 * `type not in (class, deskcrit)` rather than `type = 'personal'`: migration 041 folds the
 * old 'shared' type into 'personal' and is applied by hand, so until it runs
 * those rows still carry the old value and an equality check would drop them.
 */
export async function GET() {
  try {
    const supabase = await supabaseServer()
    const { data: { user }, error: userErr } = await supabase.auth.getUser()
    if (userErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = supabaseServiceRole()

    const { data: myMemberships } = await admin
      .from('workspace_members')
      .select('workspace_id')
      .eq('user_id', user.id)
    const joinedIds = (myMemberships ?? []).map((r) => r.workspace_id as string)

    const { data: ownedRows, error: wsErr } = await admin
      .from('workspaces')
      .select('id, name, created_at, owner_id, type')
      .eq('owner_id', user.id)
      .not('type', 'in', '(class,deskcrit)')

    if (wsErr) {
      console.error('network/personal GET workspaces error:', wsErr)
      return NextResponse.json({ error: 'Failed to fetch workspaces' }, { status: 500 })
    }

    let joinedRows: Record<string, unknown>[] = []
    if (joinedIds.length > 0) {
      const { data } = await admin
        .from('workspaces')
        .select('id, name, created_at, owner_id, type')
        .in('id', joinedIds)
        .not('type', 'in', '(class,deskcrit)')
      joinedRows = data ?? []
    }

    // Owned and joined overlap — creating a space writes an owner membership —
    // so dedupe before counting anything.
    const workspaces = Array.from(
      new Map([...(ownedRows ?? []), ...joinedRows].map((w) => [w.id as string, w])).values()
    ).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))

    const wsIds = workspaces.map((w) => w.id as string)
    const roomCountMap: Record<string, number> = {}
    const memberCountMap: Record<string, number> = {}

    if (wsIds.length > 0) {
      const { data: roomRows } = await admin
        .from('rooms')
        .select('workspace_id')
        .in('workspace_id', wsIds)
      for (const row of roomRows ?? []) {
        const k = row.workspace_id as string
        roomCountMap[k] = (roomCountMap[k] ?? 0) + 1
      }

      const { data: memberRows } = await admin
        .from('workspace_members')
        .select('workspace_id')
        .in('workspace_id', wsIds)
      for (const row of memberRows ?? []) {
        const k = row.workspace_id as string
        memberCountMap[k] = (memberCountMap[k] ?? 0) + 1
      }
    }

    return NextResponse.json({
      workspaces: workspaces.map((w) => {
        const id = w.id as string
        // > 1, not > 0: creating a space writes a members row for its owner, so
        // every space has one member and `> 0` would call them all shared.
        const memberCount = memberCountMap[id] ?? 0
        return {
          id,
          name: w.name as string,
          subRoomCount: roomCountMap[id] ?? 0,
          createdAt: w.created_at as string,
          memberCount,
          shared: memberCount > 1,
          ownedByMe: (w.owner_id as string) === user.id,
        }
      }),
    })
  } catch (err) {
    console.error('network/personal GET error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
