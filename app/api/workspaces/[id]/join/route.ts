import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'

// JOIN workspace - Add user to workspace_members table
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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

    const body = await request.json()
    const { userName } = body
    const workspaceId = params.id

    if (!userName) {
      return NextResponse.json({ error: 'User name required' }, { status: 400 })
    }

    // Check if workspace exists
    const { data: workspace, error: workspaceError } = await supabase
      .from('workspaces')
      .select('id, name')
      .eq('id', workspaceId)
      .single()

    if (workspaceError || !workspace) {
      console.error('Error fetching workspace:', workspaceError)
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    // Check if already a member
    const { data: existingMember, error: memberCheckError } = await supabase
      .from('workspace_members')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .single()

    if (existingMember) {
      console.log('✅ User already a member of workspace:', workspaceId)
      return NextResponse.json({ 
        success: true, 
        workspace: {
          id: workspace.id,
          name: workspace.name,
        },
        alreadyMember: true 
      })
    }

    // Add user as student member
    const { data: newMember, error: insertError } = await supabase
      .from('workspace_members')
      .insert({
        workspace_id: workspaceId,
        user_id: userId,
        name: userName,
        role: 'student',
        joined_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (insertError) {
      console.error('Error adding member to workspace:', insertError)
      return NextResponse.json({ 
        error: 'Failed to join workspace', 
        details: insertError.message || insertError 
      }, { status: 500 })
    }

    console.log('✅ [API] User joined workspace:', userId, '→', workspaceId)
    return NextResponse.json({ 
      success: true, 
      workspace: {
        id: workspace.id,
        name: workspace.name,
      }
    })
  } catch (error) {
    console.error('Error joining workspace:', error)
    return NextResponse.json({ 
      error: 'Failed to join workspace', 
      details: (error as Error).message 
    }, { status: 500 })
  }
}

