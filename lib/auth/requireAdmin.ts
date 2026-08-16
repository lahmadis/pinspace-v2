import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/auth/isAdmin'

/**
 * Resolve the caller's identity against GoTrue, and say whether they are a
 * platform admin.
 *
 * getUser(), NOT getSession(). getSession() decodes the auth cookie without
 * re-verifying the JWT against GoTrue, so authority would key off an unverified
 * claim. The rest of the codebase uses getSession() for ordinary reads, but
 * this function sits in front of service-role writes that reassign ownership
 * from one user to another, which is not a claim worth taking on trust. The
 * extra round trip is per privileged request only.
 *
 * Split out of requireAdmin so routes whose gate is an OR — "workspace owner
 * OR platform admin" — can share one identity path instead of hand-rolling a
 * second getUser() call and a second isAdmin() lookup. requireAdmin is the
 * admin-ONLY gate built on top of it; prefer that when admin is the whole rule.
 */
export async function getVerifiedUser(): Promise<
  { userId: string; email: string; isPlatformAdmin: boolean } | null
> {
  const supabase = await supabaseServer()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user?.id) {
    // "No session" is the ordinary logged-out case and would drown the logs, so
    // it is not an error worth printing. Anything else — a GoTrue outage, a
    // network fault — is, and must not be swallowed: it presents to the caller
    // as a plain 401, which otherwise looks identical to "you're signed out".
    if (error && error.name !== 'AuthSessionMissingError') {
      console.error('getVerifiedUser: auth check failed:', error)
    }
    return null
  }
  const email = user.email ?? ''
  return { userId: user.id, email, isPlatformAdmin: isAdmin(email) }
}

/**
 * Re-verify the caller is an admin, and hand back their user id.
 *
 * Defense in depth — admin pages are already gated client-side, but every
 * admin endpoint must re-check rather than trust that. Uses the existing
 * PINSPACE_ADMIN_EMAILS check; no new auth mechanism.
 */
export async function requireAdmin(): Promise<
  | { ok: true; userId: string; email: string }
  | { ok: false; response: NextResponse }
> {
  const caller = await getVerifiedUser()
  if (!caller) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  if (!caller.isPlatformAdmin) {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { ok: true, userId: caller.userId, email: caller.email }
}
