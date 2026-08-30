import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The workspace type that hosts desk-crit sheets.
 *
 * A desk crit has no room and no space, but boards.workspace_id is NOT NULL, so
 * its sheets need a workspace to hang on. This is that workspace: one per
 * person, created on their first upload into a crit, and never shown as a
 * space anywhere.
 *
 * It is a distinct TYPE rather than a flagged personal workspace because the
 * type is what every list query already filters on. One value to exclude, in
 * one place per surface, and a crit sheet cannot turn up in the dashboard, the
 * personal network, /my-boards, the 2D archive or the explore graph. A boolean
 * column would have needed each of those to learn a new field, and the ones
 * that forgot would leak.
 */
export const DESK_CRIT_WORKSPACE_TYPE = 'deskcrit'

/** Name on the row. Never rendered — the type keeps it out of every list. */
const DESK_CRIT_WORKSPACE_NAME = 'Desk crits'

/**
 * The caller's desk-crit workspace id, creating it if this is their first.
 *
 * Lazy rather than provisioned at sign-up: most people never open a desk crit,
 * and a row per account for a feature they have not used is a row that has to
 * be excluded from every query forever regardless.
 *
 * `admin` must be a service-role client — this writes a workspace the user is
 * never shown and so cannot be covered by an owner-visible RLS policy.
 */
export async function resolveDeskCritWorkspaceId(
  admin: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data: existing } = await admin
    .from('workspaces')
    .select('id')
    .eq('owner_id', userId)
    .eq('type', DESK_CRIT_WORKSPACE_TYPE)
    .maybeSingle()

  if (existing?.id) return existing.id as string

  const { data: created, error } = await admin
    .from('workspaces')
    .insert({
      name: DESK_CRIT_WORKSPACE_NAME,
      type: DESK_CRIT_WORKSPACE_TYPE,
      owner_id: userId,
    })
    .select('id')
    .single()

  if (error) {
    // A concurrent first upload may have won the race. Re-read before failing:
    // two sheets dropped at once must not leave one of them homeless.
    const { data: retry } = await admin
      .from('workspaces')
      .select('id')
      .eq('owner_id', userId)
      .eq('type', DESK_CRIT_WORKSPACE_TYPE)
      .maybeSingle()
    if (retry?.id) return retry.id as string
    console.error('Failed to resolve desk-crit workspace:', error)
    return null
  }

  return created?.id as string
}
