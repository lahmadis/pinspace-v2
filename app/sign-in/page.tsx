'use client'

import { Suspense, useEffect, useState, useRef } from 'react'
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
  const [sendingCode, setSendingCode] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState('')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [codeSentTo, setCodeSentTo] = useState('')
  const hasRedirected = useRef(false)

  const institutionSlug = searchParams?.get('institution') ?? (typeof window !== 'undefined' ? sessionStorage.getItem('pinspace_institution') : null)
  const redirectTo = searchParams?.get('redirect') ?? undefined

  useEffect(() => {
    setMounted(true)
  }, [])

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
      if (event === 'SIGNED_IN' && session?.user && !hasRedirected.current) {
        hasRedirected.current = true
        const base = redirectTo ? `/onboarding?redirect=${encodeURIComponent(redirectTo)}` : '/onboarding'
        const sep = base.includes('?') ? '&' : '?'
        router.replace(institutionSlug ? `${base}${sep}institution=${encodeURIComponent(institutionSlug)}` : base)
      }
    })
    return () => subscription.unsubscribe()
  }, [mounted, router, redirectTo, institutionSlug])

  const handleSendCode = async (e: React.FormEvent) => {
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

    if (institution?.allowed_email_domains) {
      const allowed = getAllowedDomains(institution.allowed_email_domains)
      if (allowed.length > 0 && !emailDomainAllowed(trimmedEmail, allowed)) {
        const domainList = allowed.map((d) => `@${d}`).join(' or ')
        setError(`Please use a ${institution.name} email (${domainList})`)
        return
      }
    }

    setSendingCode(true)
    try {
      const { error: authError } = await supabase.auth.signInWithOtp({
        email: trimmedEmail,
        options: { shouldCreateUser: true },
      })
      setSendingCode(false)
      if (authError) {
        setError(authError.message || 'Failed to send code')
        return
      }
      setCodeSent(true)
      setCodeSentTo(trimmedEmail)
      setCode('')
      setError('')
    } catch (err) {
      setSendingCode(false)
      setError((err as Error).message || 'Something went wrong')
    }
  }

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const trimmedCode = code.trim().replace(/\s/g, '')
    if (!trimmedCode || trimmedCode.length < 6) {
      setError('Please enter the verification code from your email')
      return
    }

    setVerifying(true)
    try {
      const { data, error: authError } = await supabase.auth.verifyOtp({
        email: codeSentTo,
        token: trimmedCode,
        type: 'email',
      })
      setVerifying(false)
      // If we have a session (from response or client state), redirect immediately
      const session = data?.session ?? (await supabase.auth.getSession()).data.session
      if (session) {
        hasRedirected.current = true
        const base = redirectTo ? `/onboarding?redirect=${encodeURIComponent(redirectTo)}` : '/onboarding'
        const sep = base.includes('?') ? '&' : '?'
        router.replace(institutionSlug ? `${base}${sep}institution=${encodeURIComponent(institutionSlug)}` : base)
        return
      }
      if (authError) {
        setError(authError.message || 'Invalid or expired code. Try requesting a new one.')
      }
    } catch (err) {
      setVerifying(false)
      setError((err as Error).message || 'Something went wrong')
    }
  }

  const handleBackToEmail = () => {
    setCodeSent(false)
    setCode('')
    setError('')
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

  if (codeSent) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl border border-gray-200">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Enter verification code</h1>
          <p className="text-sm text-gray-500 mb-6">
            We sent a verification code to <strong>{codeSentTo}</strong>. Enter it below to sign in.
          </p>
          <form onSubmit={handleVerifyCode} className="space-y-4">
            <div>
              <label htmlFor="code" className="block text-sm font-medium text-gray-700 mb-1">Verification code</label>
              <input
                id="code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={8}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="00000000"
                className="w-full px-4 py-3 text-center text-xl tracking-[0.5em] font-mono border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                autoComplete="one-time-code"
                autoFocus
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={verifying || code.length < 6}
              className="w-full py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium"
            >
              {verifying ? 'Verifying…' : 'Verify and sign in'}
            </button>
          </form>
          <p className="mt-4 text-sm text-gray-500 text-center">
            Didn&apos;t receive the code? Check your spam folder or{' '}
            <button type="button" onClick={handleBackToEmail} className="text-indigo-600 hover:underline">
              use a different email
            </button>
          </p>
          <div className="mt-6 pt-4 border-t border-gray-200">
            <Link href={signUpUrl} className="block text-center text-sm text-indigo-600 hover:underline">
              Don&apos;t have an account? Sign up
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl border border-gray-200">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Sign in</h1>
        {institution && (
          <p className="text-sm text-gray-500 mb-6">Use your {institution.name} email. We&apos;ll send a verification code.</p>
        )}
        {!institution && (
          <p className="text-sm text-gray-500 mb-6">Enter your email and we&apos;ll send a verification code to sign in.</p>
        )}
        <form onSubmit={handleSendCode} className="space-y-4">
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
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={sendingCode}
            className="w-full py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium"
          >
            {sendingCode ? 'Sending code…' : 'Send verification code'}
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
