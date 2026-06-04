import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'
import { isSuperadmin } from '@/lib/auth/superadmin'

export const dynamic = 'force-dynamic'

// GET /api/explore/academic-years
// Returns academic-year buckets (with counts) scoped to the signed-in user's
// own institution. Institution is derived from session, never from query
// params — EXCEPT a platform superadmin may pass `org` to scope to any org
// (read-only), verified server-side. Mirrors /api/explore/studios.
export async function GET(request: NextRequest) {
  try {
    // Pilot pass 7: scope to user's own org from session.
    const userClient = supabaseServer()
    const { data: { session } } = await userClient.auth.getSession()
    let institutionFilterId: string | null = null
    if (session?.user?.id) {
      const { data: profile } = await userClient
        .from('user_profiles')
        .select('organization_id')
        .eq('user_id', session.user.id)
        .maybeSingle()
      if (profile?.organization_id) institutionFilterId = profile.organization_id
    }

    // Superadmin org override (read-only). Honored only after server-side
    // verification; ignored for everyone else.
    const requestedOrg = request.nextUrl.searchParams.get('org')
    if (requestedOrg && session?.user?.id && (await isSuperadmin(session.user.id))) {
      institutionFilterId = requestedOrg
    }

    if (!institutionFilterId) {
      return NextResponse.json({ academicYears: [] })
    }

    const supabase = supabaseServiceRole()
    const { data, error } = await supabase
      .from('workspaces')
      .select('academic_year')
      .eq('is_public', true)
      .not('published_at', 'is', null)
      .not('academic_year', 'is', null)
      .eq('organization_id', institutionFilterId)

    if (error) {
      console.error('Error fetching academic years:', error)
      return NextResponse.json({ academicYears: [] })
    }

    // Count occurrences of each academic year
    const counts: Record<string, number> = {}
    for (const row of data || []) {
      if (row.academic_year) {
        counts[row.academic_year] = (counts[row.academic_year] || 0) + 1
      }
    }

    const academicYears = Object.entries(counts)
      .map(([year, count]) => ({ year, count }))
      .sort((a, b) => b.year.localeCompare(a.year))

    return NextResponse.json({ academicYears })
  } catch (error) {
    console.error('Error fetching academic years:', error)
    return NextResponse.json({ error: 'Failed to fetch academic years' }, { status: 500 })
  }
}
