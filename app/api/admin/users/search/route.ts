import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/requireAdmin'

export const dynamic = 'force-dynamic'

const RESULT_LIMIT = 10
// See the note in /api/admin/recent-signups: listUsers is a single unpaginated
// page and GoTrue cannot sort or filter, so we match client-side over whatever
// page we get. A warning fires if we ever hit the cap.
const PER_PAGE = 1000

/**
 * GET /api/admin/users/search?q= — find EXISTING accounts by email or name.
 *
 * Backs the instructor picker. Deliberately returns only real accounts: the
 * admin cannot type a free-text email and provision a studio for someone who
 * has not signed up, because workspaces.owner_id would then point at nothing
 * and every owner-gated action on that studio would be dead.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireAdmin()
    if (!auth.ok) return auth.response

    const q = (req.nextUrl.searchParams.get('q') ?? '').trim().toLowerCase()
    if (q.length < 2) {
      return NextResponse.json({ users: [] })
    }

    const admin = supabaseServiceRole()

    const { data: authList, error: authErr } = await admin.auth.admin.listUsers({ page: 1, perPage: PER_PAGE })
    if (authErr) {
      console.error('Error listing auth users for search:', authErr)
      return NextResponse.json({ error: 'Failed to search users' }, { status: 500 })
    }
    const authUsers = authList?.users ?? []
    if (authUsers.length >= PER_PAGE) {
      console.warn(
        `/api/admin/users/search: listUsers returned ${authUsers.length} users, at the perPage cap of ${PER_PAGE}. ` +
        'Some accounts are not searchable — pagination is needed.'
      )
    }

    const { data: profiles, error: profilesErr } = await admin
      .from('user_profiles')
      .select('user_id, full_name, organization_id')
    if (profilesErr) {
      console.error('Error fetching profiles for search:', profilesErr)
      return NextResponse.json({ error: 'Failed to search users' }, { status: 500 })
    }

    const profileMap = new Map(
      (profiles ?? []).map((p) => [
        p.user_id as string,
        {
          fullName: (p.full_name as string | null) ?? null,
          organizationId: (p.organization_id as string | null) ?? null,
        },
      ])
    )

    const matches = authUsers
      .map((u) => {
        const profile = profileMap.get(u.id) ?? null
        return {
          userId: u.id,
          email: u.email ?? null,
          fullName: profile?.fullName ?? null,
          organizationId: profile?.organizationId ?? null,
          hasProfile: profile != null,
        }
      })
      .filter((u) => {
        const email = u.email?.toLowerCase() ?? ''
        const name = u.fullName?.toLowerCase() ?? ''
        return email.includes(q) || name.includes(q)
      })
      // Stable, predictable ordering: name if we have one, else email.
      .sort((a, b) => (a.fullName ?? a.email ?? '').localeCompare(b.fullName ?? b.email ?? ''))
      .slice(0, RESULT_LIMIT)

    return NextResponse.json({ users: matches })
  } catch (error) {
    console.error('Error in GET /api/admin/users/search:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
