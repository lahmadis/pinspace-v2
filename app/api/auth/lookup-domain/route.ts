import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const raw = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''

    if (!raw || !raw.includes('@')) {
      return NextResponse.json({ error: 'Valid email required' }, { status: 400 })
    }

    const parts = raw.split('@')
    const domain = parts[1]
    if (!domain || !domain.includes('.')) {
      return NextResponse.json({ error: 'Valid email required' }, { status: 400 })
    }

    const supabase = supabaseServiceRole()

    // Join org_domains → organizations via the FK.
    // domain is UNIQUE in org_domains so this returns 0 or 1 rows today.
    // The array shape is intentional: the sign-in page must handle multiple
    // matches for when we remove the UNIQUE constraint and support alumni groups.
    const { data, error } = await supabase
      .from('org_domains')
      .select('organizations(id, name, slug, type, logo_url, network_label)')
      .eq('domain', domain)

    if (error) {
      console.error('[lookup-domain] query error:', error)
      return NextResponse.json({ error: 'Lookup failed' }, { status: 500 })
    }

    const orgs = (data ?? [])
      .map((row) => row.organizations)
      .filter((org): org is NonNullable<typeof org> => org !== null)

    return NextResponse.json({
      domain,
      orgs,
      // authMethod is the SSO extensibility hook. Today always 'otp'.
      // Future: per-org lookup could return 'saml' or 'google' here,
      // and the sign-in page branches without any other changes.
      authMethod: 'otp' as const,
    })
  } catch (err) {
    console.error('[lookup-domain] unexpected error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
