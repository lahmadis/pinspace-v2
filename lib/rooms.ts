import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Resolve the first room of a workspace by display_order. Returns the room id.
 *
 * Phase 6.0 backfilled exactly one room per workspace and Phase 6.1's workspace
 * POST creates one for every new workspace, so this should always find a row.
 *
 * Earlier versions of this helper filtered by `name = 'Main Room'`. That broke
 * silently when an instructor renamed it (which the Phase 6.2 spec explicitly
 * says is allowed). Now we order by display_order ASC, created_at ASC and pick
 * the first row — works regardless of rename.
 *
 * Returns null defensively for callers that want to detect bad data instead of
 * throwing.
 */
export async function resolveFirstRoomId(
  client: SupabaseClient,
  workspaceId: string
): Promise<string | null> {
  const { data } = await client
    .from('rooms')
    .select('id')
    .eq('workspace_id', workspaceId)
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return (data?.id as string | undefined) ?? null
}

/** @deprecated Use resolveFirstRoomId. Kept as an alias for backward source compatibility. */
export const resolveMainRoomId = resolveFirstRoomId
