'use client'

import { Suspense, useEffect, useState, useRef, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase/client'
import PasswordInput from '@/components/ui/PasswordInput'

interface OrgMatch {
  id: string
  name: string
  slug: string
  type: 'university' | 'firm'
  logo_url: string | null
  network_label: string | null
}

type Step =
  | 'password'        // default — email + password fields
  | 'otp-email'       // OTP entry — just email, sends a 6-digit code on submit
  | 'checking'        // spinner while lookup-domain runs + OTP sends
  | 'check-email'     // OTP sent, waiting for 6-digit code
  | 'verifying'       // spinner while verifyOtp runs
  | 'workspace-picker' // OTP verified, 2+ orgs — user picks one

function SignInInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [mounted, setMounted] = useState(false)
  const [step, setStep] = useState<Step>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [orgs, setOrgs] = useState<OrgMatch[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // Inline help links rendered next to the error message. `showResetHint` is
  // set when Supabase reports "Invalid login credentials" — likely the user
  // signed up via OTP and never set a password. `showSignUpHint` is set when
  // an OTP send fails because the email has no account (we now pass
  // shouldCreateUser: false so OTP can't silently create users).
  const [showResetHint, setShowResetHint] = useState(false)
  const [showSignUpHint, setShowSignUpHint] = useState(false)
  const hasRedirected = useRef(false)

  const institutionSlug = searchParams?.get('institution') ?? null
  const redirectTo = searchParams?.get('redirect') ?? undefined
  const [orgName, setOrgName] = useState<string | null>(null)
  const [orgFetchDone, setOrgFetchDone] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (!mounted || !institutionSlug) return
    supabase
      .from('organizations')
      .select('name')
      .eq('slug', institutionSlug)
      .maybeSingle()
      .then(({ data }: { data: { name: string } | null }) => {
        setOrgName(data?.name ?? null)
        setOrgFetchDone(true)
      })
      .catch(() => setOrgFetchDone(true))
  }, [mounted, institutionSlug])

  // After any successful sign-in: write org context, check profile, redirect
  const redirectAfterSignIn = useCallback(async (orgSlug?: string) => {
    if (hasRedirected.current) return
    hasRedirected.current = true

    if (orgSlug) {
      sessionStorage.setItem('pinspace_institution', orgSlug)
    }

    const target = redirectTo || '/dashboard'
    try {
      const res = await fetch('/api/user-profile', { cache: 'no-store' })
      const data = res.ok ? await res.json().catch(() => null) : null
      if (data?.user_id) {
        router.replace(target)
      } else {
        router.replace(`/onboarding?redirect=${encodeURIComponent(target)}`)
      }
    } catch {
      router.replace(`/onboarding?redirect=${encodeURIComponent(target)}`)
    }
  }, [redirectTo, router])

  // ── HANDLERS ─────────────────────────────────────────────────────────────

  // Step 1: look up domain, then send OTP if orgs found
  const handleEmailContinue = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setShowResetHint(false)
    setShowSignUpHint(false)
    const trimmed = email.trim().toLowerCase()
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError('Please enter a valid email address')
      return
    }
    setEmail(trimmed)
    setStep('checking')

    try {
      const res = await fetch('/api/auth/lookup-domain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Something went wrong')
        setStep('otp-email')
        return
      }

      const matched: OrgMatch[] = data.orgs ?? []

      setOrgs(matched)
      const { error: otpErr } = await supabase.auth.signInWithOtp({
        email: trimmed,
        options: { shouldCreateUser: false },
      })
      if (otpErr) {
        const msg = otpErr.message || ''
        const lower = msg.toLowerCase()
        // Supabase's exact error string varies across versions for this case
        // ("Signups not allowed for otp" is the common shape with
        // shouldCreateUser: false; some versions return "user not found" or
        // "Invalid login credentials"). Match defensively across known
        // patterns; fall through to the raw message for unknown errors.
        const userMissing =
          lower.includes('signups not allowed') ||
          lower.includes('user not found') ||
          lower.includes('does not exist') ||
          lower.includes('no user found') ||
          lower.includes('invalid login credentials')
        if (userMissing) {
          setShowSignUpHint(true)
          setError('No account found for this email.')
        } else {
          setError(msg || 'Failed to send verification code')
        }
        setStep('otp-email')
        return
      }
      setStep('check-email')
    } catch {
      setError('Something went wrong. Please try again.')
      setStep('otp-email')
    }
  }

  // Step 2: verify the OTP code
  const handleOtpVerify = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (otp.length !== 6) {
      setError('Please enter the 6-digit code from your email')
      return
    }
    setStep('verifying')
    // NOTE (Bug 3, resolved): Supabase OTP length was 8 during Phase 3 testing; changed to
    // 6 in Auth → Email → OTP expiry settings. If this breaks after a config sync, reset it.

    try {
      const { data, error: verifyErr } = await supabase.auth.verifyOtp({
        email,
        token: otp,
        type: 'email',
      })
      if (verifyErr || !data.session) {
        setError(verifyErr?.message || 'Invalid or expired code — try resending.')
        setStep('check-email')
        return
      }

      if (orgs.length === 1) {
        await redirectAfterSignIn(orgs[0].slug)
      } else if (orgs.length > 1) {
        setStep('workspace-picker')
      } else {
        // Edge case: orgs were empty (state lost) — redirect without org context
        await redirectAfterSignIn()
      }
    } catch {
      setError('Something went wrong. Please try again.')
      setStep('check-email')
    }
  }

  // Resend OTP from check-email step
  const handleResendOtp = async () => {
    setError('')
    setBusy(true)
    try {
      // Same as initial send — never silently create users from the
      // sign-in OTP path. /sign-up is the only entry point that provisions
      // new accounts.
      const { error: otpErr } = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false },
      })
      if (otpErr) setError(otpErr.message || 'Failed to resend code')
    } catch {
      setError('Failed to resend. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  // Workspace picker: user selects one org
  const handlePickOrg = async (org: OrgMatch) => {
    await redirectAfterSignIn(org.slug)
  }

  // Password sign-in (now the default landing path).
  const handlePasswordSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setShowResetHint(false)
    setShowSignUpHint(false)
    if (!email.trim()) {
      setError('Please enter your email')
      return
    }
    if (!password) {
      setError('Please enter your password')
      return
    }
    setBusy(true)
    try {
      const { error: authErr } = await supabase.auth.signInWithPassword({ email, password })
      if (authErr) {
        const msg = authErr.message || ''
        // Supabase returns "Invalid login credentials" for BOTH wrong
        // password AND nonexistent user. Treat both as "password didn't
        // work" and surface the reset path — covers OTP-only legacy users
        // who never set a password.
        if (msg.toLowerCase().includes('invalid login credentials')) {
          setError(
            "That password didn't work. If you signed up with an email code, you may not have set a password yet."
          )
          setShowResetHint(true)
        } else {
          setError(msg || 'Invalid email or password')
        }
        setBusy(false)
        return
      }
      // Resolve org context for sessionStorage after password sign-in
      let orgSlug: string | undefined
      try {
        const res = await fetch('/api/auth/lookup-domain', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        })
        const data = res.ok ? await res.json() : null
        orgSlug = (data?.orgs as OrgMatch[] | undefined)?.[0]?.slug
      } catch { /* non-fatal — user still signs in, just without org context */ }

      await redirectAfterSignIn(orgSlug)
    } catch {
      setError('Something went wrong. Please try again.')
      setBusy(false)
    }
  }

  // ── RENDER ────────────────────────────────────────────────────────────────

  if (!mounted || step === 'checking' || step === 'verifying') {
    return <Spinner />
  }

  if (step === 'password' || step === 'otp-email') {
    const isPassword = step === 'password'
    const signUpParams = new URLSearchParams()
    if (email) signUpParams.set('email', email)
    if (institutionSlug) signUpParams.set('institution', institutionSlug)
    const signUpHref = `/sign-up${signUpParams.size ? `?${signUpParams}` : ''}`
    const forgotPasswordHref = `/forgot-password${email ? `?email=${encodeURIComponent(email)}` : ''}`
    const genericSubtitle = isPassword
      ? 'Welcome back. Sign in to pinspace.'
      : "We'll send a 6-digit sign-in code to your email."
    const subtitle = !institutionSlug
      ? genericSubtitle
      : !orgFetchDone
      ? ' '
      : orgName
      ? (isPassword
          ? `Sign in to ${orgName}.`
          : `Sign in to ${orgName} with an email code.`)
      : genericSubtitle
    return (
      <Shell>
        <h1 className="text-[28px] font-extrabold text-[#16181D] mb-1 tracking-[-0.02em]">Sign in</h1>
        <p className="text-sm text-[#5A5E6B] mb-6">{subtitle}</p>

        <form onSubmit={isPassword ? handlePasswordSignIn : handleEmailContinue} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-[11px] font-bold tracking-[0.06em] uppercase text-[#8A8FA0] mb-1.5">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@school.edu"
              className="w-full px-4 py-3 border border-[#16181D]/12 rounded-xl bg-white focus:ring-2 focus:ring-[#3B6EF6] focus:border-transparent"
              autoComplete="email"
              autoFocus={!email}
            />
          </div>

          {isPassword && (
            <div>
              <label htmlFor="password" className="block text-[11px] font-bold tracking-[0.06em] uppercase text-[#8A8FA0] mb-1.5">Password</label>
              <PasswordInput
                id="password"
                value={password}
                onChange={setPassword}
                placeholder="••••••••"
                autoComplete="current-password"
                autoFocus={!!email}
              />
              <div className="flex justify-end mt-1">
                <Link href={forgotPasswordHref} className="text-sm text-[#3B6EF6] hover:underline">
                  Forgot password?
                </Link>
              </div>
            </div>
          )}

          {error && <p className="text-sm text-[#C2452D]">{error}</p>}

          {isPassword && showResetHint && (
            <Link
              href={forgotPasswordHref}
              className="inline-block text-sm font-semibold text-[#3B6EF6] hover:underline"
            >
              Reset password →
            </Link>
          )}

          {!isPassword && showSignUpHint && (
            <p className="text-sm text-gray-600">
              <Link
                href={signUpHref}
                className="font-semibold text-[#3B6EF6] hover:underline"
              >
                Sign up here
              </Link>
              {' '}to create an account.
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full py-3.5 bg-[#3B6EF6] text-white rounded-full hover:bg-[#16181D] disabled:opacity-50 font-bold transition-colors shadow-[0_10px_26px_rgba(59,110,246,0.3)]"
          >
            {busy ? (isPassword ? 'Signing in…' : 'Sending code…') : (isPassword ? 'Sign in' : 'Continue →')}
          </button>
        </form>

        {isPassword ? (
          <button
            type="button"
            onClick={() => {
              setError('')
              setShowResetHint(false)
              setShowSignUpHint(false)
              setStep('otp-email')
            }}
            className="mt-3 w-full text-center text-sm text-[#8A8FA0] hover:text-[#16181D] transition-colors"
          >
            Sign in with email code instead
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              setError('')
              setShowResetHint(false)
              setShowSignUpHint(false)
              setStep('password')
            }}
            className="mt-3 w-full text-center text-sm text-[#8A8FA0] hover:text-[#16181D] transition-colors"
          >
            ← Sign in with password instead
          </button>
        )}

        <div className="mt-6 pt-4 border-t border-[#16181D]/10 flex justify-between text-sm">
          <Link href={signUpHref} className="text-[#3B6EF6] hover:underline">
            Don&apos;t have an account? Sign up
          </Link>
          <Link href="/" className="text-[#8A8FA0] hover:underline">← Back</Link>
        </div>
      </Shell>
    )
  }

  if (step === 'check-email') {
    return (
      <Shell>
        <div className="text-center mb-6">
          <div className="w-12 h-12 bg-[#3B6EF6]/10 rounded-full flex items-center justify-center mx-auto mb-3">
            <MailIcon />
          </div>
          <h1 className="text-[28px] font-extrabold text-[#16181D] mb-1 tracking-[-0.02em]">Check your email</h1>
          <p className="text-sm text-gray-500">
            We sent a 6-digit code to{' '}
            <span className="font-semibold text-[#16181D]">{email}</span>
            {orgs.length === 1 && (
              <> for <span className="font-medium">{orgs[0].name}</span></>
            )}
            .
          </p>
        </div>

        <form onSubmit={handleOtpVerify} className="space-y-4">
          <div>
            <label htmlFor="otp" className="block text-[11px] font-bold tracking-[0.06em] uppercase text-[#8A8FA0] mb-1.5">
              Verification code
            </label>
            <input
              id="otp"
              type="text"
              inputMode="numeric"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="123456"
              maxLength={6}
              autoComplete="one-time-code"
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              className="w-full px-4 py-3 border border-[#16181D]/12 rounded-xl bg-white focus:ring-2 focus:ring-[#3B6EF6] focus:border-transparent text-center text-xl tracking-widest font-mono"
            />
          </div>

          {error && <p className="text-sm text-[#C2452D]">{error}</p>}

          <button
            type="submit"
            className="w-full py-3.5 bg-[#3B6EF6] text-white rounded-full hover:bg-[#16181D] font-bold transition-colors shadow-[0_10px_26px_rgba(59,110,246,0.3)]"
          >
            Verify
          </button>
        </form>

        <div className="mt-4 flex justify-between text-sm">
          <button
            type="button"
            onClick={handleResendOtp}
            disabled={busy}
            className="text-[#3B6EF6] hover:underline disabled:opacity-50"
          >
            {busy ? 'Sending…' : 'Resend code'}
          </button>
          <button
            type="button"
            onClick={() => { setError(''); setOtp(''); setStep('otp-email') }}
            className="text-[#8A8FA0] hover:underline"
          >
            Use a different email
          </button>
        </div>
      </Shell>
    )
  }

  if (step === 'workspace-picker') {
    return (
      <Shell>
        <h1 className="text-[28px] font-extrabold text-[#16181D] mb-1 tracking-[-0.02em]">Choose a workspace</h1>
        <p className="text-sm text-[#5A5E6B] mb-6">
          Your email is linked to multiple organizations. Pick one to continue.
        </p>
        <div className="space-y-2">
          {orgs.map((org) => (
            <button
              key={org.id}
              type="button"
              onClick={() => handlePickOrg(org)}
              className="w-full flex items-center gap-3 p-4 border border-[#16181D]/10 rounded-xl hover:border-[#3B6EF6] hover:bg-[#3B6EF6]/5 transition-all text-left"
            >
              <div className="w-10 h-10 rounded-lg bg-[#3B6EF6]/10 flex items-center justify-center flex-shrink-0 text-sm font-bold text-[#3B6EF6]">
                {org.name.charAt(0)}
              </div>
              <div>
                <p className="font-semibold text-[#16181D]">{org.name}</p>
                <p className="text-xs text-[#8A8FA0]">
                  {org.type === 'university' ? 'University' : 'Firm'}
                  {org.network_label ? ` · ${org.network_label}` : ''}
                </p>
              </div>
            </button>
          ))}
        </div>
      </Shell>
    )
  }

  return null
}

// ── Layout helpers ────────────────────────────────────────────────────────────

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

function MailIcon() {
  return (
    <svg className="w-6 h-6 text-[#3B6EF6]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  )
}

export default function SignInPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <SignInInner />
    </Suspense>
  )
}
