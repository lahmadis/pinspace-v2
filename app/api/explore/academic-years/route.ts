import { NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// GET /api/explore/academic-years
// Returns academic-year buckets (with counts) scoped to the signed-in user's
// own institution. Pilot pass 7: no cross-institution browsing — institution
// is always derived from session, never from query params.
export async function GET() {
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
