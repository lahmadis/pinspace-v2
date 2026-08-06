import { NextResponse } from 'next/server'
import { getVerifiedUser } from '@/lib/auth/requireAdmin'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/me – returns whether the current user is an admin (email in
 * PINSPACE_ADMIN_EMAILS).
 *
 * This decides only whether the admin SHELL renders; it is not the security
 * boundary, because every admin data route re-checks with requireAdmin. It
 * still resolves identity through getVerifiedUser (getUser, not getSession) so
 * the whole admin surface answers "who is this" the same way — a UI trusting an
 * unverified cookie claim while the routes behind it did not would be a
 * confusing thing to debug.
 */
export async function GET() {
  try {
    const caller = await getVerifiedUser()
    return NextResponse.json({ isAdmin: caller?.isPlatformAdmin === true })
  } catch {
    return NextResponse.json({ isAdmin: false })
  }
}
