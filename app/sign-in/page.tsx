'use client'

import { Suspense, useEffect, useState, useRef, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Mail } from 'lucide-react'
import { supabase } from '@/lib/supabase/client'
import PasswordInput from '@/components/ui/PasswordInput'
import { safeRedirectPath } from '@/lib/security/safeRedirect'
import { Button, Input, StatusState } from '@/components/ui'
import { AuthLoading, AuthShell, fieldLabelClass, textLinkClass } from '@/components/auth/AuthShell'

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
  const redirectTo = safeRedirectPath(searchParams?.get('redirect'))
  const [orgName, setOrgName] = useState<string | null>(null)
  const [orgFetchDone, setOrgFetchDone] = useState(false)

  useEffect(() => {
    if (!institutionSlug) return
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
  }, [institutionSlug])

  // After any successful sign-in: write org context, check profile, redirect
  const redirectAfterSignIn = useCallback(async (orgSlug?: string) => {
    if (hasRedirected.current) return
    hasRedirected.current = true

    if (orgSlug) {
      sessionStorage.setItem('pinspace_institution', orgSlug)
    }

    const target = redirectTo
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

  if (step === 'checking' || step === 'verifying') {
    return <AuthLoading label={step === 'verifying' ? 'Verifying your code' : 'Preparing sign in'} />
  }

  if (step === 'password' || step === 'otp-email') {
    const isPassword = step === 'password'
    const signUpParams = new URLSearchParams()
    if (email) signUpParams.set('email', email)
    if (institutionSlug) signUpParams.set('institution', institutionSlug)
    if (redirectTo !== '/dashboard') signUpParams.set('redirect', redirectTo)
    const signUpHref = `/sign-up${signUpParams.size ? `?${signUpParams}` : ''}`
    const forgotPasswordParams = new URLSearchParams()
    if (email) forgotPasswordParams.set('email', email)
    if (institutionSlug) forgotPasswordParams.set('institution', institutionSlug)
    const forgotPasswordHref = `/forgot-password${forgotPasswordParams.size ? `?${forgotPasswordParams}` : ''}`
    const genericSubtitle = isPassword
      ? 'Welcome back. Sign in to Kova.'
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
      <AuthShell
        title="Sign in"
        description={subtitle}
        footer={
          <div className="flex flex-col items-start justify-between gap-1 sm:flex-row sm:items-center">
            <Link href={signUpHref} className={textLinkClass}>Don&apos;t have an account? Sign up</Link>
            <Link href="/" className={textLinkClass}>Back home</Link>
          </div>
        }
      >
        <form onSubmit={isPassword ? handlePasswordSignIn : handleEmailContinue} className="space-y-4">
          <div>
            <label htmlFor="email" className={fieldLabelClass}>Email</label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@school.edu"
              autoComplete="email"
              autoFocus={!email}
              aria-invalid={error.toLowerCase().includes('email') || undefined}
              aria-describedby={error ? 'sign-in-error' : undefined}
            />
          </div>

          {isPassword && (
            <div>
              <label htmlFor="password" className={fieldLabelClass}>Password</label>
              <PasswordInput
                id="password"
                value={password}
                onChange={setPassword}
                placeholder="••••••••"
                autoComplete="current-password"
                autoFocus={!!email}
                aria-invalid={error.toLowerCase().includes('password') || undefined}
                aria-describedby={error ? 'sign-in-error' : undefined}
              />
              <div className="mt-1 flex justify-end">
                <Link href={forgotPasswordHref} className={textLinkClass}>
                  Forgot password?
                </Link>
              </div>
            </div>
          )}

          {error && <StatusState id="sign-in-error" status="error" title={error} />}

          {isPassword && showResetHint && (
            <Link
              href={forgotPasswordHref}
              className={textLinkClass}
            >
              Reset password
            </Link>
          )}

          {!isPassword && showSignUpHint && (
            <p className="text-sm text-text-secondary">
              <Link
                href={signUpHref}
                className={textLinkClass}
              >
                Sign up here
              </Link>
              {' '}to create an account.
            </p>
          )}

          <Button
            type="submit"
            loading={busy}
            className="w-full"
          >
            {busy ? (isPassword ? 'Signing in…' : 'Sending code…') : (isPassword ? 'Sign in' : 'Continue')}
          </Button>
        </form>

        {isPassword ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setError('')
              setShowResetHint(false)
              setShowSignUpHint(false)
              setStep('otp-email')
            }}
            className="mt-3 w-full shadow-none"
          >
            Sign in with email code instead
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setError('')
              setShowResetHint(false)
              setShowSignUpHint(false)
              setStep('password')
            }}
            className="mt-3 w-full shadow-none"
          >
            Sign in with password instead
          </Button>
        )}
      </AuthShell>
    )
  }

  if (step === 'check-email') {
    return (
      <AuthShell
        eyebrow="Secure sign in"
        title="Check your email"
        description={
          <>
            We sent a 6-digit code to{' '}
            <strong className="text-text-primary">{email}</strong>
            {orgs.length === 1 && (
              <> for <strong className="text-text-primary">{orgs[0].name}</strong></>
            )}
            .
          </>
        }
      >
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-kova bg-primary-muted text-primary-dark">
          <Mail aria-hidden="true" className="h-6 w-6" />
        </div>
        <form onSubmit={handleOtpVerify} className="space-y-4">
          <div>
            <label htmlFor="otp" className={fieldLabelClass}>
              Verification code
            </label>
            <Input
              id="otp"
              type="text"
              inputMode="numeric"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="123456"
              maxLength={6}
              autoComplete="one-time-code"
              autoFocus
              className="py-3 text-center font-mono text-xl tracking-[0.3em]"
              aria-invalid={!!error || undefined}
              aria-describedby={error ? 'sign-in-error' : 'otp-guidance'}
            />
            <p id="otp-guidance" className="mt-2 text-xs leading-5 text-text-muted">Use the latest code. It may be in your spam or junk folder.</p>
          </div>

          {error && <StatusState id="sign-in-error" status="error" title={error} />}

          <Button
            type="submit"
            className="w-full"
          >
            Verify
          </Button>
        </form>

        <div className="mt-4 flex flex-col justify-between gap-1 text-sm sm:flex-row">
          <Button
            type="button"
            variant="ghost"
            onClick={handleResendOtp}
            loading={busy}
            className="shadow-none"
          >
            {busy ? 'Sending…' : 'Resend code'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => { setError(''); setOtp(''); setStep('otp-email') }}
            className="shadow-none"
          >
            Use a different email
          </Button>
        </div>
      </AuthShell>
    )
  }

  if (step === 'workspace-picker') {
    return (
      <AuthShell
        eyebrow="Workspace context"
        title="Choose a workspace"
        description="Your email is linked to multiple organizations. Pick one to continue."
      >
        <div className="space-y-2">
          {orgs.map((org) => (
            <Button
              key={org.id}
              type="button"
              variant="ghost"
              onClick={() => handlePickOrg(org)}
              className="h-auto w-full justify-start gap-3 border-border bg-background-light p-4 text-left shadow-none hover:border-accent"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-kova bg-primary-muted text-sm font-bold text-primary-dark">
                {org.name.charAt(0)}
              </span>
              <span className="min-w-0">
                <span className="block truncate font-semibold text-text-primary">{org.name}</span>
                <span className="block text-xs text-text-muted">
                  {org.type === 'university' ? 'University' : 'Firm'}
                  {org.network_label ? ` · ${org.network_label}` : ''}
                </span>
              </span>
            </Button>
          ))}
        </div>
      </AuthShell>
    )
  }

  return null
}

export default function SignInPage() {
  return (
    <Suspense fallback={<AuthLoading label="Preparing sign in" />}>
      <SignInInner />
    </Suspense>
  )
}
