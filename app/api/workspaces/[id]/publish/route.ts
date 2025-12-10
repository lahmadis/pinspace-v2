import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'

// PATCH - Publish/Unpublish workspace with metadata
export async function PATCH(
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
    console.log('Publishing/unpublishing workspace:', workspaceId)

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
    
    // Check if user is an instructor member
    const { data: membership } = await supabase
      .from('workspace_members')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .single()

    const isInstructor = isOwner || membership?.role === 'instructor'

    if (!isInstructor) {
      return NextResponse.json({ 
        error: 'Only workspace owners or instructors can publish/unpublish workspaces' 
      }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const desiredIsPublic = body.isPublic ?? !workspace.is_public

    // Prepare update data
    const updateData: any = {
      is_public: desiredIsPublic,
    }

    // If publishing, validate and set metadata
    if (desiredIsPublic) {
      const metadata = body.networkMetadata
      const instructor = body.instructor

      if (!metadata || !metadata.department || !metadata.year) {
        return NextResponse.json({ 
          error: 'Please select department and year' 
        }, { status: 400 })
      }

      updateData.network_metadata = metadata
      updateData.instructor = instructor || null
      updateData.published_at = new Date().toISOString()
    } else {
      // Unpublishing - keep metadata but clear published_at
      updateData.published_at = null
    }

    // Update workspace in Supabase
    const { data: updatedWorkspace, error: updateError } = await supabase
      .from('workspaces')
      .update(updateData)
      .eq('id', workspaceId)
      .select()
      .single()

    if (updateError) {
      console.error('Error updating workspace:', updateError)
      return NextResponse.json({ 
        error: 'Failed to update workspace', 
        details: updateError.message || updateError 
      }, { status: 500 })
    }

    console.log(`${desiredIsPublic ? '🌐 Published' : '🔒 Unpublished'} workspace:`, workspaceId)

    // Transform to frontend format
    const transformedWorkspace = {
      id: updatedWorkspace.id,
      name: updatedWorkspace.name,
      description: updatedWorkspace.description,
      type: updatedWorkspace.type || 'class',
      createdBy: updatedWorkspace.owner_id,
      studioId: updatedWorkspace.id,
      inviteCode: updatedWorkspace.invite_code || updatedWorkspace.id.substring(0, 8).toUpperCase(),
      createdAt: updatedWorkspace.created_at,
      isPublic: updatedWorkspace.is_public || false,
      publishedAt: updatedWorkspace.published_at || undefined,
      networkMetadata: updatedWorkspace.network_metadata || undefined,
      instructor: updatedWorkspace.instructor || undefined,
    }

    return NextResponse.json({ 
      success: true, 
      workspace: transformedWorkspace,
      isPublic: updatedWorkspace.is_public 
    })
  } catch (error: any) {
    console.error('Unexpected error toggling workspace publication:', error)
    return NextResponse.json({ 
      error: 'Internal Server Error', 
      details: error?.message || String(error) 
    }, { status: 500 })
  }
}

