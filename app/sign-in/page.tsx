'use client'

import { Suspense, useEffect, useState, useRef, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase/client'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import type { Institution } from '@/types'

function getAllowedDomains(domainsStr: string | null | undefined): string[] {
  if (!domainsStr || !domainsStr.trim()) return []
  return domainsStr.split(',').map((d) => d.trim().toLowerCase()).filter(Boolean)
}

function emailDomainAllowed(email: string, allowedDomains: string[]): boolean {
  if (allowedDomains.length === 0) return true
  if (!email.includes('@')) return false
  const domain = email.split('@')[1]?.trim().toLowerCase()
  return domain ? allowedDomains.includes(domain) : false
}

function SignInInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [mounted, setMounted] = useState(false)
  const [institution, setInstitution] = useState<Institution | null>(null)
  const [institutions, setInstitutions] = useState<Institution[]>([])
  const [loading, setLoading] = useState(true)
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const hasRedirected = useRef(false)

  const institutionSlug = searchParams?.get('institution') ?? (typeof window !== 'undefined' ? sessionStorage.getItem('pinspace_institution') : null)
  const redirectTo = searchParams?.get('redirect') ?? undefined

  useEffect(() => {
    setMounted(true)
  }, [])

  const redirectAfterSignIn = useCallback(async () => {
    if (hasRedirected.current) return
    hasRedirected.current = true

    const defaultTarget = redirectTo || '/dashboard'
    const withInstitution = (base: string) => {
      if (!institutionSlug) return base
      const sep = base.includes('?') ? '&' : '?'
      return `${base}${sep}institution=${encodeURIComponent(institutionSlug)}`
    }

    try {
      const res = await fetch('/api/user-profile', { cache: 'no-store' })
      let hasProfile = false
      if (res.ok) {
        const data = await res.json().catch(() => null)
        hasProfile = !!(data && data.user_id)
      }

      if (hasProfile) {
        // Existing user with profile → go directly to target (usually dashboard)
        router.replace(withInstitution(defaultTarget))
      } else {
        // No profile yet → go through onboarding once
        const base = `/onboarding?redirect=${encodeURIComponent(defaultTarget)}`
        router.replace(withInstitution(base))
      }
    } catch {
      // Fallback: preserve previous behavior (always send to onboarding)
      const base = `/onboarding?redirect=${encodeURIComponent(defaultTarget)}`
      router.replace(withInstitution(base))
    }
  }, [redirectTo, institutionSlug, router])

  useEffect(() => {
    if (!mounted) return
    if (institutionSlug) sessionStorage.setItem('pinspace_institution', institutionSlug)
    fetch('/api/institutions', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: Institution[]) => {
        setInstitutions(Array.isArray(data) ? data : [])
        const inst = (Array.isArray(data) ? data : []).find((i) => i.slug === (institutionSlug || ''))
        setInstitution(inst || null)
      })
      .catch(() => setInstitutions([]))
      .finally(() => setLoading(false))
  }, [mounted, institutionSlug])

  useEffect(() => {
    if (!mounted) return
    let isInitial = true
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
      if (isInitial) {
        isInitial = false
        return
      }
      if (event === 'SIGNED_IN' && session?.user) {
        redirectAfterSignIn()
      }
    })
    return () => subscription.unsubscribe()
  }, [mounted, redirectAfterSignIn])

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const trimmedEmail = email.trim()
    if (!trimmedEmail) {
      setError('Please enter your email')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError('Please enter a valid email address')
      return
    }
    if (!password) {
      setError('Please enter your password')
      return
    }

    if (institution?.allowed_email_domains) {
      const allowed = getAllowedDomains(institution.allowed_email_domains)
      if (allowed.length > 0 && !emailDomainAllowed(trimmedEmail, allowed)) {
        const domainList = allowed.map((d) => `@${d}`).join(' or ')
        setError(`Please use a ${institution.name} email (${domainList})`)
        return
      }
    }

    setSigningIn(true)
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      })
      setSigningIn(false)
      if (authError) {
        setError(authError.message || 'Invalid email or password')
        return
      }
      // onAuthStateChange will call redirectAfterSignIn
    } catch (err) {
      setSigningIn(false)
      setError((err as Error).message || 'Something went wrong')
    }
  }

  if (!mounted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-600/20 border-t-indigo-600" />
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-600/20 border-t-indigo-600" />
      </div>
    )
  }

  const hasAnyDomainRestriction = institutions.some((i) => i.allowed_email_domains)
  if (hasAnyDomainRestriction && !institutionSlug) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl border border-gray-200 text-center">
          <h1 className="text-xl font-bold text-gray-900 mb-2">Use your school&apos;s link</h1>
          <p className="text-gray-600 mb-6">
            To sign in, please use your institution&apos;s PinSpace link (e.g. yourapp.com/i/wit). Contact your school for the correct link.
          </p>
          <Link href="/" className="text-indigo-600 hover:underline">← Back to home</Link>
        </div>
      </div>
    )
  }

  const signUpUrl = institutionSlug ? `/sign-up?institution=${institutionSlug}${redirectTo ? `&redirect=${encodeURIComponent(redirectTo)}` : ''}` : '/sign-up'
  const forgotPasswordUrl = institutionSlug ? `/forgot-password?institution=${institutionSlug}` : '/forgot-password'

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl border border-gray-200">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Sign in</h1>
        {institution && (
          <p className="text-sm text-gray-500 mb-6">Use your {institution.name} email and password.</p>
        )}
        {!institution && (
          <p className="text-sm text-gray-500 mb-6">Enter your email and password to sign in.</p>
        )}
        <form onSubmit={handleSignIn} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@school.edu"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              autoComplete="email"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              autoComplete="current-password"
            />
          </div>
          <div className="flex justify-end">
            <Link href={forgotPasswordUrl} className="text-sm text-indigo-600 hover:underline">
              Forgot password?
            </Link>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={signingIn}
            className="w-full py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium"
          >
            {signingIn ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <div className="mt-6 pt-4 border-t border-gray-200 flex justify-between text-sm">
          <Link href={signUpUrl} className="text-indigo-600 hover:underline">
            Don&apos;t have an account? Sign up
          </Link>
          <Link href="/" className="text-gray-500 hover:underline">← Back</Link>
        </div>
      </div>
    </div>
  )
}

export default function SignInPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-600/20 border-t-indigo-600" />
      </div>
    }>
      <SignInInner />
    </Suspense>
  )
}
