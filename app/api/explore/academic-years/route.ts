import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'
import { isSuperadmin } from '@/lib/auth/superadmin'

export const dynamic = 'force-dynamic'

// GET /api/explore/academic-years
// Returns academic-year buckets (with counts) scoped to the signed-in user's
// own institution. Institution is derived from the verified user, never from query
// params — EXCEPT a platform superadmin may pass `org` to scope to any org
// (read-only), verified server-side. Mirrors /api/explore/studios.
export async function GET(request: NextRequest) {
  try {
    // Pilot pass 7: scope to the verified user's own org.
    const userClient = await supabaseServer()
    const { data: { user } } = await userClient.auth.getUser()
    let institutionFilterId: string | null = null
    if (user?.id) {
      const { data: profile } = await userClient
        .from('user_profiles')
        .select('organization_id')
        .eq('user_id', user.id)
        .maybeSingle()
      if (profile?.organization_id) institutionFilterId = profile.organization_id
    }

    // Superadmin org override (read-only). Honored only after server-side
    // verification; ignored for everyone else.
    const requestedOrg = request.nextUrl.searchParams.get('org')
    if (requestedOrg && user?.id && (await isSuperadmin(user.id))) {
      institutionFilterId = requestedOrg
    }

    if (!institutionFilterId) {
      return NextResponse.json({ academicYears: [] })
    }

    // Derived from PUBLISHED ROOMS, matching /api/explore/studios exactly.
    //
    // This used to select workspaces on `is_public = true AND published_at IS
    // NOT NULL`, while the bubbles it filters are built from
    // `rooms.is_published = true`. Two endpoints backing one screen disagreeing
    // about what "published" means had two consequences: a workspace with
    // published rooms but is_public = false (e.g. SEED 3) never contributed a
    // year tab even though its rooms render, and the year the page defaults to
    // could contain zero bubbles.
    //
    // Counts are DISTINCT WORKSPACES, not rooms: studios groups its published
    // rooms by workspace and emits one bubble each, so with sub-rooms shipped a
    // room count would overstate what selecting the tab actually shows.
    const supabase = supabaseServiceRole()
    const { data, error } = await supabase
      .from('rooms')
      .select('id, workspaces:workspace_id ( id, organization_id, academic_year )')
      .eq('is_published', true)

    if (error) {
      console.error('Error fetching academic years:', error)
      return NextResponse.json({ academicYears: [] })
    }

    type WorkspaceLite = { id: string; organization_id: string | null; academic_year: string | null }

    // Distinct workspaces per academic year, scoped to this institution.
    const workspacesByYear: Record<string, Set<string>> = {}
    for (const row of data || []) {
      // Embedded resources come back as an object or a single-element array
      // depending on FK shape; workspace_id is one-to-one. Same normalization
      // as /api/explore/studios.
      const raw = (row as { workspaces?: WorkspaceLite | WorkspaceLite[] | null }).workspaces
      const ws: WorkspaceLite | null = Array.isArray(raw) ? raw[0] ?? null : raw ?? null
      if (!ws) continue
      if (ws.organization_id !== institutionFilterId) continue
      // A NULL year can't be offered as a tab — there is nothing to filter on.
      // After migration 032 there should be none; the explore query logs any
      // that appear rather than dropping them silently.
      if (!ws.academic_year) continue
      if (!workspacesByYear[ws.academic_year]) workspacesByYear[ws.academic_year] = new Set()
      workspacesByYear[ws.academic_year].add(ws.id)
    }

    const academicYears = Object.entries(workspacesByYear)
      .map(([year, workspaceIds]) => ({ year, count: workspaceIds.size }))
      .sort((a, b) => b.year.localeCompare(a.year))

    return NextResponse.json({ academicYears })
  } catch (error) {
    console.error('Error fetching academic years:', error)
    return NextResponse.json({ error: 'Failed to fetch academic years' }, { status: 500 })
  }
}
