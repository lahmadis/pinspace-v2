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

function SignUpInner() {
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
  const [needsPassword, setNeedsPassword] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [settingPassword, setSettingPassword] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const hasRedirected = useRef(false)
  const pendingSetPasswordRef = useRef(false)

  const institutionSlug = searchParams?.get('institution') ?? null
  const redirectTo = searchParams?.get('redirect') ?? undefined

  useEffect(() => {
    setMounted(true)
    // Pre-fill email if passed from the sign-in no-match flow
    const emailParam = searchParams?.get('email')
    if (emailParam) setEmail(emailParam)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!mounted) return
    if (institutionSlug) sessionStorage.setItem('pinspace_institution', institutionSlug)
    fetch('/api/institutions', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: { institutions: Institution[] }) => {
        const list = data?.institutions || []
        setInstitutions(list)
        const inst = list.find((i) => i.slug === (institutionSlug || ''))
        setInstitution(inst || null)
        if (inst) sessionStorage.setItem('pinspace_institution_id', inst.id)
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
      // After verifyOtp we show set-password step; don't redirect until they've set a password
      if (pendingSetPasswordRef.current) return
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

    // Auto-detect institution from email domain when no slug-matched institution is set
    if (!institution && institutions.length > 0) {
      const emailDomain = trimmedEmail.split('@')[1]?.trim().toLowerCase()
      if (emailDomain) {
        const matchingInst = institutions.find((i) => {
          const domains = getAllowedDomains(i.allowed_email_domains)
          return domains.includes(emailDomain)
        })
        if (matchingInst) {
          sessionStorage.setItem('pinspace_institution_id', matchingInst.id)
          sessionStorage.setItem('pinspace_institution', matchingInst.slug)
        }
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
        const msg = authError.message || 'Failed to send code'
        if (msg.toLowerCase().includes('rate limit') || msg.toLowerCase().includes('rate_limit')) {
          setError('Too many attempts. Please wait about an hour, or check your inbox (and spam) for a sign-in link we already sent.')
        } else {
          setError(msg)
        }
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
    pendingSetPasswordRef.current = true
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
        setVerifying(false)
        setNeedsPassword(true)
        setError('')
        return
      }
      if (authError) {
        pendingSetPasswordRef.current = false
        setError(authError.message || 'Invalid or expired code. Try requesting a new one.')
      }
    } catch (err) {
      pendingSetPasswordRef.current = false
      setVerifying(false)
      setError((err as Error).message || 'Something went wrong')
    } finally {
      setVerifying(false)
    }
  }

  const handleBackToEmail = () => {
    setCodeSent(false)
    setCode('')
    setError('')
  }

  const redirectToOnboarding = () => {
    hasRedirected.current = true
    const base = redirectTo ? `/onboarding?redirect=${encodeURIComponent(redirectTo)}` : '/onboarding'
    const sep = base.includes('?') ? '&' : '?'
    router.replace(institutionSlug ? `${base}${sep}institution=${encodeURIComponent(institutionSlug)}` : base)
  }

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setPasswordError('')
    const pwd = password.trim()
    const confirm = confirmPassword.trim()
    if (pwd.length < 8) {
      setPasswordError('Password must be at least 8 characters')
      return
    }
    if (pwd !== confirm) {
      setPasswordError('Passwords do not match')
      return
    }
    setSettingPassword(true)
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: pwd })
      setSettingPassword(false)
      if (updateError) {
        setPasswordError(updateError.message || 'Failed to set password')
        return
      }
      redirectToOnboarding()
    } catch (err) {
      setSettingPassword(false)
      setPasswordError((err as Error).message || 'Something went wrong')
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

  const signInUrl = institutionSlug ? `/sign-in?institution=${institutionSlug}${redirectTo ? `&redirect=${encodeURIComponent(redirectTo)}` : ''}` : '/sign-in'

  if (needsPassword) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl border border-gray-200">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Create your password</h1>
          <p className="text-sm text-gray-500 mb-6">
            Choose a password so you can sign in with your email next time. Must be at least 8 characters.
          </p>
          <form onSubmit={handleSetPassword} className="space-y-4">
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                autoComplete="new-password"
                minLength={8}
              />
            </div>
            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-1">Confirm password</label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                autoComplete="new-password"
                minLength={8}
              />
            </div>
            {passwordError && <p className="text-sm text-red-600">{passwordError}</p>}
            <button
              type="submit"
              disabled={settingPassword || password.length < 8 || confirmPassword.length < 8}
              className="w-full py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium"
            >
              {settingPassword ? 'Setting password…' : 'Continue'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  if (codeSent) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl border border-gray-200">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Enter verification code</h1>
          <p className="text-sm text-gray-500 mb-6">
            We sent a verification code to <strong>{codeSentTo}</strong>. Enter it below to verify your email and continue.
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
              {verifying ? 'Verifying…' : 'Verify and continue'}
            </button>
          </form>
          <p className="mt-4 text-sm text-gray-500 text-center">
            Didn&apos;t receive the code? Check your spam folder or{' '}
            <button type="button" onClick={handleBackToEmail} className="text-indigo-600 hover:underline">
              use a different email
            </button>
          </p>
          <div className="mt-6 pt-4 border-t border-gray-200">
            <Link href={signInUrl} className="block text-center text-sm text-indigo-600 hover:underline">
              Already have an account? Sign in
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl border border-gray-200">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Create account</h1>
        {institution && (
          <p className="text-sm text-gray-500 mb-6">Use your {institution.name} email. We&apos;ll send a verification code to confirm it&apos;s real.</p>
        )}
        {!institution && (
          <p className="text-sm text-gray-500 mb-6">Enter your email and we&apos;ll send a verification code to confirm it&apos;s real.</p>
        )}
        <form onSubmit={handleSendCode} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
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
          <Link href={signInUrl} className="text-indigo-600 hover:underline">
            Already have an account? Sign in
          </Link>
          <Link href="/" className="text-gray-500 hover:underline">← Back</Link>
        </div>
      </div>
    </div>
  )
}

export default function SignUpPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-600/20 border-t-indigo-600" />
      </div>
    }>
      <SignUpInner />
    </Suspense>
  )
}