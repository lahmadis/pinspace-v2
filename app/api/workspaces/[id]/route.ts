import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'
import { validateName } from '@/lib/validation/safeName'
import { isSuperadmin, isNetworkPublished } from '@/lib/auth/superadmin'
import { collectBoardStoragePaths } from '@/lib/storage/boardObjects'
import { generateInviteCode } from '@/lib/workspaceUtils'
import {
  listStorageObjectPaths,
  loadBoardObjectRows,
  loadWallConfigModelPaths,
} from '@/lib/storage/supabaseCleanup'

// GET specific workspace
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await supabaseServer()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = user.id

    const workspaceId = (await params).id

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
      .select('id, name, display_order, is_published, published_at, created_at, wall_color')
      .eq('workspace_id', workspaceId)
      .order('display_order', { ascending: true })
      .order('created_at', { ascending: true })

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

    // Platform-superadmin flag for THIS viewer. Computed once here and reused
    // both for the network-published read gate below and for the response, which
    // the studio page reads to widen wall-config edit permission (owner OR
    // superadmin OR member) without a second round trip. This is the raw platform
    // role — not scoped to network-published like `isSuperadminViewer` below.
    const viewerIsSuperadmin = await isSuperadmin(userId, admin)

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

    // Platform superadmin: READ-ONLY access to network-published workspaces, in
    // addition to the checks above. Verified server-side via service role from
    // the authenticated user id. Scoped strictly to published-to-network
    // content — a superadmin gets NO access to unpublished workspaces here.
    let isSuperadminViewer = false
    if (!isOwner && !isMember && !isPublicPublished && !orgMatchClass) {
      isSuperadminViewer =
        viewerIsSuperadmin &&
        (await isNetworkPublished(admin, { workspaceId }))
    }

    if (!isOwner && !isMember && !isPublicPublished && !orgMatchClass && !isSuperadminViewer) {
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
            name: user.email?.split('@')[0] || 'Owner',
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

    let inviteCode = workspace.invite_code
    if (isOwner && (!inviteCode || typeof inviteCode !== 'string' || inviteCode.trim() === '' || inviteCode === 'undefined')) {
      inviteCode = generateInviteCode()
      await admin
        .from('workspaces')
        .update({ invite_code: inviteCode })
        .eq('id', workspaceId)
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
      inviteCode: (isOwner || membersList.some((m) => m.user_id === userId && m.role === 'instructor')) ? inviteCode || undefined : undefined,
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
        wallColor: (r.wall_color as 'grey' | 'white' | null) ?? 'grey',
        boardCount: boardCountByRoom.get(r.id as string) ?? 0,
      })),
    }

    // `isSuperadmin` is a sibling of `workspace` (a viewer property, not a
    // workspace one). The studio page folds it into wall-config edit permission.
    return NextResponse.json({ workspace: transformedWorkspace, isSuperadmin: viewerIsSuperadmin })
  } catch (error) {
    console.error('Unexpected error fetching workspace:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

// PATCH workspace (e.g. rename)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await supabaseServer()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = user.id

    const workspaceId = (await params).id
    const body = await request.json().catch(() => ({}))
    const { name, description } = body

    // Phase 10: any workspace member (any role) may rename. A rename is a
    // name-only PATCH; changing any other field (e.g. description) stays
    // owner-only.
    const wantsName = name !== undefined
    const wantsDescription = typeof description === 'string'
    const isNameOnlyRename = wantsName && !wantsDescription

    // Read + write via service role: the workspaces RLS has no membership-based
    // SELECT/UPDATE policy (see GET above), so a non-owner member can neither
    // read nor write their own workspace under the user session. Access is
    // enforced in application code below.
    const admin = supabaseServiceRole()
    const { data: workspace, error: fetchError } = await admin
      .from('workspaces')
      .select('owner_id')
      .eq('id', workspaceId)
      .maybeSingle()

    if (fetchError || !workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    const isOwner = workspace.owner_id === userId

    if (!isOwner) {
      // Non-owners may ONLY perform a name-only rename, and only if they are a
      // member of the workspace. Any other change stays owner-only.
      if (!isNameOnlyRename) {
        return NextResponse.json({ error: 'Only workspace owners can update the workspace' }, { status: 403 })
      }
      const { data: membership } = await admin
        .from('workspace_members')
        .select('user_id')
        .eq('workspace_id', workspaceId)
        .eq('user_id', userId)
        .maybeSingle()
      if (!membership) {
        return NextResponse.json({ error: 'Only workspace members can rename the workspace' }, { status: 403 })
      }
    }

    const updateData: { name?: string; description?: string } = {}
    if (name !== undefined) {
      const nameResult = validateName(name, { maxLength: 100, fieldLabel: 'Workspace name' })
      if (!nameResult.ok) {
        return NextResponse.json({ error: nameResult.error }, { status: 400 })
      }
      updateData.name = nameResult.value
    }
    if (typeof description === 'string') updateData.description = description

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    const { error: updateError } = await admin
      .from('workspaces')
      .update(updateData)
      .eq('id', workspaceId)

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
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await supabaseServer()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = user.id

    const workspaceId = (await params).id

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

    // Inventory every object the database cascade will stop referencing before
    // the destructive write. If this fails, leave the workspace intact so the
    // cleanup can be retried safely rather than knowingly creating orphans.
    const admin = supabaseServiceRole()
    let workspaceBoardPaths: Set<string>
    let workspaceConfigPaths: string[]
    let workspaceModelPaths: Set<string>
    try {
      workspaceBoardPaths = collectBoardStoragePaths(
        await loadBoardObjectRows(admin, workspaceId)
      )
      const allConfigPaths = await listStorageObjectPaths(admin, 'wall-configs')
      const legacyConfigPath = `wall-configs/${workspaceId}.json`
      const roomConfigPrefix = `wall-configs/${workspaceId}/`
      workspaceConfigPaths = allConfigPaths.filter(
        (path) => path === legacyConfigPath || path.startsWith(roomConfigPrefix)
      )
      workspaceModelPaths = await loadWallConfigModelPaths(admin, workspaceConfigPaths)
    } catch (inventoryError) {
      console.error('Failed to inventory workspace storage before deletion:', inventoryError)
      return NextResponse.json({ error: 'Failed to prepare workspace deletion' }, { status: 500 })
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

    // Database deletion has succeeded. Cleanup is now best-effort and fail-safe:
    // never return a retryable 500 for an already-deleted workspace, and never
    // remove a candidate still referenced by a surviving board or wall config.
    try {
      if (workspaceConfigPaths.length > 0) {
        const { error: configCleanupError } = await admin.storage
          .from('board-images')
          .remove(workspaceConfigPaths)
        if (configCleanupError) {
          console.error('Failed to remove deleted workspace wall configs:', configCleanupError)
        }
      }

      const remainingBoardPaths = collectBoardStoragePaths(await loadBoardObjectRows(admin))
      const remainingConfigPaths = await listStorageObjectPaths(admin, 'wall-configs')
      const remainingModelPaths = await loadWallConfigModelPaths(admin, remainingConfigPaths)
      const unreferencedWorkspaceObjects = Array.from(
        new Set([...workspaceBoardPaths, ...workspaceModelPaths])
      ).filter(
        (path) => !remainingBoardPaths.has(path) && !remainingModelPaths.has(path)
      )

      if (unreferencedWorkspaceObjects.length > 0) {
        const { error: objectCleanupError } = await admin.storage
          .from('board-images')
          .remove(unreferencedWorkspaceObjects)
        if (objectCleanupError) {
          console.error('Failed to remove deleted workspace objects:', objectCleanupError)
        }
      }
    } catch (cleanupError) {
      console.error('Workspace deleted but storage cleanup could not complete:', cleanupError)
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Unexpected error deleting workspace:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
