'use client'

import { Suspense, useEffect, useState, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase/client'
import PasswordInput from '@/components/ui/PasswordInput'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import type { Institution } from '@/types'
import { safeRedirectPath } from '@/lib/security/safeRedirect'
import { Button, Input, StatusState } from '@/components/ui'
import { AuthLoading, AuthShell, fieldLabelClass, textLinkClass } from '@/components/auth/AuthShell'

function SignUpInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [institution, setInstitution] = useState<Institution | null>(null)
  const [loading, setLoading] = useState(true)
  const [sendingCode, setSendingCode] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState('')
  const [email, setEmail] = useState(() => searchParams?.get('email') ?? '')
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
  const redirectTo = safeRedirectPath(searchParams?.get('redirect'), '') || undefined

  useEffect(() => {
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
  }, [institutionSlug])

  useEffect(() => {
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
  }, [router, redirectTo, institutionSlug])

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
    if (!/^\d{6}$/.test(trimmedCode)) {
      setError('Please enter the 6-digit verification code from your email')
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

  const signInParams = new URLSearchParams()
  if (institutionSlug) signInParams.set('institution', institutionSlug)
  if (redirectTo) signInParams.set('redirect', redirectTo)
  const signInUrl = `/sign-in${signInParams.size ? `?${signInParams}` : ''}`

  if (needsPassword) {
    return (
      <AuthShell
        eyebrow="Step 2 of 3"
        title="Create your password"
        description="Choose a password for quicker sign in next time. Use at least 8 characters."
      >
        <form onSubmit={handleSetPassword} className="space-y-4">
          <div>
            <label htmlFor="password" className={fieldLabelClass}>Password</label>
            <PasswordInput
              id="password"
              value={password}
              onChange={setPassword}
              placeholder="At least 8 characters"
              autoComplete="new-password"
              minLength={8}
              shown={showPassword}
              onShownChange={setShowPassword}
              aria-invalid={!!passwordError || undefined}
              aria-describedby={passwordError ? 'sign-up-password-error' : 'password-help'}
            />
            <p id="password-help" className="mt-2 text-xs text-text-muted">Use at least 8 characters.</p>
          </div>
          <div>
            <label htmlFor="confirmPassword" className={fieldLabelClass}>Confirm password</label>
            <PasswordInput
              id="confirmPassword"
              value={confirmPassword}
              onChange={setConfirmPassword}
              placeholder="Repeat your password"
              autoComplete="new-password"
              minLength={8}
              shown={showPassword}
              onShownChange={setShowPassword}
              aria-invalid={!!passwordError || undefined}
              aria-describedby={passwordError ? 'sign-up-password-error' : undefined}
            />
          </div>
          {passwordError && <StatusState id="sign-up-password-error" status="error" title={passwordError} />}
          <Button type="submit" loading={settingPassword} className="w-full">
            {settingPassword ? 'Setting password…' : 'Continue to profile'}
          </Button>
        </form>
      </AuthShell>
    )
  }

  if (codeSent) {
    return (
      <AuthShell
        eyebrow="Step 1 of 3"
        title="Enter verification code"
        description={<>We sent a 6-digit code to <strong className="text-text-primary">{codeSentTo}</strong>.</>}
        footer={<Link href={signInUrl} className={textLinkClass}>Already have an account? Sign in</Link>}
      >
        <form onSubmit={handleVerifyCode} className="space-y-4">
          <div>
            <label htmlFor="code" className={fieldLabelClass}>Verification code</label>
            <Input
              id="code"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              className="py-3 text-center font-mono text-xl tracking-[0.35em]"
              autoComplete="one-time-code"
              autoFocus
              aria-invalid={!!error || undefined}
              aria-describedby={error ? 'sign-up-code-error' : 'sign-up-code-help'}
            />
          </div>
          <StatusState
            id="sign-up-code-help"
            status="info"
            title="Don’t see the code?"
            description="Check your spam or junk folder, or use a different email."
          />
          {error && <StatusState id="sign-up-code-error" status="error" title={error} />}
          <Button type="submit" loading={verifying} className="w-full">
            {verifying ? 'Verifying…' : 'Verify and continue'}
          </Button>
        </form>
        <Button type="button" variant="ghost" onClick={handleBackToEmail} className="mt-3 w-full shadow-none">
          Use a different email
        </Button>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      eyebrow="Step 1 of 3"
      title="Create account"
      description={loading
        ? 'You can start while we look for your institution.'
        : institution
          ? `Use your ${institution.name} email. We’ll send a code to verify it.`
          : 'Enter your email and we’ll send a code to verify it.'}
      footer={
        <div className="flex flex-col items-start justify-between gap-1 sm:flex-row sm:items-center">
          <Link href={signInUrl} className={textLinkClass}>Already have an account? Sign in</Link>
          <Link href="/" className={textLinkClass}>Back home</Link>
        </div>
      }
    >
      {loading && (
        <StatusState
          status="loading"
          title="Finding your institution"
          className="mb-4"
        />
      )}
      <form onSubmit={handleSendCode} className="space-y-4" noValidate>
        <div>
          <label htmlFor="email" className={fieldLabelClass}>Email</label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            aria-invalid={error.toLowerCase().includes('email') || undefined}
            aria-describedby={error ? 'sign-up-error' : undefined}
          />
        </div>
        <div className="flex items-start gap-3">
          <input
            id="terms-agreement"
            type="checkbox"
            checked={agreedToTerms}
            onChange={(e) => setAgreedToTerms(e.target.checked)}
            className="mt-1 h-5 w-5 shrink-0 rounded border-border bg-background-light text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-invalid={error.toLowerCase().includes('terms') || undefined}
            aria-describedby={error ? 'sign-up-error' : undefined}
          />
          <label htmlFor="terms-agreement" className="text-sm leading-6 text-text-secondary">
            I agree to the{' '}
            <Link href="/terms" target="_blank" rel="noopener noreferrer" className="font-semibold text-accent underline-offset-4 hover:underline">
              Terms of Service
            </Link>{' '}
            and{' '}
            <Link href="/privacy" target="_blank" rel="noopener noreferrer" className="font-semibold text-accent underline-offset-4 hover:underline">
              Privacy Policy
            </Link>.
          </label>
        </div>
        {error && <StatusState id="sign-up-error" status="error" title={error} />}
        <Button type="submit" loading={sendingCode} className="w-full">
          {sendingCode ? 'Sending code…' : 'Send verification code'}
        </Button>
      </form>
    </AuthShell>
  )
}

export default function SignUpPage() {
  return (
    <Suspense fallback={<AuthLoading label="Preparing account creation" />}>
      <SignUpInner />
    </Suspense>
  )
}
