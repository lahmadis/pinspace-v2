import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Routes that require authentication
const PROTECTED_PREFIXES = [
  '/dashboard',
  '/studio',
  '/workspace',
  '/upload',
  '/board',
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
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/).*)'],
}
