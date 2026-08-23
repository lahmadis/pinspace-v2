import { NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/auth/isAdmin'

export const dynamic = 'force-dynamic'

/** GET /api/admin/stats – aggregated user profile stats (admin only). */
export async function GET() {
  try {
    const supabase = supabaseServer()
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession()

    if (sessionError || !session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!isAdmin(session.user.email)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const admin = supabaseServiceRole()
    const { data: profiles, error } = await admin
      .from('user_profiles')
      .select('year, major, age_range, how_heard')

    if (error) {
      console.error('Error fetching profiles:', error)
      return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 })
    }

    const byYear: Record<string, number> = {}
    const byMajor: Record<string, number> = {}
    const byAgeRange: Record<string, number> = {}
    const byHowHeard: Record<string, number> = {}
    let total = 0

    for (const p of profiles || []) {
      total++
      if (p.year) byYear[p.year] = (byYear[p.year] || 0) + 1
      if (p.major) byMajor[p.major] = (byMajor[p.major] || 0) + 1
      if (p.age_range) byAgeRange[p.age_range] = (byAgeRange[p.age_range] || 0) + 1
      if (p.how_heard) byHowHeard[p.how_heard] = (byHowHeard[p.how_heard] || 0) + 1
    }

    return NextResponse.json({
      total,
      by_year: byYear,
      by_major: byMajor,
      by_age_range: byAgeRange,
      by_how_heard: byHowHeard,
    })
  } catch (error) {
    console.error('Error in GET /api/admin/stats:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
