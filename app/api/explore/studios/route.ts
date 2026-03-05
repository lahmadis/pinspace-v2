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
          const norm = (val: any) => `${val || ''}`.toLowerCase().trim()
          return norm(s.department) === norm(department)
        })
      }

      if (year) {
        filtered = filtered.filter(s => {
          const norm = (val: any) => `${val || ''}`.toLowerCase().trim()
          const numOnly = (val: any) => {
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
          const norm = (val: any) => `${val || ''}`.toLowerCase().trim()
          return norm(s.department) === norm(department)
        })
      }
      
      // Filter by year if provided
      if (year) {
        studios = studios.filter(s => {
          const norm = (val: any) => `${val || ''}`.toLowerCase().trim()
          const numOnly = (val: any) => {
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
    // This allows us to fetch public workspaces without authentication
    const supabase = supabaseServiceRole()

    // Resolve institution filter (optional): by slug or id
    let institutionFilterId: string | null = null
    if (institutionId) {
      institutionFilterId = institutionId
    } else if (institutionSlug) {
      const { data: inst } = await supabase
        .from('institutions')
        .select('id')
        .eq('slug', institutionSlug)
        .single()
      if (inst?.id) institutionFilterId = inst.id
    }
    
    // Build query with filters
    let query = supabase
      .from('workspaces')
      .select('*')
      .eq('is_public', true)
      .not('published_at', 'is', null) // Only include workspaces that have been published

    if (institutionFilterId) {
      query = query.eq('institution_id', institutionFilterId)
    }
    if (department) {
      query = query.eq('network_metadata->>department', department)
    }
    
    // Fetch public workspaces from Supabase (with filters applied)
    const { data: publicWorkspaces, error } = await query

    if (error) {
      console.error('Error fetching public workspaces:', error)
      const { filtered, totals } = getFilteredSampleStudios()
      console.warn('⚠️ Supabase error; returning sample studios only')
      return NextResponse.json(
        { studios: filtered, totals },
        { headers: { 'Cache-Control': `public, s-maxage=${CACHE_MAX_AGE}, stale-while-revalidate=${STALE_WHILE_REVALIDATE}` } }
      )
    }

    // Fetch member counts for each workspace
    const workspaceIds = publicWorkspaces?.map(w => w.id) || []
    let memberCounts: Record<string, number> = {}
    
    if (workspaceIds.length > 0) {
      const { data: membersData, error: membersError } = await supabase
        .from('workspace_members')
        .select('workspace_id')
        .in('workspace_id', workspaceIds)

      if (!membersError && membersData) {
        // Count members per workspace
        membersData.forEach(member => {
          memberCounts[member.workspace_id] = (memberCounts[member.workspace_id] || 0) + 1
        })
      }
    }

    // Filter by year if provided (client-side since year is parsed from metadata)
    let filteredWorkspaces = publicWorkspaces || []
    if (year) {
      filteredWorkspaces = filteredWorkspaces.filter((w) => {
        const wYear = w.network_metadata?.year
        const norm = (val: any) => `${val || ''}`.toLowerCase().trim()
        const numOnly = (val: any) => {
          const m = `${val || ''}`.match(/\d+/)
          return m ? m[0] : `${val || ''}`
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
    
    // Transform workspaces into studio nodes for the bubble network
    const studios = filteredWorkspaces.map((w) => {
      const year = w.network_metadata?.year
      // Parse year - could be "Year 1", "Year 2", etc. or just a number or "Masters"
      let yearNum: number | string = 1
      if (year === 'Masters') {
        yearNum = 'Masters'
      } else if (typeof year === 'string') {
        const match = year.match(/\d+/)
        yearNum = match ? parseInt(match[0]) : 1
      } else if (typeof year === 'number') {
        yearNum = year
      }
      
      return {
        id: w.id,
        name: w.name,
        label: w.name,
        department: w.network_metadata?.department || 'Architecture',
        instructor: w.instructor || undefined,
        semester: undefined, // Not stored in DB currently
        year: yearNum,
        memberCount: memberCounts[w.id] || 0,
        count: memberCounts[w.id] || 0,
        color: BUBBLE_COLOR, // Same color for all - connections differentiate
        url: `/studio/${w.id}/view`,
        studioId: w.id,
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
    return NextResponse.json({ error: 'Failed to fetch studios', details: (error as Error).message }, { status: 500 })
  }
}

