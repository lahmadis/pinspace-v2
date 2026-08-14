import { NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'
import { isInstructorAccount } from '@/lib/auth/getAccountRole'
import { validateName } from '@/lib/validation/safeName'
import { createWorkspace } from '@/lib/workspaces/createWorkspace'

// GET: list workspaces owned by or shared with the current user
export async function GET() {
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

    // Service role for read; access is scoped in app code via owner_id/membership
    // filters. RLS would otherwise drop joined-but-not-owned workspaces (there is
    // no membership-based SELECT policy on workspaces).
    const admin = supabaseServiceRole()

    // Fetch owned workspaces
    const { data: owned, error: ownedErr } = await admin
      .from('workspaces')
      .select('*')
      .eq('owner_id', userId)

    if (ownedErr) {
      console.error('Error fetching owned workspaces:', ownedErr)
      return NextResponse.json({ error: 'Failed to fetch owned workspaces' }, { status: 500 })
    }

    // Fetch workspace memberships
    const { data: memberRows, error: memErr } = await admin
      .from('workspace_members')
      .select('workspace_id')
      .eq('user_id', userId)

    if (memErr) {
      console.error('Error fetching workspace members:', memErr)
      return NextResponse.json({ error: 'Failed to fetch workspace members' }, { status: 500 })
    }

    // Fetch workspaces where user is a member
    const memberIds = memberRows?.map((r) => r.workspace_id) ?? []
    let memberWorkspaces: Record<string, unknown>[] = []

    if (memberIds.length > 0) {
      const { data, error: memberWsErr } = await admin
        .from('workspaces')
        .select('*')
        .in('id', memberIds)

      if (memberWsErr) {
        console.error('Error fetching member workspaces:', memberWsErr)
        return NextResponse.json({ error: 'Failed to fetch member workspaces' }, { status: 500 })
      }

      memberWorkspaces = data ?? []
    }

    // Dedupe by id: every owned workspace is also a member workspace (POST
    // creates both rows), so the two sets always overlap. Without this the
    // dashboard renders each owned workspace twice.
    const allWorkspaces = Array.from(
      new Map(
        [...(owned ?? []), ...memberWorkspaces].map((w) => [w.id, w])
      ).values()
    )

    // Fetch board counts for all workspaces in one query
    const wsIds = allWorkspaces.map((w) => w.id)
    const boardCountMap: Record<string, number> = {}
    if (wsIds.length > 0) {
      const { data: boardRows } = await admin
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
    return NextResponse.json({ workspaces: result })
  } catch (error) {
    console.error('Unexpected error in GET /api/workspaces:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

// POST: create a workspace owned by the current user
export async function POST(req: Request) {
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

    const body = await req.json().catch(() => null)
    const nameResult = validateName(body?.name, { maxLength: 100, fieldLabel: 'Workspace name' })
    if (!nameResult.ok) {
      return NextResponse.json({ error: nameResult.error }, { status: 400 })
    }
    const name = nameResult.value
    const description = body?.description?.trim() ?? null
    const type = body?.type || 'class' // 'class' or 'personal'
    const institutionIdFromBody = body?.institution_id ?? null
    const institutionSlugFromBody = body?.institution_slug?.trim() ?? null

    // Validate the workspace type before the instructor gate so an unknown
    // value can't slip past it.
    if (type !== 'class' && type !== 'shared' && type !== 'personal') {
      return NextResponse.json({ error: 'Invalid workspace type' }, { status: 400 })
    }

    // Security gate: only instructors may create org-facing classes. Shared
    // rooms (peer-to-peer collab) and personal rooms (the creator's own space)
    // stay open to every account — neither reaches the org network. This is the
    // real server-side boundary; the dashboard merely hides the buttons.
    if (type === 'class' && !(await isInstructorAccount(userId))) {
      return NextResponse.json(
        { error: 'Only instructors can create classes. Ask an admin to grant you instructor access.' },
        { status: 403 }
      )
    }

    // Resolve institution_id: from body or default to Wentworth (slug "wit")
    const supabaseAdmin = supabaseServiceRole()
    let institutionId: string | null = null
    if (institutionIdFromBody) {
      const { data: inst } = await supabaseAdmin
        .from('organizations')
        .select('id')
        .eq('id', institutionIdFromBody)
        .single()
      if (inst?.id) institutionId = inst.id
    }
    if (!institutionId && institutionSlugFromBody) {
      const { data: inst } = await supabaseAdmin
        .from('organizations')
        .select('id')
        .eq('slug', institutionSlugFromBody)
        .single()
      if (inst?.id) institutionId = inst.id
    }
    if (!institutionId) {
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('user_id', userId)
        .maybeSingle()
      if (profile?.organization_id) institutionId = profile.organization_id
    }

    const ownerName =
      user.user_metadata?.full_name ||
      user.email?.split('@')[0] ||
      'Owner'

    // Shared with the admin provisioning path. `db` stays the RLS-bound client
    // here, so the owner_id = auth.uid() INSERT policy still applies and this
    // route cannot create a workspace owned by anyone but the caller.
    const result = await createWorkspace({
      db: supabase,
      name,
      description,
      type,
      ownerId: userId,
      ownerName,
      organizationId: institutionId,
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }

    return NextResponse.json({ workspace: result.workspace }, { status: 201 })
  } catch (error) {
    console.error('Unexpected error in POST /api/workspaces:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
