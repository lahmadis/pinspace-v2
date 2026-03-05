import { NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'

// GET: list workspaces owned by or shared with the current user
export async function GET() {
  try {
    const supabase = supabaseServer()
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession()
    
    if (sessionError) {
      console.error('Session error:', sessionError)
      return NextResponse.json({ error: 'Failed to get session', details: sessionError }, { status: 500 })
    }
    
    const userId = session?.user?.id
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Fetch owned workspaces
    const { data: owned, error: ownedErr } = await supabase
      .from('workspaces')
      .select('*')
      .eq('owner_id', userId)

    if (ownedErr) {
      console.error('Error fetching owned workspaces:', ownedErr)
      return NextResponse.json({ 
        error: 'Failed to fetch owned workspaces', 
        details: ownedErr.message || ownedErr 
      }, { status: 500 })
    }

    // Fetch workspace memberships
    const { data: memberRows, error: memErr } = await supabase
      .from('workspace_members')
      .select('workspace_id')
      .eq('user_id', userId)

    if (memErr) {
      console.error('Error fetching workspace members:', memErr)
      return NextResponse.json({ 
        error: 'Failed to fetch workspace members', 
        details: memErr.message || memErr 
      }, { status: 500 })
    }

    // Fetch workspaces where user is a member
    const memberIds = memberRows?.map((r) => r.workspace_id) ?? []
    let memberWorkspaces: any[] = []
    
    if (memberIds.length > 0) {
      const { data, error: memberWsErr } = await supabase
        .from('workspaces')
        .select('*')
        .in('id', memberIds)

      if (memberWsErr) {
        console.error('Error fetching member workspaces:', memberWsErr)
        return NextResponse.json({ 
          error: 'Failed to fetch member workspaces', 
          details: memberWsErr.message || memberWsErr 
        }, { status: 500 })
      }
      
      memberWorkspaces = data ?? []
    }

    const allWorkspaces = [...(owned ?? []), ...memberWorkspaces]

    // Fetch board counts for all workspaces in one query
    const wsIds = allWorkspaces.map((w) => w.id)
    let boardCountMap: Record<string, number> = {}
    if (wsIds.length > 0) {
      const { data: boardRows } = await supabase
        .from('boards')
        .select('workspace_id')
        .in('workspace_id', wsIds)
      if (boardRows) {
        for (const row of boardRows) {
          boardCountMap[row.workspace_id] = (boardCountMap[row.workspace_id] || 0) + 1
        }
      }
    }

    const result = allWorkspaces.map((w) => ({ ...w, board_count: boardCountMap[w.id] ?? 0 }))
    return NextResponse.json(result)
  } catch (error: any) {
    console.error('Unexpected error in GET /api/workspaces:', error)
    return NextResponse.json({ 
      error: 'Internal Server Error', 
      details: error?.message || String(error) 
    }, { status: 500 })
  }
}

// POST: create a workspace owned by the current user
export async function POST(req: Request) {
  try {
    const supabase = supabaseServer()
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession()
    
    if (sessionError) {
      console.error('Session error:', sessionError)
      return NextResponse.json({ error: 'Failed to get session', details: sessionError }, { status: 500 })
    }
    
    const userId = session?.user?.id
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json().catch(() => null)
    const name = body?.name?.trim()
    const description = body?.description?.trim() ?? null
    const type = body?.type || 'class' // 'class' or 'personal'
    const institutionIdFromBody = body?.institution_id ?? null
    const institutionSlugFromBody = body?.institution_slug?.trim() ?? null

    if (!name) {
      return NextResponse.json({ error: 'Name required' }, { status: 400 })
    }

    // Resolve institution_id: from body or default to Wentworth (slug "wit")
    const supabaseAdmin = supabaseServiceRole()
    let institutionId: string | null = null
    if (institutionIdFromBody) {
      const { data: inst } = await supabaseAdmin
        .from('institutions')
        .select('id')
        .eq('id', institutionIdFromBody)
        .single()
      if (inst?.id) institutionId = inst.id
    }
    if (!institutionId && institutionSlugFromBody) {
      const { data: inst } = await supabaseAdmin
        .from('institutions')
        .select('id')
        .eq('slug', institutionSlugFromBody)
        .single()
      if (inst?.id) institutionId = inst.id
    }
    if (!institutionId) {
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('institution_id')
        .eq('user_id', userId)
        .maybeSingle()
      if (profile?.institution_id) institutionId = profile.institution_id
    }

    // Insert workspace
    // Try with type first, if it fails (column doesn't exist), try without type
    let insertData: any = { name, description, owner_id: userId }
    if (institutionId) insertData.institution_id = institutionId

    // Only include type if the column exists (we'll try with it first)
    const { data, error } = await supabase
      .from('workspaces')
      .insert({ ...insertData, type })
      .select()
      .single()

    if (error) {
      console.error('Error creating workspace (with type):', error)
      
      // If error is about column not existing, try without type
      if (error.message?.includes('column') && error.message?.includes('type')) {
        const { data: dataWithoutType, error: errorWithoutType } = await supabase
          .from('workspaces')
          .insert(insertData)
          .select()
          .single()
        
        if (errorWithoutType) {
          console.error('Error creating workspace (without type):', errorWithoutType)
          return NextResponse.json({ 
            error: 'Failed to create workspace', 
            details: errorWithoutType.message || errorWithoutType 
          }, { status: 500 })
        }
        
        return NextResponse.json(dataWithoutType, { status: 201 })
      }
      
      return NextResponse.json({ 
        error: 'Failed to create workspace', 
        details: error.message || error 
      }, { status: 500 })
    }

    return NextResponse.json(data, { status: 201 })
  } catch (error: any) {
    console.error('Unexpected error in POST /api/workspaces:', error)
    return NextResponse.json({ 
      error: 'Internal Server Error', 
      details: error?.message || String(error) 
    }, { status: 500 })
  }
}

