import { NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/requireAdmin'

export const dynamic = 'force-dynamic'

/** GET /api/admin/overview – institutions with workspace counts (admin only). */
export async function GET() {
  try {
    const auth = await requireAdmin()
    if (!auth.ok) return auth.response

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

    const domainsMap = new Map<string, string[]>(allOrgIds.map((id) => [id, []]))
    const allDomainsResult = allOrgIds.length > 0
      ? await admin.from('org_domains').select('org_id, domain').in('org_id', allOrgIds).order('domain')
      : { data: [] as { org_id: string; domain: string }[], error: null }
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
    })
  } catch (error) {
    console.error('Error in GET /api/admin/overview:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
