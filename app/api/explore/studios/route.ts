import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/server'
import { getDemoStudios, getDemoTotals } from '@/lib/mockData'
import { getSampleStudios } from '@/lib/sampleData'

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
    const institutionSlug = searchParams.get('institution_slug')
    const institutionId = searchParams.get('institution_id')

    // Helper: filter + decorate sample studios with optional department/year filters
    const getFilteredSampleStudios = () => {
      const sampleStudios = getSampleStudios()
      let filtered = sampleStudios.map(s => ({
        ...s,
        boundingBox: { width: 20, depth: 15 } // Default footprint for sample studios
      }))

      if (department) {
        filtered = filtered.filter(s => {
          const norm = (val: string | number | null | undefined) => `${val || ''}`.toLowerCase().trim()
          return norm(s.department) === norm(department)
        })
      }

      if (year) {
        filtered = filtered.filter(s => {
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

      const totals = {
        studios: filtered.length,
        students: filtered.reduce((sum, s) => sum + (s.memberCount || 0), 0),
      }

      return { filtered, totals }
    }

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
    
    // If service role key is missing locally, fall back to sample data instead of erroring
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const { filtered, totals } = getFilteredSampleStudios()
      console.warn('⚠️ SUPABASE_SERVICE_ROLE_KEY missing; returning sample studios only')
      return NextResponse.json(
        { studios: filtered, totals },
        { headers: { 'Cache-Control': `public, s-maxage=${CACHE_MAX_AGE}, stale-while-revalidate=${STALE_WHILE_REVALIDATE}` } }
      )
    }

    // Use service role client to bypass RLS for public endpoint
    const supabase = supabaseServiceRole()

    // Resolve institution filter (optional): by slug or id
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

    // Phase 6.2c: bubble per published room, not per published workspace.
    // Primary path queries rooms.is_published with parent workspace metadata
    // joined for filtering/labeling. A legacy fallback synthesizes one
    // published-room row per workspace whose is_public=true is set but whose
    // rooms.is_published was never flipped (e.g. workspace published before
    // 6.2c shipped, instructor never opened settings to flip per-room).

    type WorkspaceLite = {
      id: string
      name: string
      organization_id: string | null
      network_metadata: { department?: string; year?: string | number } | null
      academic_year: string | null
      instructor: string | null
      is_globally_public: boolean | null
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
      isGloballyPublic: boolean
    }

    // 1. Primary: explicitly published rooms with workspace metadata joined.
    // PostgREST embedded resource returns workspaces as a nested object.
    const primaryQuery = supabase
      .from('rooms')
      .select(`
        id,
        name,
        workspace_id,
        is_globally_public,
        workspaces:workspace_id (
          id,
          name,
          organization_id,
          network_metadata,
          academic_year,
          instructor,
          is_globally_public
        )
      `)
      .eq('is_published', true)

    const { data: publishedRoomRows, error: primaryError } = await primaryQuery

    if (primaryError) {
      console.error('Error fetching published rooms:', primaryError)
      const { filtered, totals } = getFilteredSampleStudios()
      console.warn('⚠️ Supabase error on rooms query; returning sample studios only')
      return NextResponse.json(
        { studios: filtered, totals },
        { headers: { 'Cache-Control': `public, s-maxage=${CACHE_MAX_AGE}, stale-while-revalidate=${STALE_WHILE_REVALIDATE}` } }
      )
    }

    const entries: PublishedEntry[] = []
    const workspaceIdsAlreadyCovered = new Set<string>()
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
        isGloballyPublic: Boolean((r as { is_globally_public?: boolean }).is_globally_public ?? ws.is_globally_public),
      })
      workspaceIdsAlreadyCovered.add(r.workspace_id as string)
    }

    // 2. Legacy fallback: workspaces with the old workspace-level publish flag
    // whose rooms haven't been individually flipped. Synthesize a published
    // entry from each workspace's first room (display_order ASC).
    const { data: legacyWorkspaces } = await supabase
      .from('workspaces')
      .select('id, name, organization_id, network_metadata, academic_year, instructor, is_globally_public')
      .eq('is_public', true)
      .not('published_at', 'is', null)

    const legacyCandidates = (legacyWorkspaces ?? []).filter(
      w => !workspaceIdsAlreadyCovered.has(w.id as string)
    ) as WorkspaceLite[]
    if (legacyCandidates.length > 0) {
      const { data: legacyRooms } = await supabase
        .from('rooms')
        .select('id, name, workspace_id, display_order, created_at')
        .in('workspace_id', legacyCandidates.map(w => w.id))
        .order('display_order', { ascending: true })
        .order('created_at', { ascending: true })

      const firstRoomByWorkspace = new Map<string, { id: string; name: string }>()
      for (const r of legacyRooms ?? []) {
        const wsId = r.workspace_id as string
        if (!firstRoomByWorkspace.has(wsId)) {
          firstRoomByWorkspace.set(wsId, { id: r.id as string, name: r.name as string })
        }
      }
      for (const w of legacyCandidates) {
        const fr = firstRoomByWorkspace.get(w.id)
        if (!fr) continue
        entries.push({
          roomId: fr.id,
          roomName: fr.name,
          workspaceId: w.id,
          workspaceName: w.name,
          department: w.network_metadata?.department ?? null,
          year: w.network_metadata?.year ?? null,
          academicYear: w.academic_year,
          instructor: w.instructor,
          organizationId: w.organization_id,
          isGloballyPublic: Boolean(w.is_globally_public),
        })
      }
    }

    // Apply filters (institution / department / academicYear / globally public).
    let filteredEntries = entries
    if (institutionFilterId) {
      filteredEntries = filteredEntries.filter(e => e.organizationId === institutionFilterId)
    } else {
      // No institution filter → global view: only show globally-published rooms.
      filteredEntries = filteredEntries.filter(e => e.isGloballyPublic)
    }
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
        isGloballyPublic: e.isGloballyPublic,
      }
    })

    // When institution filter is present, return only real Supabase studios (no sample merge).
    // When no institution param, keep backward-compatible merged behavior.
    const { filtered: filteredSampleStudios } = getFilteredSampleStudios()
    const allStudios = institutionFilterId
      ? studios
      : [...studios, ...filteredSampleStudios]
    
    const totals = {
      studios: allStudios.length,
      students: allStudios.reduce((sum, s) => sum + (s.memberCount || 0), 0),
    }

    return NextResponse.json(
      { studios: allStudios, totals },
      { headers: { 'Cache-Control': `public, s-maxage=${CACHE_MAX_AGE}, stale-while-revalidate=${STALE_WHILE_REVALIDATE}` } }
    )
  } catch (error) {
    console.error('Error fetching studios:', error)
    return NextResponse.json({ error: 'Failed to fetch studios' }, { status: 500 })
  }
}

