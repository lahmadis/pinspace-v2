import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'

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
      return NextResponse.json({ error: 'Failed to get session' }, { status: 500 })
    }

    const userId = session?.user?.id
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const workspaceId = params.id

    // Read via service role and enforce access in application code. The
    // workspaces RLS has no membership-based SELECT policy, so a member —
    // especially one outside the workspace's org (peer-to-peer shared rooms) —
    // cannot read their own workspace under the user session. Service-role read
    // plus the explicit owner/member/public/org checks below are the boundary.
    const admin = supabaseServiceRole()
    const { data: workspace, error } = await admin
      .from('workspaces')
      .select('*')
      .eq('id', workspaceId)
      .maybeSingle()

    if (error) {
      console.error('Error fetching workspace:', error)
      return NextResponse.json({ error: 'Failed to fetch workspace' }, { status: 500 })
    }

    if (!workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    // Fetch institution when workspace has institution_id
    let institution: { id: string; name: string; slug: string; network_label?: string } | undefined
    if (workspace.organization_id) {
      const { data: inst } = await admin
        .from('organizations')
        .select('id, name, slug, network_label')
        .eq('id', workspace.organization_id)
        .single()
      if (inst) institution = inst
    }

    // Fetch rooms in this workspace so settings + rooms-list UI can render
    // without a second round-trip. Ordered by display_order so the UI matches
    // the order owners curated.
    const { data: roomRows } = await admin
      .from('rooms')
      .select('id, name, display_order, is_published, published_at, created_at')
      .eq('workspace_id', workspaceId)
      .order('display_order', { ascending: true })

    // Per-room board counts for the rooms list page. One query, grouped client-
    // side. Excludes pending uploads to match what the studio actually shows.
    const roomIds = (roomRows ?? []).map((r) => r.id as string)
    const boardCountByRoom = new Map<string, number>()
    if (roomIds.length > 0) {
      const { data: boardRows } = await admin
        .from('boards')
        .select('room_id')
        .in('room_id', roomIds)
        .neq('upload_status', 'pending')
      for (const b of boardRows ?? []) {
        const k = b.room_id as string
        boardCountByRoom.set(k, (boardCountByRoom.get(k) ?? 0) + 1)
      }
    }

    // Check if user owns the workspace or is a member
    const isOwner = workspace.owner_id === userId

    // Check membership
    const { data: membership, error: membershipError } = await admin
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle()

    if (membershipError) {
      console.error('Error checking workspace membership:', membershipError)
      return NextResponse.json({ error: 'Failed to verify access' }, { status: 500 })
    }

    const isMember = membership !== null
    const isPublicPublished = workspace.is_public === true && workspace.published_at != null

    // Org members may view their own org's classes (mirrors the old RLS policy).
    let orgMatchClass = false
    if (!isOwner && !isMember && !isPublicPublished && workspace.type === 'class' && workspace.organization_id) {
      const { data: viewerProfile } = await admin
        .from('user_profiles')
        .select('organization_id')
        .eq('user_id', userId)
        .maybeSingle()
      orgMatchClass = viewerProfile?.organization_id === workspace.organization_id
    }

    if (!isOwner && !isMember && !isPublicPublished && !orgMatchClass) {
      // Shared rooms are joinable by link: tell the client to route the visitor
      // into the join/prompt flow (the /join/{code} page) instead of erroring.
      if (workspace.type === 'shared') {
        if (workspace.invite_code) {
          return NextResponse.json({
            canJoin: true,
            id: workspace.id,
            name: workspace.name,
            inviteCode: workspace.invite_code,
          })
        }
        return NextResponse.json(
          { error: 'This workspace doesn’t have an invite link yet. Ask the owner to share one.' },
          { status: 403 }
        )
      }
      return NextResponse.json({ error: 'Not a member of this workspace' }, { status: 403 })
    }

    // Transform to frontend format
    // Fetch all members
    const { data: members } = await admin
      .from('workspace_members')
      .select('*')
      .eq('workspace_id', workspaceId)

    // Ensure the workspace owner appears as `role: 'instructor'` in the
    // response. Three cases:
    //   1. Brand-new workspace where nothing has been written to
    //      workspace_members yet → append owner row.
    //   2. Legacy workspace with student rows from invites/joins but no
    //      owner row (created before `ensureOwnerMembership` in POST
    //      /api/workspaces) → append owner row.
    //   3. Legacy workspace where the owner IS in workspace_members but
    //      with role='student' (e.g. owner joined their own workspace via
    //      invite code in an older flow) → upgrade the response copy to
    //      'instructor'. Response-only — we do NOT mutate the DB row,
    //      keeping this migration-free and reversible. The mutation APIs
    //      gate on workspace.owner_id, not on members.role, so leaving the
    //      DB row alone is safe for auth.
    let membersList = members || []
    if (isOwner) {
      const ownerIndex = membersList.findIndex((m) => m.user_id === userId)
      if (ownerIndex === -1) {
        membersList = [
          ...membersList,
          {
            user_id: userId,
            name: session.user.user_metadata?.email?.split('@')[0] || 'Owner',
            role: 'instructor',
            created_at: workspace.created_at || new Date().toISOString(),
          },
        ]
      } else if (membersList[ownerIndex].role !== 'instructor') {
        membersList = [
          ...membersList.slice(0, ownerIndex),
          { ...membersList[ownerIndex], role: 'instructor' },
          ...membersList.slice(ownerIndex + 1),
        ]
      }
    }

    const transformedWorkspace = {
      id: workspace.id,
      name: workspace.name,
      description: workspace.description || null,
      type: workspace.type || 'class',
      createdBy: workspace.owner_id,
      studioId: workspace.id, // For backward compatibility
      members: membersList.map((m) => ({
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
      academicYear: workspace.academic_year || undefined,
      instructor: workspace.instructor || undefined,
      institutionId: workspace.organization_id || undefined,
      institution: institution || undefined,
      isArchived: workspace.is_archived ?? false,
      archivedAt: workspace.archived_at ?? null,
      rooms: (roomRows ?? []).map((r) => ({
        id: r.id as string,
        name: r.name as string,
        displayOrder: Number(r.display_order ?? 0),
        isPublished: Boolean(r.is_published),
        publishedAt: (r.published_at as string | null) ?? null,
        createdAt: (r.created_at as string | null) ?? null,
        boardCount: boardCountByRoom.get(r.id as string) ?? 0,
      })),
    }

    return NextResponse.json({ workspace: transformedWorkspace })
  } catch (error) {
    console.error('Unexpected error fetching workspace:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

// PATCH workspace (e.g. rename)
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
    const body = await request.json().catch(() => ({}))
    const { name, description } = body

    const { data: workspace, error: fetchError } = await supabase
      .from('workspaces')
      .select('owner_id')
      .eq('id', workspaceId)
      .single()

    if (fetchError || !workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    if (workspace.owner_id !== userId) {
      return NextResponse.json({ error: 'Only workspace owners can update the workspace' }, { status: 403 })
    }

    const updateData: { name?: string; description?: string } = {}
    if (typeof name === 'string' && name.trim()) updateData.name = name.trim()
    if (typeof description === 'string') updateData.description = description

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    const { error: updateError } = await supabase
      .from('workspaces')
      .update(updateData)
      .eq('id', workspaceId)
      .eq('owner_id', userId)

    if (updateError) {
      console.error('Error updating workspace:', updateError)
      return NextResponse.json({ error: 'Failed to update workspace' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Unexpected error updating workspace:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
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
      return NextResponse.json({ error: 'Failed to delete workspace' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Unexpected error deleting workspace:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
