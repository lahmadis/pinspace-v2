import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// GET /api/explore/academic-years?institution_slug=wit
// Returns available academic years with studio counts
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const institutionSlug = searchParams.get('institution_slug')
    const institutionId = searchParams.get('institution_id')

    const supabase = supabaseServiceRole()

    // Resolve institution filter
    let institutionFilterId: string | null = null
    if (institutionId) {
      institutionFilterId = institutionId
    } else if (institutionSlug) {
      const { data: inst } = await supabase
        .from('organizations')
        .select('id')
        .eq('slug', institutionSlug)
        .single()
      if (inst?.id) institutionFilterId = inst.id
    }

    let query = supabase
      .from('workspaces')
      .select('academic_year')
      .eq('is_public', true)
      .not('published_at', 'is', null)
      .not('academic_year', 'is', null)

    if (institutionFilterId) {
      query = query.eq('organization_id', institutionFilterId)
    }

    const { data, error } = await query

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
