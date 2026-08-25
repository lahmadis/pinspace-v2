import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/requireAdmin'

export const dynamic = 'force-dynamic'

/** DELETE /api/admin/institutions/[slug]/domains/[domain] – remove a domain from an org. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string; domain: string }> }
) {
  try {
    const { slug, domain: rawDomain } = await params
    const domain = decodeURIComponent(rawDomain).toLowerCase().trim()

    if (!slug || !domain) {
      return NextResponse.json({ error: 'slug and domain are required' }, { status: 400 })
    }

    const auth = await requireAdmin()
    if (!auth.ok) return auth.response

    const admin = supabaseServiceRole()
    const { data: org, error: orgErr } = await admin
      .from('organizations')
      .select('id')
      .eq('slug', slug)
      .single()
    if (orgErr || !org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    const { error } = await admin
      .from('org_domains')
      .delete()
      .eq('org_id', org.id)
      .eq('domain', domain)

    if (error) {
      console.error('DELETE domain error:', error)
      return NextResponse.json({ error: 'Failed to remove domain' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('DELETE /api/admin/institutions/[slug]/domains/[domain]:', e)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
