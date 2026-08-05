import { NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/auth/isAdmin'

export const dynamic = 'force-dynamic'

const LIMIT = 10

// NOTE: single page, no pagination. The GoTrue admin API cannot sort, so we
// pull a page and sort by created_at ourselves — which means once this project
// passes PER_PAGE accounts, the newest signups can fall outside the page we
// fetched and this card silently goes stale. The console.warn below is the
// tripwire. Fix then is real pagination or a SQL view over auth.users.
const PER_PAGE = 1000

type OrgRef = { name: string | null } | { name: string | null }[] | null

function orgName(org: OrgRef): string | null {
  if (!org) return null
  const o = Array.isArray(org) ? org[0] : org
  return o?.name ?? null
}

/** Re-verify the caller is an admin. Defense in depth — the page is already
 *  admin-gated, but this endpoint reads auth.users and must not trust that. */
async function requireAdmin() {
  const supabase = supabaseServer()
  const { data: { session }, error } = await supabase.auth.getSession()
  if (error || !session?.user) {
    return { ok: false as const, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  if (!isAdmin(session.user.email)) {
    return { ok: false as const, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { ok: true as const }
}

/** GET /api/admin/recent-signups — the 10 newest accounts, newest first.
 *
 *  Source of truth is auth.users.created_at, not user_profiles.created_at:
 *  the auth row is written when the OTP is *requested* (shouldCreateUser), the
 *  profile row only when onboarding is submitted. Using profiles would hide
 *  everyone who started signing up and never finished — which is exactly who
 *  this card is for. Hence the status field:
 *    unverified — email_confirmed_at is null; requested a code, never entered it
 *    no_profile — verified, but never completed onboarding
 *    active     — verified and onboarded
 */
export async function GET() {
  try {
    const auth = await requireAdmin()
    if (!auth.ok) return auth.response

    const admin = supabaseServiceRole()

    const { data: authList, error: authErr } = await admin.auth.admin.listUsers({ page: 1, perPage: PER_PAGE })
    if (authErr) {
      console.error('Error listing auth users:', authErr)
      return NextResponse.json({ error: 'Failed to fetch signups' }, { status: 500 })
    }

    const authUsers = authList?.users ?? []
    // Two tripwires, because either can miss on its own: GoTrue may cap
    // per_page below what we asked for, in which case the length never reaches
    // PER_PAGE — but it does hand back nextPage when more users exist.
    const hasMorePages = Boolean(authList && 'nextPage' in authList && authList.nextPage)
    if (authUsers.length >= PER_PAGE || hasMorePages) {
      console.warn(
        `/api/admin/recent-signups: listUsers returned ${authUsers.length} users (requested ${PER_PAGE}` +
        `${hasMorePages ? ', more pages available' : ''}). ` +
        'Recent signups may be missing newer accounts — pagination is needed.'
      )
    }

    const recent = [...authUsers]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, LIMIT)

    if (recent.length === 0) {
      return NextResponse.json({ signups: [] })
    }

    // Two set-based lookups for the whole page — no per-user queries.
    const userIds = recent.map((u) => u.id)
    const domains = Array.from(
      new Set(recent.map((u) => u.email?.split('@')[1]?.toLowerCase()).filter((d): d is string => Boolean(d)))
    )

    const [profilesResult, domainsResult] = await Promise.all([
      admin
        .from('user_profiles')
        .select('user_id, full_name, organization:organizations(name)')
        .in('user_id', userIds),
      domains.length > 0
        ? admin
            .from('org_domains')
            .select('domain, organization:organizations(name)')
            .in('domain', domains)
        : Promise.resolve({ data: [] as { domain: string; organization: OrgRef }[], error: null }),
    ])

    if (profilesResult.error) {
      console.error('Error fetching profiles for recent signups:', profilesResult.error)
      return NextResponse.json({ error: 'Failed to fetch signups' }, { status: 500 })
    }
    if (domainsResult.error) {
      console.error('Error fetching org domains for recent signups:', domainsResult.error)
    }

    const profileMap = new Map(
      (profilesResult.data ?? []).map((p) => [
        p.user_id as string,
        {
          fullName: (p.full_name as string | null) ?? null,
          organization: orgName(p.organization as OrgRef),
        },
      ])
    )

    const domainOrgMap = new Map(
      (domainsResult.data ?? []).map((d) => [d.domain as string, orgName(d.organization as OrgRef)])
    )

    const signups = recent.map((u) => {
      const profile = profileMap.get(u.id) ?? null
      const domain = u.email?.split('@')[1]?.toLowerCase() ?? null
      // Prefer the verified claim on the profile; fall back to the email
      // domain so users without a profile row still resolve to their org.
      const organization = profile?.organization ?? (domain ? domainOrgMap.get(domain) ?? null : null)

      const status = !u.email_confirmed_at ? 'unverified' : !profile ? 'no_profile' : 'active'

      return {
        userId: u.id,
        email: u.email ?? null,
        fullName: profile?.fullName ?? null,
        organization,
        createdAt: u.created_at,
        lastSignInAt: u.last_sign_in_at ?? null,
        status,
      }
    })

    return NextResponse.json({ signups })
  } catch (error) {
    console.error('Error in GET /api/admin/recent-signups:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
