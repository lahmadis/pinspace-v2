'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'

import { AuthLoading, AuthShell, fieldLabelClass, textLinkClass } from '@/components/auth/AuthShell'
import { Button, Input, StatusState } from '@/components/ui'
import { supabase } from '@/lib/supabase/client'

function ForgotPasswordInner() {
  const searchParams = useSearchParams()
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [email, setEmail] = useState(() => searchParams?.get('email') ?? '')
  const [storedInstitutionSlug, setStoredInstitutionSlug] = useState<string | null>(null)

  const institutionFromUrl = searchParams?.get('institution') ?? null
  const institutionSlug = institutionFromUrl ?? storedInstitutionSlug

  useEffect(() => {
    if (institutionFromUrl) sessionStorage.setItem('pinspace_institution', institutionFromUrl)
    // sessionStorage is unavailable during server rendering; update after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStoredInstitutionSlug(institutionFromUrl ?? sessionStorage.getItem('pinspace_institution'))
  }, [institutionFromUrl])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    const normalizedEmail = email.trim()
    if (!normalizedEmail) {
      setError('Please enter your email')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError('Please enter a valid email address')
      return
    }

    setSubmitting(true)
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: `${typeof window !== 'undefined' ? window.location.origin : ''}/reset-password`,
      })
      if (resetError) {
        setError(resetError.message || 'Failed to send reset email')
      } else {
        setEmail(normalizedEmail)
        setSent(true)
      }
    } catch {
      setError('We could not send the reset link. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const signInUrl = institutionSlug
    ? `/sign-in?institution=${encodeURIComponent(institutionSlug)}`
    : '/sign-in'

  if (sent) {
    return (
      <AuthShell
        eyebrow="Recovery email sent"
        title="Check your email"
        description={<>We sent a password reset link to <strong className="text-text-primary">{email}</strong>.</>}
        footer={<Link href={signInUrl} className={textLinkClass}>Back to sign in</Link>}
      >
        <StatusState
          status="success"
          title="Reset link sent"
          description="Open the latest email from PinSpace. The link can only be used once."
        />
      </AuthShell>
    )
  }

  return (
    <AuthShell
      eyebrow="Account recovery"
      title="Forgot password?"
      description="Enter your email and we’ll send a secure, single-use reset link."
      footer={<Link href={signInUrl} className={textLinkClass}>Back to sign in</Link>}
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="email" className={fieldLabelClass}>Email</label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@school.edu"
            autoComplete="email"
            autoFocus
            aria-invalid={!!error || undefined}
            aria-describedby={error ? 'forgot-password-error' : 'forgot-password-help'}
          />
          <p id="forgot-password-help" className="mt-2 text-xs leading-5 text-text-muted">
            Use the email connected to your PinSpace account.
          </p>
        </div>
        {error && <StatusState id="forgot-password-error" status="error" title={error} />}
        <Button type="submit" loading={submitting} className="w-full">
          {submitting ? 'Sending reset link…' : 'Send reset link'}
        </Button>
      </form>
    </AuthShell>
  )
}

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={<AuthLoading label="Preparing password recovery" />}>
      <ForgotPasswordInner />
    </Suspense>
  )
}
