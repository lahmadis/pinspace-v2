import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { currentAcademicYear } from '@/lib/academicYear'

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
      return NextResponse.json({ error: 'Failed to get session' }, { status: 500 })
    }

    const userId = session?.user?.id
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const workspaceId = params.id

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

    // Global-only toggle: body has isGloballyPublic but no isPublic
    // Workspace must already be institution-published for this to work
    if (body.isGloballyPublic !== undefined && body.isPublic === undefined) {
      if (!workspace.is_public) {
        return NextResponse.json({
          error: 'Workspace must be published to the institution network first'
        }, { status: 400 })
      }

      const { data: updatedWorkspace, error: updateError } = await supabase
        .from('workspaces')
        .update({ is_globally_public: body.isGloballyPublic })
        .eq('id', workspaceId)
        .select()
        .single()

      if (updateError) {
        console.error('Error updating workspace:', updateError)
        return NextResponse.json({ error: 'Failed to update workspace' }, { status: 500 })
      }

      return NextResponse.json({
        success: true,
        workspace: {
          id: updatedWorkspace.id,
          name: updatedWorkspace.name,
          isPublic: updatedWorkspace.is_public || false,
          isGloballyPublic: updatedWorkspace.is_globally_public || false,
        },
        isGloballyPublic: updatedWorkspace.is_globally_public,
      })
    }

    const desiredIsPublic = body.isPublic ?? !workspace.is_public

    // Prepare update data
    const updateData: Record<string, unknown> = {
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
      updateData.academic_year = body.academicYear || currentAcademicYear()
      updateData.published_at = new Date().toISOString()
      updateData.is_globally_public = body.isGloballyPublic ?? false
    } else {
      // Unpublishing - reset both institution and global flags
      updateData.published_at = null
      updateData.is_globally_public = false
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
      return NextResponse.json({ error: 'Failed to update workspace' }, { status: 500 })
    }

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
      isGloballyPublic: updatedWorkspace.is_globally_public || false,
      publishedAt: updatedWorkspace.published_at || undefined,
      networkMetadata: updatedWorkspace.network_metadata || undefined,
      academicYear: updatedWorkspace.academic_year || undefined,
      instructor: updatedWorkspace.instructor || undefined,
    }

    return NextResponse.json({
      success: true,
      workspace: transformedWorkspace,
      isPublic: updatedWorkspace.is_public,
      isGloballyPublic: updatedWorkspace.is_globally_public,
    })
  } catch (error) {
    console.error('Unexpected error toggling workspace publication:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
