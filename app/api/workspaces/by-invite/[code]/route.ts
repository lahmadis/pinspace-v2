import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/server'
import { normalizeInviteCode } from '@/lib/workspaces/inviteCodes'

// GET workspace by invite code (public endpoint for join page)
// Uses service role to bypass RLS since this is a public lookup
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const supabase = supabaseServiceRole()
    const inviteCode = normalizeInviteCode((await params).code)
    if (!inviteCode) {
      return NextResponse.json({ error: 'Invalid invite code' }, { status: 404 })
    }

    // Fetch workspace by invite code (include institution for sign-in context)
    const { data: workspace, error } = await supabase
      .from('workspaces')
      .select('id, name, invite_code, organization_id, type')
      .eq('invite_code', inviteCode)
      .maybeSingle()

    if (error || !workspace || workspace.type === 'personal') {
      console.error('Error finding workspace by invite code:', error)
      return NextResponse.json({ error: 'Invalid invite code' }, { status: 404 })
    }

    // Get institution slug if workspace has institution
    let institutionSlug: string | null = null
    if (workspace.organization_id) {
      const { data: inst } = await supabase
        .from('organizations')
        .select('slug')
        .eq('id', workspace.organization_id)
        .single()
      if (inst?.slug) institutionSlug = inst.slug
    }

    // Get member count
    const { count: memberCount } = await supabase
      .from('workspace_members')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspace.id)

    // Return only public info (don't expose all members)
    return NextResponse.json({ 
      workspace: {
        id: workspace.id,
        name: workspace.name,
        inviteCode: workspace.invite_code,
        memberCount: memberCount || 0,
        institutionSlug: institutionSlug || undefined
      }
    })
  } catch (error) {
    console.error('Error finding workspace by invite:', error)
    return NextResponse.json({ error: 'Failed to find workspace' }, { status: 500 })
  }
}
