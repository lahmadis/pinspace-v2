import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'
import { getDemoStudios, getDemoTotals } from '@/lib/mockData'
import { isSuperadmin } from '@/lib/auth/superadmin'
import { cleanDisplayName } from '@/lib/displayName'

// Allow short-lived caching so repeat visits and multiple clients don't all hit Supabase
export const dynamic = 'force-dynamic'
export const revalidate = 0
const CACHE_MAX_AGE = 60 // seconds
const STALE_WHILE_REVALIDATE = 120

// Single color for all bubbles - connections differentiate relationships
// The app's one blue. BubbleNetwork overrides node.color with its own constant
// anyway, so this is belt-and-braces — but shipping a colour the UI contradicts
// is how the next reader concludes the bubbles are supposed to be indigo.
const BUBBLE_COLOR = '#3B6EF6'

/** Search-index cap per studio — see contributorsByWorkspace below. */
const MAX_CONTRIBUTORS_PER_STUDIO = 500

export async function GET(request: NextRequest) {
  try {
    // Check for demo mode and filters
    const searchParams = request.nextUrl.searchParams
    const isDemo = searchParams.get('demo') === 'true'
    const department = searchParams.get('department')
    const year = searchParams.get('year')
    const academicYear = searchParams.get('academic_year')
    // Pilot pass 7: any institution_slug / institution_id query params are
    // ignored — the user's institution is always derived from session below.

    if (isDemo) {
      // Return mock data for demo mode with filters applied
      let studios = getDemoStudios()
      
      // Filter by department if provided
      if (department) {
        studios = studios.filter(s => {
          const norm = (val: string | number | null | undefined) => `${val || ''}`.toLowerCase().trim()
          return norm(s.department) === norm(department)
        })
      }
      
      // Filter by year if provided
      if (year) {
        studios = studios.filter(s => {
          const norm = (val: string | number | null | undefined) => `${val || ''}`.toLowerCase().trim()
          const numOnly = (val: string | number | null | undefined) => {
            const m = `${val || ''}`.match(/\d+/)
            return m ? m[0] : `${val || ''}`
          }
          const studioYearStr = norm(typeof s.year === 'string' ? s.year : `${s.year}`)
          const studioYearNum = numOnly(s.year)
          const targetYearStr = norm(year)
          const targetYearNum = numOnly(year)
          return studioYearStr === targetYearStr || studioYearNum === targetYearNum
        })
      }
      
      const totals = getDemoTotals()
      return NextResponse.json(
        { studios, totals },
        { headers: { 'Cache-Control': `public, s-maxage=${CACHE_MAX_AGE}, stale-while-revalidate=${STALE_WHILE_REVALIDATE}` } }
      )
    }

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.warn('⚠️ SUPABASE_SERVICE_ROLE_KEY missing; returning empty studios')
      return NextResponse.json(
        { studios: [], totals: { studios: 0, students: 0 }, hasOrg: false },
        { headers: { 'Cache-Control': `public, s-maxage=${CACHE_MAX_AGE}, stale-while-revalidate=${STALE_WHILE_REVALIDATE}` } }
      )
    }

    // Pilot pass 7: scope strictly to the signed-in user's own institution.
    // Resolved server-side from user_profiles.organization_id — clients no
    // longer choose an institution.
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

    // Platform superadmin: may view ANY org's network (read-only). The `org`
    // query param selects which org; it is honored ONLY after verifying the
    // caller is a superadmin server-side (service role, from the verified user
    // id). A non-superadmin passing `org` is ignored and stays scoped to their
    // own org. This is the sole cross-org override — content endpoints still
    // gate independently on published status.
    // Captured rather than discarded: `contributors` below needs the same
    // answer, and re-asking would be a second round trip on every explore load.
    // Only resolved when the org override is actually used — a superadmin
    // browsing their OWN org falls through to the ordinary member checks, which
    // is correct for them anyway.
    let callerIsSuperadmin = false
    const requestedOrg = searchParams.get('org')
    if (requestedOrg && user?.id) {
      callerIsSuperadmin = await isSuperadmin(user.id)
      if (callerIsSuperadmin) institutionFilterId = requestedOrg
    }

    if (!institutionFilterId) {
      // No verified user, or signed-in user is not attached to an org (legacy
      // orphaned account). Return empty so the UI can show its empty state.
      return NextResponse.json(
        { studios: [], totals: { studios: 0, students: 0 }, hasOrg: false },
        { headers: { 'Cache-Control': 'private, no-store' } }
      )
    }

    // Use service role client to bypass RLS for the actual studio query.
    const supabase = supabaseServiceRole()

    /**
     * What this institution calls its network. `network_label` is the column
     * that exists for exactly this; `name` is the fallback for orgs that never
     * set one. Returned so the page can title itself after the school rather
     * than hardcoding one institution's abbreviation into a shared component.
     */
    let networkLabel: string | null = null
    {
      const { data: org } = await supabase
        .from('organizations')
        .select('name, network_label')
        .eq('id', institutionFilterId)
        .maybeSingle()
      const label = (org?.network_label as string | null)?.trim()
      const name = (org?.name as string | null)?.trim()
      networkLabel = label || name || null
    }

    // Bubble per published room. Query rooms.is_published with parent
    // workspace metadata joined for filtering/labeling. is_published is the
    // single source of truth for visibility on /explore.

    type WorkspaceLite = {
      id: string
      name: string
      organization_id: string | null
      network_metadata: { department?: string; year?: string | number } | null
      academic_year: string | null
      instructor: string | null
      // Both carried solely to decide who may receive `contributors` below.
      is_public: boolean | null
      owner_id: string | null
    }
    type PublishedEntry = {
      roomId: string
      roomName: string
      workspaceId: string
      workspaceName: string
      department: string | null
      year: string | number | null
      academicYear: string | null
      instructor: string | null
      organizationId: string | null
      isPublic: boolean
      ownerId: string | null
    }

    // PostgREST embedded resource returns workspaces as a nested object.
    const primaryQuery = supabase
      .from('rooms')
      .select(`
        id,
        name,
        workspace_id,
        workspaces:workspace_id (
          id,
          name,
          organization_id,
          network_metadata,
          academic_year,
          instructor,
          is_public,
          owner_id
        )
      `)
      .eq('is_published', true)

    const { data: publishedRoomRows, error: primaryError } = await primaryQuery

    if (primaryError) {
      console.error('Error fetching published rooms:', primaryError)
      return NextResponse.json(
        { studios: [], totals: { studios: 0, students: 0 }, hasOrg: true },
        { headers: { 'Cache-Control': 'private, no-store' } }
      )
    }

    const entries: PublishedEntry[] = []
    for (const r of publishedRoomRows ?? []) {
      // Supabase embedded resources can be either a single object or an array
      // depending on FK shape; rooms.workspace_id is a one-to-one FK so it's
      // a single object — but TypeScript still types it loosely.
      const wsRaw = (r as { workspaces?: WorkspaceLite | WorkspaceLite[] | null }).workspaces
      const ws: WorkspaceLite | null = Array.isArray(wsRaw) ? wsRaw[0] ?? null : wsRaw ?? null
      if (!ws) continue
      entries.push({
        roomId: r.id as string,
        roomName: r.name as string,
        workspaceId: r.workspace_id as string,
        workspaceName: ws.name,
        department: ws.network_metadata?.department ?? null,
        year: ws.network_metadata?.year ?? null,
        academicYear: ws.academic_year,
        instructor: ws.instructor,
        organizationId: ws.organization_id,
        isPublic: ws.is_public === true,
        ownerId: ws.owner_id,
      })
    }

    // Filter strictly to the user's own institution (resolved above).
    let filteredEntries = entries.filter(e => e.organizationId === institutionFilterId)
    if (department) {
      filteredEntries = filteredEntries.filter(e => e.department === department)
    }
    if (academicYear) {
      // Strict match, deliberately. After the migration-032 backfill no
      // workspace should have a NULL academic_year, and workspace creation now
      // stamps one — so a NULL here means the write path regressed, not that
      // the row is legitimately year-less. Log it instead of letting a
      // published room vanish from explore with no trace, which is exactly how
      // 31 workspaces went missing unnoticed.
      const nullYearEntries = filteredEntries.filter(e => e.academicYear === null)
      if (nullYearEntries.length > 0) {
        console.warn(
          '[explore] published rooms have a NULL academic_year and are excluded by the year filter',
          {
            excludedRooms: nullYearEntries.length,
            workspaceIds: Array.from(new Set(nullYearEntries.map(e => e.workspaceId))),
            selectedYear: academicYear,
          }
        )
      }
      filteredEntries = filteredEntries.filter(e => e.academicYear === academicYear)
    }

    // Member counts: still per-workspace (members are workspace-scoped). Boards
    // are per-room.
    const workspaceIdsForCounts = Array.from(new Set(filteredEntries.map(e => e.workspaceId)))
    const roomIdsForBoardCounts = filteredEntries.map(e => e.roomId)
    const memberCounts: Record<string, number> = {}
    const boardCountsByRoom: Record<string, number> = {}
    /** Workspaces the CALLER belongs to — gates `contributors`, see below. */
    const callerMemberOf = new Set<string>()
    if (workspaceIdsForCounts.length > 0) {
      // user_id comes back purely so the caller's own rows can be picked out of
      // the same scan; it is never returned to the client.
      const { data: membersData } = await supabase
        .from('workspace_members')
        .select('workspace_id, user_id')
        .in('workspace_id', workspaceIdsForCounts)
      for (const m of membersData ?? []) {
        const k = m.workspace_id as string
        memberCounts[k] = (memberCounts[k] ?? 0) + 1
        if (user?.id && m.user_id === user.id) callerMemberOf.add(k)
      }
    }
    /**
     * Who has work in each workspace, for the network search box.
     *
     * Piggybacks on the board-count query rather than adding one: that scan
     * already visits every board in every published room, so the names come
     * back for the cost of two more text columns.
     *
     * BOTH name columns go in, deduplicated — this is a search index, not a
     * label, so it should match whichever name the person is known by. (The
     * rendered label elsewhere picks one; see lib/displayName.ts.) Placeholder
     * values like "Anonymous" are dropped by cleanDisplayName, so searching
     * cannot surface a studio by a non-name.
     *
     * GATED TO STUDIOS THE CALLER CAN ACTUALLY OPEN, which is narrower than
     * the set of bubbles they can see. A room may be is_published (so it shows
     * on the network) while its workspace is is_public = false — and for those,
     * GET /api/boards admits only the owner, a member, or a superadmin viewing
     * network-published content. An org member who is not in that studio gets a
     * 403 opening it, so shipping them its roster of student names would expose
     * something the app otherwise refuses them. `contributors` is therefore
     * populated only when the caller could open the room anyway; everyone else
     * receives an empty array and simply cannot find that studio by student
     * name. The bubble, its title and its counts are unchanged for them.
     */
    const contributorsByWorkspace: Record<string, Set<string>> = {}
    const workspaceIdByRoom: Record<string, string> = {}
    for (const e of filteredEntries) workspaceIdByRoom[e.roomId] = e.workspaceId

    // Mirrors GET /api/boards' own gate: public workspace, or the caller owns
    // it, or the caller is a member, or a verified superadmin is viewing this
    // org's network-published content.
    const contributorsAllowed = new Set<string>()
    for (const e of filteredEntries) {
      if (
        e.isPublic ||
        callerIsSuperadmin ||
        (user?.id != null && (e.ownerId === user.id || callerMemberOf.has(e.workspaceId)))
      ) {
        contributorsAllowed.add(e.workspaceId)
      }
    }

    if (roomIdsForBoardCounts.length > 0) {
      const { data: boardsData } = await supabase
        .from('boards')
        .select('room_id, student_name, owner_name')
        .in('room_id', roomIdsForBoardCounts)
        .neq('upload_status', 'pending')
      for (const b of boardsData ?? []) {
        const k = b.room_id as string
        if (!k) continue
        boardCountsByRoom[k] = (boardCountsByRoom[k] ?? 0) + 1

        const workspaceId = workspaceIdByRoom[k]
        if (!workspaceId || !contributorsAllowed.has(workspaceId)) continue
        const set = contributorsByWorkspace[workspaceId] ?? new Set<string>()
        contributorsByWorkspace[workspaceId] = set
        // Bounded so one enormous studio can't balloon the payload. Well above
        // any real cohort; if it ever trips, search simply misses the tail.
        if (set.size >= MAX_CONTRIBUTORS_PER_STUDIO) continue
        for (const raw of [b.student_name, b.owner_name]) {
          const name = cleanDisplayName(raw)
          if (name) set.add(name)
        }
      }
    }

    // Year filter (client-side because the year string lives in JSON metadata
    // and may need numeric/textual normalization).
    if (year) {
      filteredEntries = filteredEntries.filter(e => {
        const wYear = e.year
        const norm = (val: string | number | null | undefined) => `${val ?? ''}`.toLowerCase().trim()
        const numOnly = (val: string | number | null | undefined) => {
          const m = `${val ?? ''}`.match(/\d+/)
          return m ? m[0] : `${val ?? ''}`
        }
        let yearNum: number | string = 1
        if (wYear === 'Masters') {
          yearNum = 'Masters'
        } else if (typeof wYear === 'string') {
          const match = wYear.match(/\d+/)
          yearNum = match ? parseInt(match[0]) : 1
        } else if (typeof wYear === 'number') {
          yearNum = wYear
        }
        const studioYearStr = norm(typeof yearNum === 'string' ? yearNum : `${yearNum}`)
        const studioYearNum = numOnly(yearNum)
        const targetYearStr = norm(year)
        const targetYearNum = numOnly(year)
        return studioYearStr === targetYearStr || studioYearNum === targetYearNum
      })
    }

    // Group entries by workspace. One bubble per workspace; each bubble
    // carries the list of published rooms so the explore UI can offer a
    // room picker when there are multiple.
    const byWorkspace = new Map<string, typeof filteredEntries>()
    for (const e of filteredEntries) {
      const group = byWorkspace.get(e.workspaceId) ?? []
      group.push(e)
      byWorkspace.set(e.workspaceId, group)
    }

    const studios = Array.from(byWorkspace.values()).map((group) => {
      const e = group[0]
      const wYear = e.year
      let yearNum: number | string = 1
      if (wYear === 'Masters') {
        yearNum = 'Masters'
      } else if (typeof wYear === 'string') {
        const match = wYear.match(/\d+/)
        yearNum = match ? parseInt(match[0]) : 1
      } else if (typeof wYear === 'number') {
        yearNum = wYear
      }

      const publishedRooms = group.map((r) => ({
        id: r.roomId,
        name: r.roomName,
        boardCount: boardCountsByRoom[r.roomId] || 0,
      }))
      // For single-room workspaces, url points directly to that room.
      // For multi-room workspaces, url is omitted; explore page shows a picker.
      const url = publishedRooms.length === 1 ? `/studio/${publishedRooms[0].id}/view` : undefined

      const totalBoardCount = group.reduce((sum, r) => sum + (boardCountsByRoom[r.roomId] || 0), 0)

      return {
        id: e.workspaceId,
        name: e.workspaceName,
        label: e.workspaceName,
        workspaceName: e.workspaceName,
        workspaceId: e.workspaceId,
        department: e.department || 'Architecture',
        instructor: e.instructor || undefined,
        semester: undefined,
        year: yearNum,
        academicYear: e.academicYear || undefined,
        memberCount: memberCounts[e.workspaceId] || 0,
        // Names of everyone with work in this studio, so the network search
        // box can find a person and not just a space or a professor.
        contributors: Array.from(contributorsByWorkspace[e.workspaceId] ?? []),
        count: totalBoardCount,
        color: BUBBLE_COLOR,
        url,
        studioId: e.workspaceId,
        publishedRooms,
      }
    })

    const totals = {
      studios: studios.length,
      students: studios.reduce((sum, s) => sum + (s.memberCount || 0), 0),
    }

    return NextResponse.json(
      { studios, totals, hasOrg: true, networkLabel },
      // Per-user response now (depends on session) — don't share a CDN cache.
      { headers: { 'Cache-Control': 'private, no-store' } }
    )
  } catch (error) {
    console.error('Error fetching studios:', error)
    return NextResponse.json({ error: 'Failed to fetch studios' }, { status: 500 })
  }
}
