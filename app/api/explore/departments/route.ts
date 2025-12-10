import { NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/server'

const DEPARTMENTS = [
  { name: 'Architecture', slug: 'architecture' },
  { name: 'Interior Design', slug: 'interior-design' },
  { name: 'Industrial Design', slug: 'industrial-design' },
]

export async function GET() {
  try {
    // Use service role to bypass RLS for public endpoint
    const supabase = supabaseServiceRole()
    
    // Fetch all public workspaces
    const { data: publicWorkspaces, error } = await supabase
      .from('workspaces')
      .select('id, network_metadata')
      .eq('is_public', true)
      .not('published_at', 'is', null)

    if (error) {
      console.error('Error fetching workspaces:', error)
      return NextResponse.json({ 
        error: 'Failed to fetch departments', 
        details: error.message || error 
      }, { status: 500 })
    }

    // Get member counts for totals
    const workspaceIds = publicWorkspaces?.map(w => w.id) || []
    let totalStudents = 0
    
    if (workspaceIds.length > 0) {
      const { count, error: countError } = await supabase
        .from('workspace_members')
        .select('*', { count: 'exact', head: true })
        .in('workspace_id', workspaceIds)

      if (!countError && count) {
        totalStudents = count
      }
    }

    // Count studios per department
    const departments = DEPARTMENTS.map((d) => {
      const count = (publicWorkspaces || []).filter(w => 
        w.network_metadata?.department === d.name
      ).length
      return {
        name: d.name,
        slug: d.slug,
        studioCount: count,
      }
    })

    const totals = {
      studios: publicWorkspaces?.length || 0,
      students: totalStudents,
    }

    return NextResponse.json({ departments, totals })
  } catch (error) {
    console.error('Error fetching departments:', error)
    return NextResponse.json({ 
      error: 'Failed to fetch departments', 
      details: (error as Error).message 
    }, { status: 500 })
  }
}







