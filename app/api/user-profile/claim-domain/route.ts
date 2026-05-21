import { NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/** POST /api/user-profile/claim-domain
 * For authenticated users with no organization_id: looks up whether their
 * email domain is now registered in org_domains and, if so, sets
 * user_profiles.organization_id. Safe to call on every login — idempotent.
 */
export async function POST() {
  try {
    const supabase = supabaseServer()
    const { data: { user }, error: userErr } = await supabase.auth.getUser()
    if (userErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const domain = user.email?.split('@')[1]?.toLowerCase()
    if (!domain) {
      return NextResponse.json({ claimed: false, organizationId: null })
    }

    const admin = supabaseServiceRole()

    const { data: domainRow } = await admin
      .from('org_domains')
      .select('org_id')
      .eq('domain', domain)
      .maybeSingle()

    if (!domainRow) {
      return NextResponse.json({ claimed: false, organizationId: null })
    }

    const matchedOrgId: string = domainRow.org_id

    const { data: profile } = await admin
      .from('user_profiles')
      .select('organization_id')
      .eq('user_id', user.id)
      .maybeSingle()

    const existingOrgId: string | null = profile?.organization_id ?? null

    if (existingOrgId === matchedOrgId) {
      return NextResponse.json({ claimed: false, alreadySet: true, organizationId: matchedOrgId })
    }

    if (existingOrgId !== null) {
      console.warn(`claim-domain: user ${user.id} already has org ${existingOrgId}, not overwriting with ${matchedOrgId}`)
      return NextResponse.json({ claimed: false, conflict: true, organizationId: existingOrgId })
    }

    const { error: updateErr } = await admin
      .from('user_profiles')
      .update({ organization_id: matchedOrgId })
      .eq('user_id', user.id)

    if (updateErr) {
      console.error('claim-domain update error:', updateErr)
      return NextResponse.json({ error: updateErr.message }, { status: 500 })
    }

    return NextResponse.json({ claimed: true, organizationId: matchedOrgId })
  } catch (err) {
    console.error('claim-domain error:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
