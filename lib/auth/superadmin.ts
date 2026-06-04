import { supabaseServiceRole } from '@/lib/supabase/server'

type AdminClient = ReturnType<typeof supabaseServiceRole>

/**
 * Platform superadmin check. ALWAYS reads user_profiles.is_superadmin via the
 * service-role client, keyed by the authenticated user id resolved server-side
 * from the session. NEVER trust a client-supplied flag, header, query param, or
 * request body for this — pass only a server-derived `userId`.
 *
 * Pass an existing service-role client to avoid creating a second one; omit it
 * and the helper creates its own (still service-role).
 */
export async function isSuperadmin(
  userId: string | null | undefined,
  adminClient?: AdminClient
): Promise<boolean> {
  if (!userId) return false
  const admin = adminClient ?? supabaseServiceRole()
  const { data, error } = await admin
    .from('user_profiles')
    .select('is_superadmin')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) {
    console.error('isSuperadmin check failed:', error)
    return false
  }
  return data?.is_superadmin === true
}

/**
 * Is the given room/workspace published to the org network? Used to scope
 * superadmin READ access strictly to network-published content (never
 * unpublished org workspaces or personal/shared workspaces).
 *
 * Published-to-network is true when EITHER:
 *   - the specific room has rooms.is_published = true (the canonical signal
 *     /explore uses), OR
 *   - the workspace is is_public + published_at (legacy workspace-level
 *     publish), OR any room in the workspace is published.
 */
export async function isNetworkPublished(
  admin: AdminClient,
  opts: { roomId?: string | null; workspaceId?: string | null }
): Promise<boolean> {
  const { roomId, workspaceId } = opts
  if (roomId) {
    const { data: room } = await admin
      .from('rooms')
      .select('is_published')
      .eq('id', roomId)
      .maybeSingle()
    if (room?.is_published === true) return true
  }
  if (workspaceId) {
    const { data: ws } = await admin
      .from('workspaces')
      .select('is_public, published_at')
      .eq('id', workspaceId)
      .maybeSingle()
    if (ws?.is_public && ws?.published_at != null) return true
    const { count } = await admin
      .from('rooms')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('is_published', true)
    if ((count ?? 0) > 0) return true
  }
  return false
}
