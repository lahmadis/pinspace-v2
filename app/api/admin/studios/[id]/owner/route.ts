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
 * workspaces.instructor — the free-text explore-network label — is updated ONLY
 * when it still matches the outgoing owner's name. That label is curated: the
 * owner can set it to anything from the publish modal, and in practice usually
 * does. Of the 14 class studios at the time of writing, 7 have no label at all,
 * 5 name a professor who is NOT the owner (the co-teacher case), and only 2
 * echo their owner's name. Overwriting unconditionally would destroy those 5;
 * never touching it leaves the 2 showing the wrong professor in /explore.
 *
 * The comparison is trimmed and case-insensitive against the previous owner's
 * name resolved by the SAME precedence that wrote it (profile -> user_metadata
 * -> email prefix). One failure mode, and it is the safe direction: if the
 * previous owner renamed their profile after the label was written, the match
 * misses and the label stays stale. It can never clobber a curated value.
 * A NULL label is left alone — absent is not stale.
 */

type AdminClient = ReturnType<typeof supabaseServiceRole>

/** Auth-record shape we read; narrower than the SDK's User so the helper is testable. */
interface AuthUserLike {
  email?: string | null
  user_metadata?: { full_name?: string | null } | null
}

/** Used where a name is REQUIRED and none could be resolved. Never compared. */
const UNKNOWN_NAME = 'Instructor'

/**
 * The display name for an account, by the SAME precedence that wrote every
 * existing workspaces.instructor and workspace_members.name value: profile
 * full_name, then the signup metadata name, then the email prefix.
 *
 * Run through safeName because user_metadata.full_name is user-controlled at
 * signup and this lands in rendered labels.
 *
 * Returns NULL when nothing resolves, rather than a placeholder. That
 * distinction is load-bearing for the label logic below: if a placeholder
 * doubled as a real name, a studio whose curated label happens to read
 * "Instructor" would match an unresolvable previous owner and be overwritten,
 * and a transfer to an account with no resolvable name would downgrade a
 * perfectly good label to the placeholder. Callers that genuinely need a
 * string — workspace_members.name is NOT NULL-ish in practice — apply
 * UNKNOWN_NAME themselves.
 */
function resolveDisplayName(
  profileFullName: string | null | undefined,
  authUser: AuthUserLike | null | undefined
): string | null {
  const raw =
    profileFullName?.trim() ||
    authUser?.user_metadata?.full_name ||
    authUser?.email?.split('@')[0] ||
    null
  if (!raw) return null
  const check = validateName(raw, { maxLength: 80, fieldLabel: 'Owner name' })
  return check.ok ? check.value : null
}

/** Trimmed, case-insensitive equality — the label was typed by a human. */
function namesMatch(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/**
 * Resolve the outgoing owner's display name, or null if it cannot be
 * determined. Null means "do not touch the label": we cannot prove the label
 * refers to them, and leaving a stale label beats destroying a curated one.
 */
async function resolvePreviousOwnerName(
  admin: AdminClient,
  previousOwnerId: string | null
): Promise<string | null> {
  // workspaces.owner_id is TEXT and user_profiles.user_id is UUID, so a
  // non-UUID owner_id would 22P02 the profile read rather than miss.
  if (!previousOwnerId || !isUuid(previousOwnerId)) return null

  const { data: prevAuth, error: prevAuthErr } = await admin.auth.admin.getUserById(previousOwnerId)
  if (prevAuthErr) {
    // Not fatal to the transfer — we just decline to touch the label.
    console.error('Error resolving previous owner for label check:', previousOwnerId, prevAuthErr)
  }

  const { data: prevProfile, error: prevProfileErr } = await admin
    .from('user_profiles')
    .select('full_name')
    .eq('user_id', previousOwnerId)
    .maybeSingle()
  if (prevProfileErr) {
    console.error('Error loading previous owner profile for label check:', prevProfileErr)
  }

  // Nothing resolved at all — a deleted account with no profile. Decline.
  if (!prevAuth?.user && !prevProfile) return null

  return resolveDisplayName(
    prevProfile?.full_name as string | null | undefined,
    prevAuth?.user ?? null
  )
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAdmin()
    if (!auth.ok) return auth.response

    // workspaces.id is UUID (migrations/014_add_rooms_table.sql:39 references
    // it from a UUID column), so a malformed path segment does NOT come back as
    // zero rows — it raises 22P02 and fails the statement, turning a plain
    // "no such studio" into a 500. Reject it here so the 404 below is reachable.
    const workspaceId = (await params).id
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
      .select('id, name, owner_id, instructor')
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
    const resolvedOwnerName = resolveDisplayName(
      targetProfile?.full_name as string | null | undefined,
      targetAuth.user
    )
    const ownerName = resolvedOwnerName ?? UNKNOWN_NAME

    // Decide the explore-network label. Only worth resolving the outgoing
    // owner's name at all when there IS a label to compare against — 7 of 14
    // class studios have none, and this saves two lookups on each of those.
    //
    // Requires a REAL name on both sides. An unresolvable previous owner cannot
    // be matched against (we can't prove the label refers to them), and an
    // unresolvable new owner has no name worth writing — replacing a real label
    // with a placeholder would be a downgrade, not a fix.
    const currentLabel = (workspace.instructor as string | null) ?? null
    let instructorLabelUpdated = false
    if (currentLabel && currentLabel.trim().length > 0 && resolvedOwnerName) {
      const previousOwnerName = await resolvePreviousOwnerName(admin, previousOwnerId)
      if (previousOwnerName && namesMatch(currentLabel, previousOwnerName)) {
        instructorLabelUpdated = true
      }
    }

    // Ownership first. If this fails nothing else should run — the membership
    // work below only makes sense once the transfer is real. The label rides
    // along in the same UPDATE so it cannot land without the transfer.
    const workspaceUpdates: Record<string, unknown> = { owner_id: newOwnerId }
    // resolvedOwnerName is non-null whenever instructorLabelUpdated is true —
    // the guard above requires it — so the label never receives a placeholder.
    if (instructorLabelUpdated) workspaceUpdates.instructor = resolvedOwnerName

    const { data: updatedWorkspace, error: transferError } = await admin
      .from('workspaces')
      .update(workspaceUpdates)
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
      instructorLabelUpdated,
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
