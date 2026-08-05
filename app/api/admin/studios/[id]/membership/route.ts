import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/requireAdmin'

export const dynamic = 'force-dynamic'

/**
 * Admin self-membership on any studio.
 *
 * This is how an admin gets upload access to a pilot studio, INSTEAD of
 * impersonation. The admin joins as themselves, under their own account, and
 * appears in the member list like anyone else — nothing here creates, borrows
 * or swaps a session, and nothing renders another user's view.
 *
 * Self-only by construction: neither handler accepts a user id, so this cannot
 * become a general "add anyone to anything" tool. Adding other people stays
 * with the studio owner, through the existing enrol route.
 *
 * Service role is required because the workspace_members INSERT policy only
 * admits the workspace owner, and the admin is not the owner. isAdmin is the
 * replacement boundary.
 */

async function loadWorkspace(id: string) {
  const admin = supabaseServiceRole()
  const { data, error } = await admin
    .from('workspaces')
    .select('id, owner_id, name')
    .eq('id', id)
    .maybeSingle()
  return { admin, workspace: error ? null : data }
}

/** POST — add the calling admin to this studio as an instructor. */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAdmin()
    if (!auth.ok) return auth.response

    const { admin, workspace } = await loadWorkspace(params.id)
    if (!workspace) {
      return NextResponse.json({ error: 'Studio not found' }, { status: 404 })
    }

    const { data: existing } = await admin
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', params.id)
      .eq('user_id', auth.userId)
      .maybeSingle()

    if (existing) {
      return NextResponse.json({ joined: true, alreadyMember: true })
    }

    const { data: profile } = await admin
      .from('user_profiles')
      .select('full_name')
      .eq('user_id', auth.userId)
      .maybeSingle()

    const { error: insertError } = await admin
      .from('workspace_members')
      .insert({
        workspace_id: params.id,
        user_id: auth.userId,
        role: 'instructor',
        name: (profile?.full_name as string | null) || auth.email.split('@')[0] || 'Admin',
      })

    if (insertError) {
      console.error('Error joining studio as admin:', insertError)
      return NextResponse.json({ error: 'Failed to join studio' }, { status: 500 })
    }

    return NextResponse.json({ joined: true, alreadyMember: false })
  } catch (error) {
    console.error('Error in POST /api/admin/studios/[id]/membership:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

/** DELETE — remove the calling admin's own membership. */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAdmin()
    if (!auth.ok) return auth.response

    const { admin, workspace } = await loadWorkspace(params.id)
    if (!workspace) {
      return NextResponse.json({ error: 'Studio not found' }, { status: 404 })
    }

    // Refuse if the admin IS the owner. Owners cannot leave their own workspace
    // (the existing leave route says the same), and removing the owner's
    // membership row would strip access without transferring anything.
    if (workspace.owner_id === auth.userId) {
      return NextResponse.json(
        { error: "You own this studio — transfer ownership instead of leaving." },
        { status: 400 }
      )
    }

    const { error: deleteError } = await admin
      .from('workspace_members')
      .delete()
      .eq('workspace_id', params.id)
      .eq('user_id', auth.userId)

    if (deleteError) {
      console.error('Error leaving studio as admin:', deleteError)
      return NextResponse.json({ error: 'Failed to leave studio' }, { status: 500 })
    }

    return NextResponse.json({ joined: false })
  } catch (error) {
    console.error('Error in DELETE /api/admin/studios/[id]/membership:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
