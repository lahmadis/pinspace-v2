import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'
import { validateName } from '@/lib/validation/safeName'


// JOIN workspace - Add user to workspace_members table. Enforces the institution
// email domain only for org workspaces (type 'class'); shared/personal workspaces
// accept any signed-in account.
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = supabaseServer()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = user.id
    const userEmail = user.email

    const body = await request.json()
    const nameResult = validateName(body?.userName, { maxLength: 80, fieldLabel: 'Display name' })
    if (!nameResult.ok) {
      return NextResponse.json({ error: nameResult.error }, { status: 400 })
    }
    const userName = nameResult.value
    const workspaceId = params.id

    // Fetch workspace and its institution (use service role so we can read institution for non-members)
    const admin = supabaseServiceRole()
    const { data: workspace, error: workspaceError } = await admin
      .from('workspaces')
      .select('id, name, organization_id, type')
      .eq('id', workspaceId)
      .single()

    if (workspaceError || !workspace) {
      console.error('Error fetching workspace:', workspaceError)
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    // Domain gate applies ONLY to org workspaces (type 'class'). Shared and
    // personal workspaces accept any signed-in account, even when an
    // organization_id was stamped on them at creation (the creator's org is
    // copied onto every type). We skip the gate for the two explicitly
    // peer/personal types and leave every other type — incl. legacy rows
    // where `type` predates the column and reads back null — gated exactly as
    // before, so org/class behavior is unchanged.
    const isOrgGated = workspace.type !== 'shared' && workspace.type !== 'personal'

    // For org workspaces with an institution, enforce domain restrictions from org_domains
    if (isOrgGated && workspace.organization_id) {
      const { data: institution, error: instError } = await admin
        .from('organizations')
        .select('id, name')
        .eq('id', workspace.organization_id)
        .single()
      if (!instError && institution) {
        const { data: orgDomainRows } = await admin
          .from('org_domains')
          .select('domain')
          .eq('org_id', institution.id)
        const configuredDomains = (orgDomainRows ?? []).map((r) => r.domain)
        if (configuredDomains.length > 0) {
          const userDomain = userEmail?.split('@')[1]?.trim().toLowerCase()
          if (!userDomain || !configuredDomains.includes(userDomain)) {
            const domainList = configuredDomains.map((d) => `@${d}`).join(' or ')
            return NextResponse.json(
              {
                error: 'Email domain not allowed',
                message: `You can only join this workspace with a ${institution.name} email (e.g. ${domainList}). Sign in with your school email and try again.`,
              },
              { status: 403 }
            )
          }
        }
      }
    }

    // Check if already a member (use admin so we can read before membership exists)
    const { data: existingMember, error: existingMemberError } = await admin
      .from('workspace_members')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle()

    if (existingMemberError) {
      console.error('Error checking existing membership:', existingMemberError)
      return NextResponse.json({ error: 'Failed to verify membership' }, { status: 500 })
    }

    if (existingMember) {
      return NextResponse.json({
        success: true,
        workspace: {
          id: workspace.id,
          name: workspace.name,
        },
        alreadyMember: true
      })
    }

    // Add user as student member (support schema variants with/without "name" column).
    const insertPayload: Record<string, unknown> = {
      workspace_id: workspaceId,
      user_id: userId,
      role: 'student',
    }
    if (userName) insertPayload.name = userName

    let { error: insertError } = await admin
      .from('workspace_members')
      .insert(insertPayload)
      .select()
      .single()

    if (insertError && String(insertError.message || '').includes("'name' column")) {
      const fallbackPayload = {
        workspace_id: workspaceId,
        user_id: userId,
        role: 'student',
      }
      const retry = await admin
        .from('workspace_members')
        .insert(fallbackPayload)
        .select()
        .single()
      insertError = retry.error
    }

    if (insertError) {
      console.error('Error adding member to workspace:', insertError)
      return NextResponse.json({ error: 'Failed to join workspace' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      workspace: {
        id: workspace.id,
        name: workspace.name,
      }
    })
  } catch (error) {
    console.error('Error joining workspace:', error)
    return NextResponse.json({ error: 'Failed to join workspace' }, { status: 500 })
  }
}
