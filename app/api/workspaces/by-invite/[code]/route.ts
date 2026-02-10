import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/server'

// GET workspace by invite code (public endpoint for join page)
// Uses service role to bypass RLS since this is a public lookup
export async function GET(
  request: NextRequest,
  { params }: { params: { code: string } }
) {
  try {
    const supabase = supabaseServiceRole()
    const inviteCode = params.code.toUpperCase().trim()

    // Fetch workspace by invite code (include institution for sign-in context)
    const { data: workspace, error } = await supabase
      .from('workspaces')
      .select('id, name, invite_code, institution_id')
      .eq('invite_code', inviteCode)
      .single()

    if (error || !workspace) {
      console.error('Error finding workspace by invite code:', error)
      return NextResponse.json({ error: 'Invalid invite code' }, { status: 404 })
    }

    // Get institution slug if workspace has institution
    let institutionSlug: string | null = null
    if (workspace.institution_id) {
      const { data: inst } = await supabase
        .from('institutions')
        .select('slug')
        .eq('id', workspace.institution_id)
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
    return NextResponse.json({ error: 'Failed to find workspace', details: (error as Error).message }, { status: 500 })
  }
}

