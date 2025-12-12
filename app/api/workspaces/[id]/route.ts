import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'

// GET specific workspace
export async function GET(
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

    const workspaceId = params.id
    console.log('Fetching workspace:', workspaceId)

    // Fetch workspace from Supabase
    const { data: workspace, error } = await supabase
      .from('workspaces')
      .select('*')
      .eq('id', workspaceId)
      .single()

    if (error) {
      console.error('Error fetching workspace:', error)
      if (error.code === 'PGRST116') {
        // No rows returned
        return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
      }
      return NextResponse.json({ 
        error: 'Failed to fetch workspace', 
        details: error.message || error 
      }, { status: 500 })
    }

    if (!workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    // Check if user owns the workspace or is a member
    const isOwner = workspace.owner_id === userId
    
    // Check membership
    const { data: membership } = await supabase
      .from('workspace_members')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .single()

    if (!isOwner && !membership) {
      return NextResponse.json({ error: 'Not a member of this workspace' }, { status: 403 })
    }

    // Transform to frontend format
    // Fetch all members
    const { data: members } = await supabase
      .from('workspace_members')
      .select('*')
      .eq('workspace_id', workspaceId)

    // If no members exist yet, create a default member entry for the owner
    let membersList = members || []
    if (membersList.length === 0 && isOwner) {
      // Add owner as instructor member
      membersList = [{
        user_id: userId,
        name: session.user.user_metadata?.email?.split('@')[0] || 'Owner',
        role: 'instructor',
        created_at: workspace.created_at || new Date().toISOString(),
      }]
    }

    const transformedWorkspace = {
      id: workspace.id,
      name: workspace.name,
      description: workspace.description || null,
      type: workspace.type || 'class',
      createdBy: workspace.owner_id,
      studioId: workspace.id, // For backward compatibility
      members: membersList.map((m: any) => ({
        userId: m.user_id,
        name: m.name || 'Unknown',
        role: m.role || 'student',
        joinedAt: m.created_at || new Date(),
      })),
      inviteCode: workspace.invite_code || workspace.id.substring(0, 8).toUpperCase(), // Generate from ID if no code
      createdAt: workspace.created_at || new Date(),
      isPublic: workspace.is_public || false,
      publishedAt: workspace.published_at || undefined,
      networkMetadata: workspace.network_metadata || undefined,
      instructor: workspace.instructor || undefined,
    }

    console.log('Returning workspace:', transformedWorkspace.id)
    return NextResponse.json({ workspace: transformedWorkspace })
  } catch (error: any) {
    console.error('Unexpected error fetching workspace:', error)
    return NextResponse.json({ 
      error: 'Internal Server Error', 
      details: error?.message || String(error) 
    }, { status: 500 })
  }
}

// DELETE workspace
export async function DELETE(
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

    const workspaceId = params.id
    console.log('Deleting workspace:', workspaceId)

    // Fetch workspace to check ownership
    const { data: workspace, error: fetchError } = await supabase
      .from('workspaces')
      .select('*')
      .eq('id', workspaceId)
      .single()

    if (fetchError || !workspace) {
      console.error('Error fetching workspace:', fetchError)
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    // Check if user owns the workspace
    const isOwner = workspace.owner_id === userId
    
    if (!isOwner) {
      return NextResponse.json({ 
        error: 'Only workspace owners can delete workspaces' 
      }, { status: 403 })
    }

    // Delete all workspace members first (cascade delete should handle this, but being explicit)
    const { error: membersError } = await supabase
      .from('workspace_members')
      .delete()
      .eq('workspace_id', workspaceId)

    if (membersError) {
      console.error('Error deleting workspace members:', membersError)
      // Continue with workspace deletion even if member deletion fails
    }

    // Delete the workspace
    const { error: deleteError } = await supabase
      .from('workspaces')
      .delete()
      .eq('id', workspaceId)
      .eq('owner_id', userId) // Double-check ownership

    if (deleteError) {
      console.error('Error deleting workspace:', deleteError)
      return NextResponse.json({ 
        error: 'Failed to delete workspace', 
        details: deleteError.message || deleteError 
      }, { status: 500 })
    }

    console.log('✅ [API] Workspace deleted:', workspaceId)
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Unexpected error deleting workspace:', error)
    return NextResponse.json({ 
      error: 'Internal Server Error', 
      details: error?.message || String(error) 
    }, { status: 500 })
  }
}

