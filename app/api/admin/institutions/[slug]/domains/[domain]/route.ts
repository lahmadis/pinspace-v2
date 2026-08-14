import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/auth/isAdmin'

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

    const supabase = supabaseServer()
    const { data: { session }, error: sessionError } = await supabase.auth.getSession()
    if (sessionError || !session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!isAdmin(session.user.email)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

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
