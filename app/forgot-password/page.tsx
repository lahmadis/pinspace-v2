'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase/client'
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

function ForgotPasswordInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [institution, setInstitution] = useState<Institution | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [email, setEmail] = useState('')

  const institutionSlug = searchParams?.get('institution') ?? (typeof window !== 'undefined' ? sessionStorage.getItem('pinspace_institution') : null)

  useEffect(() => {
    if (institutionSlug) sessionStorage.setItem('pinspace_institution', institutionSlug)
    fetch('/api/institutions', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: Institution[]) => {
        const inst = (Array.isArray(data) ? data : []).find((i) => i.slug === (institutionSlug || ''))
        setInstitution(inst || null)
      })
      .finally(() => setLoading(false))
  }, [institutionSlug])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!email.trim()) {
      setError('Please enter your email')
      return
    }
    if (institution?.allowed_email_domains) {
      const allowed = getAllowedDomains(institution.allowed_email_domains)
      if (allowed.length > 0 && !emailDomainAllowed(email.trim(), allowed)) {
        setError(`Please use a ${institution.name} email`)
        return
      }
    }
    setSubmitting(true)
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${typeof window !== 'undefined' ? window.location.origin : ''}/reset-password`,
    })
    setSubmitting(false)
    if (err) {
      setError(err.message || 'Failed to send reset email')
    } else {
      setSent(true)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-600/20 border-t-indigo-600" />
      </div>
    )
  }

  const signInUrl = institutionSlug ? `/sign-in?institution=${institutionSlug}` : '/sign-in'

  if (sent) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl border border-gray-200 text-center">
          <h1 className="text-xl font-bold text-gray-900 mb-2">Check your email</h1>
          <p className="text-gray-600 mb-6">We sent a password reset link to {email}</p>
          <Link href={signInUrl} className="text-indigo-600 hover:underline">← Back to sign in</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl border border-gray-200">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Forgot password</h1>
        <p className="text-sm text-gray-500 mb-6">Enter your school email and we&apos;ll send a reset link</p>
        <form onSubmit={handleSubmit} className="space-y-4">
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
            disabled={submitting}
            className="w-full py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium"
          >
            {submitting ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
        <div className="mt-4 text-sm">
          <Link href={signInUrl} className="text-indigo-600 hover:underline">← Back to sign in</Link>
        </div>
      </div>
    </div>
  )
}

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-600/20 border-t-indigo-600" />
      </div>
    }>
      <ForgotPasswordInner />
    </Suspense>
  )
}
