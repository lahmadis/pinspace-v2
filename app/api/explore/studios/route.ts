import { NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/server'

// Single color for all bubbles - connections differentiate relationships
const BUBBLE_COLOR = '#6366f1' // Indigo

export async function GET() {
  try {
    // Use service role client to bypass RLS for public endpoint
    // This allows us to fetch public workspaces without authentication
    const supabase = supabaseServiceRole()
    
    // Fetch all public workspaces from Supabase
    const { data: publicWorkspaces, error } = await supabase
      .from('workspaces')
      .select('*')
      .eq('is_public', true)
      .not('published_at', 'is', null) // Only include workspaces that have been published

    if (error) {
      console.error('Error fetching public workspaces:', error)
      return NextResponse.json({ error: 'Failed to fetch studios', details: error.message }, { status: 500 })
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

    // Transform workspaces into studio nodes for the bubble network
    const studios = (publicWorkspaces || []).map((w) => {
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

    const totals = {
      studios: studios.length,
      students: studios.reduce((sum, s) => sum + (s.memberCount || 0), 0),
    }

    console.log(`✅ Fetched ${studios.length} public studios from Supabase`)
    return NextResponse.json({ studios, totals })
  } catch (error) {
    console.error('Error fetching studios:', error)
    return NextResponse.json({ error: 'Failed to fetch studios', details: (error as Error).message }, { status: 500 })
  }
}

