import { NextRequest } from 'next/server'
import { supabaseServiceRole } from '@/lib/supabase/server'

export interface GuestContext {
  tokenId: string
  roomId: string
  label: string
  canComment: boolean
  canTrace: boolean
}

/**
 * Resolve a guest critic token (migration 028 guest_tokens) to its room +
 * capabilities, or null when the token is missing, unknown, revoked, or
 * expired. Service-role read — the single gate every guest route shares.
 */
export async function resolveGuestToken(
  token: string | null | undefined
): Promise<GuestContext | null> {
  if (!token || typeof token !== 'string') return null
  const admin = supabaseServiceRole()
  const { data, error } = await admin
    .from('guest_tokens')
    .select('id, room_id, label, can_comment, can_trace, expires_at, revoked')
    .eq('token', token)
    .maybeSingle()
  if (error || !data) return null
  if (data.revoked === true) return null
  if (data.expires_at != null && new Date(data.expires_at as string).getTime() <= Date.now()) {
    return null
  }
  return {
    tokenId: data.id as string,
    roomId: data.room_id as string,
    label: (data.label as string) ?? '',
    canComment: data.can_comment !== false,
    canTrace: data.can_trace !== false,
  }
}

/**
 * Read a guest token from a request: the X-Guest-Token header (preferred) or a
 * `guestToken` query param. Returns null when neither is present.
 */
export function getGuestTokenFromRequest(request: NextRequest): string | null {
  const header = request.headers.get('x-guest-token')
  if (header && header.trim()) return header.trim()
  const query = request.nextUrl.searchParams.get('guestToken')
  if (query && query.trim()) return query.trim()
  return null
}
