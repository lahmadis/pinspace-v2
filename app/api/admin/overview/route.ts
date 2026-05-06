import { NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/auth/isAdmin'

export const dynamic = 'force-dynamic'

/** GET /api/admin/overview – institutions with workspace counts (admin only). */
export async function GET() {
  try {
    const supabase = supabaseServer()
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession()

    if (sessionError || !session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!isAdmin(session.user.email)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const admin = supabaseServiceRole()
    const { data: institutions, error: instErr } = await admin
      .from('organizations')
      .select('id, name, slug, network_label, type')
      .order('name')

    if (instErr) {
      console.error('Error fetching institutions:', instErr)
      return NextResponse.json({ error: 'Failed to fetch institutions' }, { status: 500 })
    }

    const allOrgIds = (institutions || []).map((i) => i.id)

    // Batch domains + pending request count in parallel — no extra round trip.
    const domainsMap = new Map<string, string[]>(allOrgIds.map((id) => [id, []]))
    const [allDomainsResult, pendingCountResult] = await Promise.all([
      allOrgIds.length > 0
        ? admin.from('org_domains').select('org_id, domain').in('org_id', allOrgIds).order('domain')
        : Promise.resolve({ data: [] as { org_id: string; domain: string }[], error: null }),
      admin.from('org_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    ])
    for (const row of allDomainsResult.data ?? []) {
      domainsMap.get(row.org_id)?.push(row.domain)
    }

    const withCounts = await Promise.all(
      (institutions || []).map(async (inst) => {
        const [workspacesResult, userCountResult] = await Promise.all([
          admin
            .from('workspaces')
            .select('id, name, type, created_at', { count: 'exact' })
            .eq('organization_id', inst.id)
            .order('created_at', { ascending: false }),
          admin
            .from('user_profiles')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', inst.id),
        ])
        return {
          ...inst,
          workspace_count: workspacesResult.error ? 0 : (workspacesResult.count ?? 0),
          user_count: userCountResult.error ? 0 : (userCountResult.count ?? 0),
          workspaces: workspacesResult.data ?? [],
          domains: domainsMap.get(inst.id) ?? [],
        }
      })
    )

    return NextResponse.json({
      institutions: withCounts,
      pending_request_count: pendingCountResult.count ?? 0,
    })
  } catch (error) {
    console.error('Error in GET /api/admin/overview:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
