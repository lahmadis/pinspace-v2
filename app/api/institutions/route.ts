import { NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/requireAdmin'

export const revalidate = 60
export const dynamic = 'force-dynamic'

/** GET /api/institutions – list all institutions (public, no auth). */
export async function GET() {
  try {
    const supabase = supabaseServiceRole()
    const { data: institutions, error } = await supabase
      .from('organizations')
      .select('id, name, slug, network_label, type, logo_url')
      .order('name')

    if (error) {
      console.error('Error fetching institutions:', error)
      return NextResponse.json({ error: 'Failed to fetch institutions' }, { status: 500 })
    }

    const allOrgIds = (institutions || []).map((i) => i.id)
    const domainsMap = new Map<string, string[]>(allOrgIds.map((id) => [id, []]))
    const allDomainsResult = await (allOrgIds.length > 0
      ? supabase.from('org_domains').select('org_id, domain').in('org_id', allOrgIds).order('domain')
      : Promise.resolve({ data: [] as { org_id: string; domain: string }[], error: null }))
    for (const row of allDomainsResult.data ?? []) {
      domainsMap.get(row.org_id)?.push(row.domain)
    }

    const withCounts = await Promise.all(
      (institutions || []).map(async (inst) => {
        const [studiosResult, studentsResult] = await Promise.all([
          supabase
            .from('workspaces')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', inst.id)
            .eq('is_published', true),
          supabase
            .from('user_profiles')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', inst.id),
        ])
        return {
          id: inst.id,
          name: inst.name,
          slug: inst.slug,
          network_label: inst.network_label,
          type: inst.type,
          logo_url: inst.logo_url,
          domains: domainsMap.get(inst.id) ?? [],
          studio_count: studiosResult.error ? 0 : (studiosResult.count ?? 0),
          student_count: studentsResult.error ? 0 : (studentsResult.count ?? 0),
        }
      })
    )

    return NextResponse.json({ institutions: withCounts })
  } catch (error) {
    console.error('Error in GET /api/institutions:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

/** POST /api/institutions – create org (admin only). Calls create_organization_with_domains RPC for atomicity. */
export async function POST(req: Request) {
  try {
    const auth = await requireAdmin()
    if (!auth.ok) return auth.response

    const body = await req.json().catch(() => null)
    const name = body?.name?.trim() ?? ''
    const slug = body?.slug?.trim()?.toLowerCase()?.replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') ?? ''
    const networkLabel = body?.network_label?.trim() || null
    const type = body?.type === 'firm' ? 'firm' : 'university'
    const rawDomains: unknown = body?.domains
    const domains: string[] = Array.isArray(rawDomains)
      ? rawDomains.filter((d): d is string => typeof d === 'string' && d.trim() !== '').map((d) => d.trim().toLowerCase())
      : []

    if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    if (!slug) return NextResponse.json({ error: 'Slug is required (e.g. wit, mit)' }, { status: 400 })

    const admin = supabaseServiceRole()
    const { data, error } = await admin.rpc('create_organization_with_domains', {
      p_name: name,
      p_slug: slug,
      p_type: type,
      p_network_label: networkLabel,
      p_domains: domains,
    })

    if (error) {
      if (error.code === '23505') {
        if (error.message?.includes('org_domains_domain_unique')) {
          const match = (error as { details?: string }).details?.match(/Key \(domain\)=\(([^)]+)\)/)
          const conflicting = match?.[1] ?? 'a domain'
          return NextResponse.json(
            { error: `Domain ${conflicting} is already registered to another organization` },
            { status: 409 }
          )
        }
        return NextResponse.json({ error: 'An organization with that slug already exists' }, { status: 409 })
      }
      console.error('Error creating organization:', error)
      return NextResponse.json({ error: 'Failed to create organization' }, { status: 500 })
    }

    return NextResponse.json({ institution: data }, { status: 201 })
  } catch (error) {
    console.error('Error in POST /api/institutions:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
