'use client'

import { Suspense, useEffect, useState, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase/client'
import PasswordInput from '@/components/ui/PasswordInput'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import type { Institution } from '@/types'

function SignUpInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [mounted, setMounted] = useState(false)
  const [institution, setInstitution] = useState<Institution | null>(null)
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
  // Owned here, not in PasswordInput, so one toggle drives both fields — they
  // hold the same secret, so revealing only one of the pair makes a mismatch
  // harder to spot, not easier.
  const [showPassword, setShowPassword] = useState(false)
  const [agreedToTerms, setAgreedToTerms] = useState(false)
  const hasRedirected = useRef(false)
  const pendingSetPasswordRef = useRef(false)

  const institutionSlug = searchParams?.get('institution') ?? null
  const redirectTo = searchParams?.get('redirect') ?? undefined

  useEffect(() => {
    setMounted(true)
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
        const inst = list.find((i) => i.slug === (institutionSlug || ''))
        setInstitution(inst || null)
        if (inst) sessionStorage.setItem('pinspace_institution_id', inst.id)
      })
      .catch(() => {})
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
    if (!agreedToTerms) {
      setError('Please agree to the Terms of Service and Privacy Policy to continue')
      return
    }

    setSendingCode(true)
    let matchedOrg: { id: string; slug: string } | null = null
    try {
      const lookupRes = await fetch('/api/auth/lookup-domain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmedEmail }),
      })
      const lookupData = await lookupRes.json().catch(() => null)
      if (!lookupRes.ok) {
        setSendingCode(false)
        setError(lookupData?.error || 'Could not verify your email domain')
        return
      }
      const orgs: Array<{ id: string; slug: string }> = Array.isArray(lookupData?.orgs) ? lookupData.orgs : []
      matchedOrg = orgs[0] ?? null
    } catch {
      setSendingCode(false)
      setError('Could not verify your email domain. Please try again.')
      return
    }

    // Persist the resolved org so onboarding picks it up.
    if (matchedOrg) {
      sessionStorage.setItem('pinspace_institution_id', matchedOrg.id)
      sessionStorage.setItem('pinspace_institution', matchedOrg.slug)
    }

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

  if (!mounted || loading) {
    return <Spinner />
  }

  const signInUrl = institutionSlug ? `/sign-in?institution=${institutionSlug}${redirectTo ? `&redirect=${encodeURIComponent(redirectTo)}` : ''}` : '/sign-in'

  if (needsPassword) {
    return (
      <Shell>
        <h1 className="text-[28px] font-extrabold text-[#16181D] mb-1 tracking-[-0.02em]">Create your password</h1>
        <p className="text-sm text-[#5A5E6B] mb-6">
          Choose a password so you can sign in with your email next time. Must be at least 8 characters.
        </p>
        <form onSubmit={handleSetPassword} className="space-y-4">
          <div>
            <label htmlFor="password" className="block text-[11px] font-bold tracking-[0.06em] uppercase text-[#8A8FA0] mb-1.5">Password</label>
            <PasswordInput
              id="password"
              value={password}
              onChange={setPassword}
              placeholder="••••••••"
              autoComplete="new-password"
              minLength={8}
              shown={showPassword}
              onShownChange={setShowPassword}
            />
          </div>
          <div>
            <label htmlFor="confirmPassword" className="block text-[11px] font-bold tracking-[0.06em] uppercase text-[#8A8FA0] mb-1.5">Confirm password</label>
            <PasswordInput
              id="confirmPassword"
              value={confirmPassword}
              onChange={setConfirmPassword}
              placeholder="••••••••"
              autoComplete="new-password"
              minLength={8}
              shown={showPassword}
              onShownChange={setShowPassword}
            />
          </div>
          {passwordError && <p className="text-sm text-[#C2452D]">{passwordError}</p>}
          <button
            type="submit"
            disabled={settingPassword || password.length < 8 || confirmPassword.length < 8}
            className="w-full py-3.5 bg-[#3B6EF6] text-white rounded-full hover:bg-[#16181D] disabled:opacity-50 font-bold transition-colors shadow-[0_10px_26px_rgba(59,110,246,0.3)]"
          >
            {settingPassword ? 'Setting password…' : 'Continue'}
          </button>
        </form>
      </Shell>
    )
  }

  if (codeSent) {
    return (
      <Shell>
        <h1 className="text-[28px] font-extrabold text-[#16181D] mb-1 tracking-[-0.02em]">Enter verification code</h1>
        <p className="text-sm text-[#5A5E6B] mb-6">
          We sent a verification code to <strong className="text-[#16181D]">{codeSentTo}</strong>. Enter it below to verify your email and continue.
        </p>
        <form onSubmit={handleVerifyCode} className="space-y-4">
          <div>
            <label htmlFor="code" className="block text-[11px] font-bold tracking-[0.06em] uppercase text-[#8A8FA0] mb-1.5">Verification code</label>
            <input
              id="code"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={8}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="00000000"
              className="w-full px-4 py-3 text-center text-xl tracking-[0.5em] font-mono border border-[#16181D]/12 rounded-xl bg-white focus:ring-2 focus:ring-[#3B6EF6] focus:border-transparent"
              autoComplete="one-time-code"
              autoFocus
            />
          </div>
          <div className="flex items-start gap-2.5 rounded-xl border border-[#3B6EF6]/20 bg-[#3B6EF6]/5 px-3.5 py-3 text-sm text-[#16181D]">
            <span aria-hidden="true" className="text-base leading-none">📬</span>
            <p>
              <span className="font-semibold">Don&apos;t see the code?</span> It may be in your spam or junk folder — please check there.
            </p>
          </div>
          {error && <p className="text-sm text-[#C2452D]">{error}</p>}
          <button
            type="submit"
            disabled={verifying || code.length < 6}
            className="w-full py-3.5 bg-[#3B6EF6] text-white rounded-full hover:bg-[#16181D] disabled:opacity-50 font-bold transition-colors shadow-[0_10px_26px_rgba(59,110,246,0.3)]"
          >
            {verifying ? 'Verifying…' : 'Verify and continue'}
          </button>
        </form>
        <p className="mt-4 text-sm text-[#5A5E6B] text-center">
          Still nothing?{' '}
          <button type="button" onClick={handleBackToEmail} className="text-[#3B6EF6] hover:underline">
            Use a different email
          </button>
        </p>
        <div className="mt-6 pt-4 border-t border-[#16181D]/10">
          <Link href={signInUrl} className="block text-center text-sm text-[#3B6EF6] hover:underline">
            Already have an account? Sign in
          </Link>
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <h1 className="text-[28px] font-extrabold text-[#16181D] mb-1 tracking-[-0.02em]">Create account</h1>
      {institution && (
        <p className="text-sm text-[#5A5E6B] mb-6">Use your {institution.name} email. We&apos;ll send a verification code to confirm it&apos;s real.</p>
      )}
      {!institution && (
        <p className="text-sm text-[#5A5E6B] mb-6">Enter your email and we&apos;ll send a verification code to confirm it&apos;s real.</p>
      )}
      <form onSubmit={handleSendCode} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-[11px] font-bold tracking-[0.06em] uppercase text-[#8A8FA0] mb-1.5">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full px-4 py-3 border border-[#16181D]/12 rounded-xl bg-white focus:ring-2 focus:ring-[#3B6EF6] focus:border-transparent"
            autoComplete="email"
          />
        </div>
        <label className="flex items-start gap-2 text-sm text-[#5A5E6B] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={agreedToTerms}
            onChange={(e) => setAgreedToTerms(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-[#16181D]/20 text-[#3B6EF6] focus:ring-[#3B6EF6]"
          />
          <span>
            I agree to the{' '}
            <Link href="/terms" target="_blank" rel="noopener noreferrer" className="text-[#3B6EF6] hover:underline">
              Terms of Service
            </Link>{' '}
            and{' '}
            <Link href="/privacy" target="_blank" rel="noopener noreferrer" className="text-[#3B6EF6] hover:underline">
              Privacy Policy
            </Link>
            .
          </span>
        </label>
        {error && <p className="text-sm text-[#C2452D]">{error}</p>}
        <button
          type="submit"
          disabled={sendingCode || !agreedToTerms}
          className="w-full py-3.5 bg-[#3B6EF6] text-white rounded-full hover:bg-[#16181D] disabled:opacity-50 disabled:cursor-not-allowed font-bold transition-colors shadow-[0_10px_26px_rgba(59,110,246,0.3)]"
        >
          {sendingCode ? 'Sending code…' : 'Send verification code'}
        </button>
      </form>
      <div className="mt-6 pt-4 border-t border-[#16181D]/10 flex justify-between text-sm">
        <Link href={signInUrl} className="text-[#3B6EF6] hover:underline">
          Already have an account? Sign in
        </Link>
        <Link href="/" className="text-[#8A8FA0] hover:underline">← Back</Link>
      </div>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="relative flex min-h-screen items-center justify-center p-6 overflow-hidden"
      style={{ background: 'linear-gradient(160deg, #F2F5FB 0%, #EDF1F9 55%, #F6F3EC 100%)' }}
    >
      <div className="absolute -left-44 -top-52 w-[700px] h-[700px] rounded-full pointer-events-none" style={{ background: 'radial-gradient(closest-side, rgba(59,110,246,0.14), rgba(59,110,246,0))' }} />
      <div className="absolute -right-36 -bottom-64 w-[800px] h-[800px] rounded-full pointer-events-none" style={{ background: 'radial-gradient(closest-side, rgba(160,190,255,0.25), rgba(160,190,255,0))' }} />
      <Link href="/" className="absolute left-6 top-6 sm:left-10 sm:top-8 flex items-center gap-2 text-[#16181D] font-extrabold text-xl tracking-tight">
        <span className="w-[26px] h-[26px] rounded-lg bg-[#3B6EF6] text-white flex items-center justify-center text-xs">◉</span>
        pinspace
      </Link>
      <div
        className="relative w-full max-w-md rounded-3xl p-8 sm:p-10"
        style={{ background: 'rgba(255,255,255,0.8)', border: '1px solid rgba(255,255,255,0.95)', backdropFilter: 'blur(14px)', boxShadow: '0 24px 70px rgba(22,24,29,0.12)' }}
      >
        {children}
      </div>
    </div>
  )
}

function Spinner() {
  return (
    <div
      className="flex min-h-screen items-center justify-center"
      style={{ background: 'linear-gradient(160deg, #F2F5FB 0%, #EDF1F9 55%, #F6F3EC 100%)' }}
    >
      <div className="animate-spin rounded-full h-12 w-12 border-4 border-[#3B6EF6]/20 border-t-[#3B6EF6]" />
    </div>
  )
}

export default function SignUpPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <SignUpInner />
    </Suspense>
  )
}
