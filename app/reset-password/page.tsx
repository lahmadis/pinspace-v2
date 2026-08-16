'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase/client'
import PasswordInput from '@/components/ui/PasswordInput'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { Button, StatusState } from '@/components/ui'
import { AuthLoading, AuthShell, fieldLabelClass, textLinkClass } from '@/components/auth/AuthShell'

function ResetPasswordInner() {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [invalid, setInvalid] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  // Shared across both fields — same reasoning as the sign-up pair.
  const [showPassword, setShowPassword] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    // The browser client uses the PKCE flow (auth-helpers-nextjs forces it), so
    // recovery links arrive as /reset-password?code=<code>. Because the client
    // singleton has detectSessionInUrl:true, it likely auto-exchanges that ?code
    // at module init — BEFORE this effect runs — which is why passively waiting
    // for a PASSWORD_RECOVERY event used to silently fail. Drive readiness from
    // the actual session/exchange result instead, and stay resilient to that race.
    let active = true

    const markReady = () => {
      if (!active) return
      setInvalid(false)
      setReady(true)
    }
    const markInvalid = () => {
      if (active) setInvalid(true)
    }

    // Still listen for events the auto-exchange may emit (PASSWORD_RECOVERY, or
    // SIGNED_IN with a session) so we catch the recovery session even if it lands
    // after our initial getSession() check.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event: AuthChangeEvent, session: Session | null) => {
        if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session)) {
          markReady()
        }
      }
    )

    const init = async () => {
      // 1. A valid session may ALREADY exist because detectSessionInUrl consumed
      //    the ?code at client init (the race). If so, we're in a recovery context
      //    — show the form. Do NOT bounce to /dashboard here.
      const { data: { session } } = await supabase.auth.getSession()
      if (!active) return
      if (session) {
        markReady()
        return
      }

      // 2. Legacy hash/implicit recovery flow — keep working.
      if (typeof window !== 'undefined' && window.location.hash) {
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
        const accessToken = hash.get('access_token')
        const refreshToken = hash.get('refresh_token')
        if (accessToken && refreshToken && hash.get('type') === 'recovery') {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          })
          if (!active) return
          if (error) markInvalid()
          else markReady()
          return
        }
      }

      // 3. PKCE flow: explicitly exchange the ?code for a session.
      const code =
        typeof window !== 'undefined'
          ? new URLSearchParams(window.location.search).get('code')
          : null
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (!active) return
        if (!error) {
          markReady()
          return
        }
        // The auto-exchange may have already consumed this single-use code; a
        // session could still have been established — re-check before failing.
        const { data: { session: raced } } = await supabase.auth.getSession()
        if (!active) return
        if (raced) markReady()
        else markInvalid()
        return
      }

      // 4. No session, no recovery hash, no code → genuinely invalid/expired.
      markInvalid()
    }

    void init()

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    setSubmitting(true)
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) {
        setError(updateError.message || 'Failed to update password')
        return
      }
      setDone(true)
      setTimeout(() => router.replace('/dashboard'), 2000)
    } catch {
      setError('We could not update your password. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <AuthShell eyebrow="Recovery complete" title="Password updated">
        <StatusState
          status="success"
          title="Your new password is ready"
          description="Redirecting you to your dashboard…"
        />
      </AuthShell>
    )
  }

  if (invalid && !ready) {
    return (
      <AuthShell
        eyebrow="Recovery link"
        title="Link expired or invalid"
        description="This password reset link has expired or already been used. Request a new one to continue safely."
      >
        <Link href="/forgot-password" className={`${textLinkClass} w-full justify-center border border-border bg-primary-muted px-4`}>
          Request a new reset link
        </Link>
      </AuthShell>
    )
  }

  if (!ready) {
    return <AuthLoading label="Validating your reset link" />
  }

  return (
    <AuthShell
      eyebrow="Secure recovery"
      title="Set new password"
      description="Use at least 8 characters. Both fields must match."
    >
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <label htmlFor="password" className={fieldLabelClass}>
              New password
            </label>
            <PasswordInput
              id="password"
              value={password}
              onChange={setPassword}
              placeholder="••••••••"
              autoComplete="new-password"
              minLength={8}
              autoFocus
              shown={showPassword}
              onShownChange={setShowPassword}
              aria-invalid={!!error || undefined}
              aria-describedby={error ? 'reset-password-error' : 'reset-password-help'}
            />
            <p id="reset-password-help" className="mt-2 text-xs text-text-muted">At least 8 characters.</p>
          </div>
          <div>
            <label htmlFor="confirmPassword" className={fieldLabelClass}>
              Confirm new password
            </label>
            <PasswordInput
              id="confirmPassword"
              value={confirmPassword}
              onChange={setConfirmPassword}
              placeholder="••••••••"
              autoComplete="new-password"
              minLength={8}
              shown={showPassword}
              onShownChange={setShowPassword}
              aria-invalid={!!error || undefined}
              aria-describedby={error ? 'reset-password-error' : undefined}
            />
          </div>
          {error && <StatusState id="reset-password-error" status="error" title={error} />}
          <Button type="submit" loading={submitting} className="w-full">
            {submitting ? 'Updating…' : 'Update password'}
          </Button>
        </form>
    </AuthShell>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<AuthLoading label="Validating your reset link" />}>
      <ResetPasswordInner />
    </Suspense>
  )
}
