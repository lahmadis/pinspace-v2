import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/auth/isAdmin'

/**
 * Re-verify the caller is an admin, and hand back their user id.
 *
 * Defense in depth — admin pages are already gated client-side, but every
 * admin endpoint must re-check rather than trust that. Uses the existing
 * PINSPACE_ADMIN_EMAILS check; no new auth mechanism.
 *
 * getUser(), NOT getSession(). getSession() decodes the auth cookie without
 * re-verifying the JWT against GoTrue, so admin authority would key off an
 * unverified claim. The rest of the codebase uses getSession() for ordinary
 * reads, but this function is the single gate in front of service-role writes
 * that assign workspace ownership to another user, which is not a claim worth
 * taking on trust. The extra round trip is per admin request only.
 */
export async function requireAdmin(): Promise<
  | { ok: true; userId: string; email: string }
  | { ok: false; response: NextResponse }
> {
  const supabase = supabaseServer()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user?.id) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  if (!isAdmin(user.email)) {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { ok: true, userId: user.id, email: user.email ?? '' }
}
