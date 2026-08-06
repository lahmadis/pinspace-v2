import { NextRequest, NextResponse } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { validateName } from '@/lib/validation/safeName'
import { isUuid } from '@/lib/validation/uuid'

export const dynamic = 'force-dynamic'

/**
 * PATCH /api/admin/studios/[id]/owner — transfer a studio to another account.
 *
 * The correction path for provisioning: a studio created for the wrong
 * instructor, or a course handed to a co-teacher mid-term. Everything that
 * runs a class — publish, archive, delete, network metadata, bulk enrol — is
 * gated on workspaces.owner_id, so without this an admin's only remedy is to
 * delete the studio and rebuild it, losing every board in it.
 *
 * This is NOT impersonation. No session is created, borrowed or swapped, and
 * nothing renders another user's view: the admin writes a row naming someone
 * else as owner, using the service role, with authorization enforced in app
 * code by requireAdmin. Same model as POST /api/admin/studios.
 *
 * THE PREVIOUS OWNER KEEPS THEIR MEMBERSHIP, unchanged.
 *   - boards.owner_id does NOT move with workspace ownership, so their boards,
 *     comments and traces stay in this studio. Stripping the membership would
 *     hide the studio from their dashboard while their work is still on its
 *     walls — and app/api/boards/route.ts:548 would still admit them via the
 *     owner_id branch anyway, so removal buys no clean cut, only incoherence.
 *   - It is the reversible direction. The moment this lands they are no longer
 *     the owner, so the owner-block in /api/workspaces/[id]/leave no longer
 *     catches them and they can leave on their own. There is no
 *     remove-another-member endpoint, so a removal here would NOT be undoable
 *     by the admin.
 * They lose every owner-gated action immediately, which is the point. They
 * keep instructor-level rights, including wall delete. previousOwnerId is
 * returned so a follow-up removal is one call if that is ever wanted.
 *
 * NOT touched: workspaces.instructor, the free-text explore-network label. It
 * goes stale after a transfer, but the owner curates it from the publish modal
 * and may have set it to a co-teacher or the course itself — clobbering a
 * curated value is worse than a stale one its owner can fix.
 */

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireAdmin()
    if (!auth.ok) return auth.response

    // workspaces.id is UUID (migrations/014_add_rooms_table.sql:39 references
    // it from a UUID column), so a malformed path segment does NOT come back as
    // zero rows — it raises 22P02 and fails the statement, turning a plain
    // "no such studio" into a 500. Reject it here so the 404 below is reachable.
    const workspaceId = params.id
    if (!isUuid(workspaceId)) {
      return NextResponse.json({ error: 'Studio not found' }, { status: 404 })
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    // Same guard for the target id, for a different column: user_profiles
    // .user_id is UUID, and auth.admin.getUserById expects one too.
    // workspace_members.user_id is TEXT (it is compared against auth.uid()::text
    // throughout the RLS policies) so that lookup would merely miss — but the
    // profile read would 22P02, and a request that cannot name a real account
    // has no business reaching either.
    const newOwnerId = typeof body.ownerId === 'string' ? body.ownerId.trim() : ''
    if (!isUuid(newOwnerId)) {
      return NextResponse.json({ error: 'A valid ownerId is required' }, { status: 400 })
    }

    const admin = supabaseServiceRole()

    const { data: workspace, error: wsErr } = await admin
      .from('workspaces')
      .select('id, name, owner_id')
      .eq('id', workspaceId)
      .maybeSingle()

    if (wsErr) {
      console.error('Error loading studio for transfer:', workspaceId, wsErr)
      return NextResponse.json({ error: 'Failed to load studio' }, { status: 500 })
    }
    if (!workspace) {
      return NextResponse.json({ error: 'Studio not found' }, { status: 404 })
    }

    const previousOwnerId = (workspace.owner_id as string | null) ?? null

    if (previousOwnerId === newOwnerId) {
      return NextResponse.json({ error: 'They already own this studio.' }, { status: 400 })
    }

    // The target must be a real account. Resolved through the auth admin API
    // rather than trusting the id from the client, so a hand-crafted request
    // cannot point owner_id at a nonexistent user and leave every owner-gated
    // action on this studio permanently dead.
    const { data: targetAuth, error: targetErr } = await admin.auth.admin.getUserById(newOwnerId)
    if (targetErr || !targetAuth?.user) {
      if (targetErr) console.error('Error resolving transfer target:', newOwnerId, targetErr)
      return NextResponse.json({ error: 'That account was not found' }, { status: 404 })
    }

    const { data: targetProfile, error: profileErr } = await admin
      .from('user_profiles')
      .select('full_name')
      .eq('user_id', newOwnerId)
      .maybeSingle()
    if (profileErr) {
      // Non-fatal — the auth record covers it below — but a swallowed failure
      // here silently writes an email prefix as the new owner's member name.
      console.error('Error loading transfer target profile (falling back to auth record):', profileErr)
    }

    // user_metadata.full_name is user-controlled at signup and this lands in
    // workspace_members.name, a rendered value — exactly what safeName is for.
    // Fall back rather than reject: a bad display name must not block a
    // transfer that fixes who controls a class.
    const rawName =
      (targetProfile?.full_name as string | null)?.trim() ||
      targetAuth.user.user_metadata?.full_name ||
      targetAuth.user.email?.split('@')[0] ||
      'Instructor'
    const nameCheck = validateName(rawName, { maxLength: 80, fieldLabel: 'Owner name' })
    const ownerName = nameCheck.ok ? nameCheck.value : 'Instructor'

    // Ownership first. If this fails nothing else should run — the membership
    // work below only makes sense once the transfer is real.
    const { data: updatedWorkspace, error: transferError } = await admin
      .from('workspaces')
      .update({ owner_id: newOwnerId })
      .eq('id', workspaceId)
      .select('id, owner_id')
      .maybeSingle()

    if (transferError || !updatedWorkspace) {
      console.error('Error transferring studio ownership:', workspaceId, transferError)
      return NextResponse.json({ error: 'Failed to transfer this studio' }, { status: 500 })
    }

    // Ensure the new owner has an instructor membership row. /api/workspaces
    // forces the owner to READ BACK as instructor in the members list, but only
    // in the response — it does not mutate the row. Without a real row the new
    // owner is missing from workspace_members entirely, which is what every
    // member-gated query actually checks.
    let membershipEnsured = true

    const { data: existing, error: existingErr } = await admin
      .from('workspace_members')
      .select('user_id, role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', newOwnerId)
      .maybeSingle()

    if (existingErr) {
      console.error('Error checking new owner membership after transfer:', workspaceId, existingErr)
      membershipEnsured = false
    } else if (!existing) {
      const { error: insertError } = await admin
        .from('workspace_members')
        .insert({
          workspace_id: workspaceId,
          user_id: newOwnerId,
          role: 'instructor',
          name: ownerName,
        })
      if (insertError) {
        console.error('Error adding new owner as instructor after transfer:', workspaceId, insertError)
        membershipEnsured = false
      }
    } else if (existing.role !== 'instructor') {
      // They were already in the studio as a student. Promote the role, but
      // leave `name` alone — it may have been curated at enrolment, and the
      // transfer is not a reason to overwrite it.
      const { error: roleError } = await admin
        .from('workspace_members')
        .update({ role: 'instructor' })
        .eq('workspace_id', workspaceId)
        .eq('user_id', newOwnerId)
      if (roleError) {
        console.error('Error promoting new owner to instructor after transfer:', workspaceId, roleError)
        membershipEnsured = false
      }
    }

    // The transfer itself SUCCEEDED even when the membership step did not, so
    // this is a 200 — reporting 500 would imply nothing happened and invite a
    // retry that then 400s on "they already own this studio". But it must not
    // report as a clean success either: the caller surfaces the difference.
    // Same shape as metadataApplied on POST /api/admin/studios.
    return NextResponse.json({
      transferred: true,
      membershipEnsured,
      previousOwnerId,
      owner: {
        userId: newOwnerId,
        name: ownerName,
        email: targetAuth.user.email ?? null,
      },
    })
  } catch (error) {
    console.error('Error in PATCH /api/admin/studios/[id]/owner:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
