import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * POST /api/workspaces/[id]/leave — remove the CURRENT user's own membership.
 *
 * Members (non-owners) only. The owner can't leave — that would orphan the
 * project — and must delete it instead. We delete ONLY the caller's own
 * workspace_members row (scoped to workspace_id + user_id), so no one else's
 * membership is touched and the workspace, its rooms, and boards (including any
 * the leaving user created) stay intact for the owner and remaining members.
 *
 * Service role + app-level check (established pattern); no new RLS policies.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  void request
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

    const workspaceId = params.id
    const admin = supabaseServiceRole()

    // Owners can't leave their own project — block before touching membership.
    const { data: workspace, error: workspaceError } = await admin
      .from('workspaces')
      .select('owner_id')
      .eq('id', workspaceId)
      .maybeSingle()
    if (workspaceError || !workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }
    if (workspace.owner_id === userId) {
      return NextResponse.json(
        { error: "Owners can't leave their own project; delete it instead." },
        { status: 403 }
      )
    }

    // Must actually be a member to leave.
    const { data: membership, error: membershipError } = await admin
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle()
    if (membershipError) {
      console.error('Error checking membership:', membershipError)
      return NextResponse.json({ error: 'Failed to verify membership' }, { status: 500 })
    }
    if (!membership) {
      return NextResponse.json({ error: 'You are not a member of this project' }, { status: 404 })
    }

    // Remove ONLY the caller's own membership row.
    const { error: deleteError } = await admin
      .from('workspace_members')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
    if (deleteError) {
      console.error('Error leaving workspace:', deleteError)
      return NextResponse.json({ error: 'Failed to leave project' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Unexpected error in POST /api/workspaces/[id]/leave:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
