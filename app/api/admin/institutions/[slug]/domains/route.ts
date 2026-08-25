import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/requireAdmin'

export const dynamic = 'force-dynamic'

const DOMAIN_RE = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/

async function resolveOrg(slug: string) {
  const admin = supabaseServiceRole()
  const { data, error } = await admin
    .from('organizations')
    .select('id')
    .eq('slug', slug)
    .single()
  return error || !data ? null : data
}

/** GET /api/admin/institutions/[slug]/domains – list domains for an org. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params
    const auth = await requireAdmin()
    if (!auth.ok) return auth.response

    const org = await resolveOrg(slug)
    if (!org) return NextResponse.json({ error: 'Organization not found' }, { status: 404 })

    const admin = supabaseServiceRole()
    const { data, error } = await admin
      .from('org_domains')
      .select('id, domain, created_at')
      .eq('org_id', org.id)
      .order('domain')

    if (error) {
      console.error('GET domains error:', error)
      return NextResponse.json({ error: 'Failed to fetch domains' }, { status: 500 })
    }

    return NextResponse.json({ domains: data ?? [] })
  } catch (e) {
    console.error('GET /api/admin/institutions/[slug]/domains:', e)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

/** POST /api/admin/institutions/[slug]/domains – add a domain to an org. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params
    const auth = await requireAdmin()
    if (!auth.ok) return auth.response

    const body = await req.json().catch(() => null)
    const domain = typeof body?.domain === 'string'
      ? body.domain.trim().toLowerCase().replace(/^https?:\/\//i, '')
      : ''

    if (!domain) return NextResponse.json({ error: 'Domain is required' }, { status: 400 })
    if (!DOMAIN_RE.test(domain)) {
      return NextResponse.json({ error: 'Invalid domain format (e.g. wit.edu)' }, { status: 400 })
    }

    const org = await resolveOrg(slug)
    if (!org) return NextResponse.json({ error: 'Organization not found' }, { status: 404 })

    const admin = supabaseServiceRole()
    const { data, error } = await admin
      .from('org_domains')
      .insert({ org_id: org.id, domain })
      .select('id, domain, created_at')
      .single()

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: `Domain ${domain} is already registered to another organization` },
          { status: 409 }
        )
      }
      console.error('POST domain error:', error)
      return NextResponse.json({ error: 'Failed to add domain' }, { status: 500 })
    }

    return NextResponse.json({ domain: data }, { status: 201 })
  } catch (e) {
    console.error('POST /api/admin/institutions/[slug]/domains:', e)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
