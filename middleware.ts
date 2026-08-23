import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Routes that require authentication
const PROTECTED_PREFIXES = [
  '/dashboard',
  '/studio',
  '/workspace',
  '/upload',
  '/board',
  '/my-boards',
  // Desk crits are personal to one user — no members, no org, no guest
  // tokens. The API routes enforce that with getVerifiedUser(), so a
  // signed-out visitor was never shown anyone's data; they just got the empty
  // page shell and a column of failed requests instead of being sent to sign
  // in.
  //
  // NOTE: unlike the four below, `app/desk-crits/page.tsx` has NO client-side
  // auth guard of its own, so THIS ENTRY IS THAT PAGE'S ONLY REDIRECT. Removing
  // it does not fall back to anything. (`/desk-crits/[id]` does guard itself.)
  '/desk-crits',
  // These four each self-redirect on `authStatus === 'unauthenticated'` too;
  // middleware just gets them there without rendering a dead shell first.
  // /network/shared is "shared WITH you" — signed-in only, not a public share
  // flow. The real public flows (/share, /crit, /join, /f, /i, /u, /explore,
  // /gallery) are separate top-level prefixes and stay open.
  '/archive',
  '/settings',
  '/network',
  '/onboarding',
  '/admin',
  '/debug',
]

// Routes under /studio that are public (view mode)
const PUBLIC_STUDIO_PATTERN = /^\/studio\/[^/]+\/view(\/|$)/

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Allow public studio view routes through without auth
  if (PUBLIC_STUDIO_PATTERN.test(pathname)) {
    return NextResponse.next()
  }

  const isProtected = PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  if (isProtected) {
    // Supabase stores the session in a cookie named sb-<ref>-auth-token
    // Checking cookie presence is sufficient for UX-level routing;
    // full JWT validation still happens in every API route and server component.
    const hasAuthCookie = req.cookies.getAll().some(
      (cookie) => cookie.name.startsWith('sb-') && cookie.name.endsWith('-auth-token') && cookie.value
    )
    if (!hasAuthCookie) {
      const signIn = req.nextUrl.clone()
      signIn.pathname = '/sign-in'
      signIn.searchParams.set('redirect', pathname)
      return NextResponse.redirect(signIn)
    }
  }

  return NextResponse.next()
}

export const config = {
  // `monitoring` is excluded so Sentry's tunnelRoute (next.config.js) can
  // pass events through to ingest.*.sentry.io without this auth-cookie
  // middleware swallowing them. Sentry's docs require the tunnelRoute not
  // match any middleware matcher.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/|monitoring).*)'],
}
