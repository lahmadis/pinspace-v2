import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseServiceRole } from '@/lib/supabase/server'
import { generateInviteCode } from '@/lib/workspaceUtils'
import { currentAcademicYear } from '@/lib/academicYear'

/**
 * Shared workspace creation.
 *
 * Lifted verbatim out of POST /api/workspaces so the admin provisioning path
 * can create a studio owned by SOMEONE ELSE without forking this logic. The
 * only new capability is that the owner is an explicit argument rather than
 * always the session user.
 *
 * Callers remain responsible for authorization — this function performs none.
 * The public route keeps its instructor gate; the admin route substitutes its
 * own isAdmin check.
 */

export type WorkspaceType = 'class' | 'shared' | 'personal'

export interface CreateWorkspaceInput {
  /**
   * The client used for the workspace INSERT.
   *
   * This is a parameter, not a fixed choice, because the two callers need
   * different trust levels. The public route passes its RLS-bound
   * `supabaseServer()` client, so the `owner_id = auth.uid()` INSERT policy
   * still applies and a user cannot create a workspace owned by anyone else.
   * The admin route passes `supabaseServiceRole()`, because assigning a
   * professor as owner is exactly what that policy forbids — the check moves
   * to isAdmin in app code, matching the project's service-role pattern.
   *
   * Membership is always written with the service role regardless (see below).
   */
  db: SupabaseClient
  name: string
  description?: string | null
  type: WorkspaceType
  /** Auth user id (text) that becomes workspaces.owner_id. */
  ownerId: string
  /** Display name recorded on the owner's workspace_members row. */
  ownerName: string
  organizationId?: string | null
  /**
   * Admin user id when this studio was provisioned on someone's behalf, so
   * pilot studios stay distinguishable from organic ones.
   *
   * REQUIRES migration 033. Leave undefined/null on any path that runs before
   * that migration is applied — the column is only written when set.
   */
  createdByAdmin?: string | null
}

export type CreateWorkspaceResult =
  | { ok: true; workspace: Record<string, unknown> }
  | { ok: false; error: string }

/**
 * Ensure the owner has a workspace_members row.
 *
 * Always service-role: the workspace_members INSERT policy only admits the
 * workspace owner, and on the admin path the caller is not the owner. It was
 * already service-role before this refactor, for the same reason.
 *
 * A membership failure is logged but does not fail the creation — the
 * workspace row already exists at this point, and reporting failure would
 * suggest nothing was created.
 */
async function ensureOwnerMembership(workspaceId: string, ownerId: string, ownerName: string) {
  const admin = supabaseServiceRole()
  const { data: existingMembership } = await admin
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', ownerId)
    .maybeSingle()
  if (!existingMembership) {
    const { error: membershipError } = await admin
      .from('workspace_members')
      .insert({
        workspace_id: workspaceId,
        user_id: ownerId,
        role: 'instructor',
        name: ownerName,
      })
    if (membershipError) {
      console.error('Error ensuring owner membership:', membershipError)
    }
  }
}

export async function createWorkspace(input: CreateWorkspaceInput): Promise<CreateWorkspaceResult> {
  const { db, name, type, ownerId, ownerName } = input
  const description = input.description ?? null
  const organizationId = input.organizationId ?? null
  const createdByAdmin = input.createdByAdmin ?? null

  // Stamp the academic year at creation. It was never set here, so it stayed
  // NULL until (and unless) someone opened the publish modal — which left 31
  // of 45 workspaces with no year and made the explore year filter drop them
  // silently. Derived server-side from server time so the stored value cannot
  // be shaped by the client's clock or timezone; the migration-032 backfill
  // reads created_at in UTC for the same reason, so both agree.
  // An instructor can still override it later via network-metadata.
  const insertData: Record<string, unknown> = {
    name,
    description,
    owner_id: ownerId,
    academic_year: currentAcademicYear(),
  }
  if (organizationId) insertData.organization_id = organizationId
  if (type !== 'personal') insertData.invite_code = generateInviteCode()
  if (createdByAdmin) insertData.created_by_admin = createdByAdmin

  // Try with type first, if it fails (column doesn't exist), try without type
  const { data, error } = await db
    .from('workspaces')
    .insert({ ...insertData, type })
    .select()
    .single()

  if (error) {
    console.error('Error creating workspace (with type):', error)

    // If error is about column not existing, try without type
    if (error.message?.includes('column') && error.message?.includes('type')) {
      const { data: dataWithoutType, error: errorWithoutType } = await db
        .from('workspaces')
        .insert(insertData)
        .select()
        .single()

      if (errorWithoutType) {
        console.error('Error creating workspace (without type):', errorWithoutType)
        return { ok: false, error: 'Failed to create workspace' }
      }

      await ensureOwnerMembership(dataWithoutType.id, ownerId, ownerName)
      return { ok: true, workspace: dataWithoutType }
    }

    return { ok: false, error: 'Failed to create workspace' }
  }

  await ensureOwnerMembership(data.id, ownerId, ownerName)
  return { ok: true, workspace: data }
}
