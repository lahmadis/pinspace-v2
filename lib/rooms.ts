import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Resolve the default "Main Room" for a workspace. Returns the room id.
 *
 * Phase 6.0 backfilled exactly one Main Room (display_order=0) per workspace and
 * Phase 6.1's workspace POST creates one for every new workspace, so this should
 * always find a row in production. Returns null defensively for callers that
 * want to detect bad data instead of throwing.
 */
export async function resolveMainRoomId(
  client: SupabaseClient,
  workspaceId: string
): Promise<string | null> {
  const { data } = await client
    .from('rooms')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('name', 'Main Room')
    .order('display_order', { ascending: true })
    .limit(1)
    .maybeSingle()
  return (data?.id as string | undefined) ?? null
}
