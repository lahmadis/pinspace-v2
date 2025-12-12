import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/server'

// Cache public workspaces for 60 seconds to improve performance
export const revalidate = 60
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url)
    const department = url.searchParams.get('department')
    const year = url.searchParams.get('year')

    // Use service role to bypass RLS for public endpoint
    const supabase = supabaseServiceRole()
    
    // Build query for public workspaces
    let query = supabase
      .from('workspaces')
      .select('*')
      .eq('is_public', true)
      .not('published_at', 'is', null)

    // Apply filters
    if (department) {
      query = query.eq('network_metadata->>department', department)
    }
    if (year) {
      query = query.eq('network_metadata->>year', year)
    }

    const { data: publicWorkspaces, error } = await query

    if (error) {
      console.error('Error fetching public workspaces:', error)
      return NextResponse.json({ 
        error: 'Failed to fetch public workspaces', 
        details: error.message || error 
      }, { status: 500 })
    }

    // Get member counts for each workspace
    const workspaceIds = publicWorkspaces?.map(w => w.id) || []
    let memberCounts: Record<string, number> = {}
    
    if (workspaceIds.length > 0) {
      const { data: membersData, error: membersError } = await supabase
        .from('workspace_members')
        .select('workspace_id')
        .in('workspace_id', workspaceIds)

      if (!membersError && membersData) {
        membersData.forEach(member => {
          memberCounts[member.workspace_id] = (memberCounts[member.workspace_id] || 0) + 1
        })
      }
    }

    // Collect unique departments list
    const departments = Array.from(new Set((publicWorkspaces || [])
      .map(w => w.network_metadata?.department)
      .filter(Boolean) as string[]))
      .sort()

    // Transform to frontend format
    const transformedWorkspaces = (publicWorkspaces || []).map(w => ({
      id: w.id,
      name: w.name,
      description: w.description,
      studioId: w.id, // For backward compatibility
      inviteCode: w.invite_code,
      isPublic: w.is_public,
      publishedAt: w.published_at,
      networkMetadata: w.network_metadata,
      instructor: w.instructor,
      type: w.type || 'class',
      memberCount: memberCounts[w.id] || 0,
      members: [], // Not including full member list for public endpoint
    }))

    const response = NextResponse.json({
      departments,
      workspaces: transformedWorkspaces,
    })
    
    // Add caching headers for better performance
    response.headers.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
    
    return response
  } catch (error) {
    console.error('Error fetching public workspaces:', error)
    return NextResponse.json({ 
      error: 'Failed to fetch public workspaces', 
      details: (error as Error).message 
    }, { status: 500 })
  }
}

