import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'
import { getDemoStudios, getDemoTotals } from '@/lib/mockData'

// Allow short-lived caching so repeat visits and multiple clients don't all hit Supabase
export const dynamic = 'force-dynamic'
export const revalidate = 0
const CACHE_MAX_AGE = 60 // seconds
const STALE_WHILE_REVALIDATE = 120

// Single color for all bubbles - connections differentiate relationships
const BUBBLE_COLOR = '#6366f1' // Indigo

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
      // No session, or signed-in user is not attached to an org (legacy
      // orphaned account). Return empty so the UI can show its empty state.
      return NextResponse.json(
        { studios: [], totals: { studios: 0, students: 0 }, hasOrg: false },
        { headers: { 'Cache-Control': 'private, no-store' } }
      )
    }

    // Use service role client to bypass RLS for the actual studio query.
    const supabase = supabaseServiceRole()

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
          instructor
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
      })
    }

    // Filter strictly to the user's own institution (resolved above).
    let filteredEntries = entries.filter(e => e.organizationId === institutionFilterId)
    if (department) {
      filteredEntries = filteredEntries.filter(e => e.department === department)
    }
    if (academicYear) {
      filteredEntries = filteredEntries.filter(e => e.academicYear === academicYear)
    }

    // Member counts: still per-workspace (members are workspace-scoped). Boards
    // are per-room.
    const workspaceIdsForCounts = Array.from(new Set(filteredEntries.map(e => e.workspaceId)))
    const roomIdsForBoardCounts = filteredEntries.map(e => e.roomId)
    const memberCounts: Record<string, number> = {}
    const boardCountsByRoom: Record<string, number> = {}
    if (workspaceIdsForCounts.length > 0) {
      const { data: membersData } = await supabase
        .from('workspace_members')
        .select('workspace_id')
        .in('workspace_id', workspaceIdsForCounts)
      for (const m of membersData ?? []) {
        const k = m.workspace_id as string
        memberCounts[k] = (memberCounts[k] ?? 0) + 1
      }
    }
    if (roomIdsForBoardCounts.length > 0) {
      const { data: boardsData } = await supabase
        .from('boards')
        .select('room_id')
        .in('room_id', roomIdsForBoardCounts)
        .neq('upload_status', 'pending')
      for (const b of boardsData ?? []) {
        const k = b.room_id as string
        if (!k) continue
        boardCountsByRoom[k] = (boardCountsByRoom[k] ?? 0) + 1
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

    // Transform into bubble nodes. Each bubble is a published room labeled
    // with its workspace+room name so users can tell duplicate "Pin-up 2"
    // entries across classes apart.
    const studios = filteredEntries.map((e) => {
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

      // Bubble label: prefer "{workspace} · {room}" when there's likely more
      // than one published room per workspace; fall back to workspace name
      // alone for legacy entries (single-room workspaces) so the visual
      // doesn't suddenly grow uglier for everyone.
      const label = `${e.workspaceName} · ${e.roomName}`

      return {
        id: e.roomId,
        name: label,
        label,
        roomName: e.roomName,
        workspaceName: e.workspaceName,
        workspaceId: e.workspaceId,
        department: e.department || 'Architecture',
        instructor: e.instructor || undefined,
        semester: undefined,
        year: yearNum,
        academicYear: e.academicYear || undefined,
        memberCount: memberCounts[e.workspaceId] || 0,
        count: boardCountsByRoom[e.roomId] || 0,
        color: BUBBLE_COLOR,
        url: `/studio/${e.roomId}/view`,
        studioId: e.roomId,
      }
    })

    const totals = {
      studios: studios.length,
      students: studios.reduce((sum, s) => sum + (s.memberCount || 0), 0),
    }

    return NextResponse.json(
      { studios, totals, hasOrg: true },
      // Per-user response now (depends on session) — don't share a CDN cache.
      { headers: { 'Cache-Control': 'private, no-store' } }
    )
  } catch (error) {
    console.error('Error fetching studios:', error)
    return NextResponse.json({ error: 'Failed to fetch studios' }, { status: 500 })
  }
}

