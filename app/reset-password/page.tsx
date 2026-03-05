'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'

function ResetPasswordInner() {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [invalid, setInvalid] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    // Supabase fires PASSWORD_RECOVERY when the user arrives via the reset link.
    // The token is extracted from the URL hash automatically by the Supabase client.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event: AuthChangeEvent, _session: Session | null) => {
        if (event === 'PASSWORD_RECOVERY') {
          setReady(true)
        } else if (event === 'SIGNED_IN' && !ready) {
          // Already signed in for other reasons — redirect to dashboard
          router.replace('/dashboard')
        }
      }
    )

    // If no event fires within 3 seconds, the link is invalid/expired
    const timeout = setTimeout(() => {
      setInvalid((prev) => {
        if (!prev && !ready) return true
        return prev
      })
    }, 3000)

    return () => {
      subscription.unsubscribe()
      clearTimeout(timeout)
    }
  }, [router, ready])

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
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setSubmitting(false)
    if (updateError) {
      setError(updateError.message || 'Failed to update password')
      return
    }
    setDone(true)
    setTimeout(() => router.replace('/dashboard'), 2000)
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl border border-gray-200 text-center">
          <div className="text-4xl mb-4">✓</div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Password updated</h1>
          <p className="text-gray-500 text-sm">Redirecting you to your dashboard…</p>
        </div>
      </div>
    )
  }

  if (invalid && !ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl border border-gray-200 text-center">
          <h1 className="text-xl font-bold text-gray-900 mb-2">Link expired or invalid</h1>
          <p className="text-gray-600 mb-6 text-sm">
            This password reset link has expired or already been used. Request a new one.
          </p>
          <a
            href="/forgot-password"
            className="inline-block px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium"
          >
            Request new reset link
          </a>
        </div>
      </div>
    )
  }

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-600/20 border-t-indigo-600" />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl border border-gray-200">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Set new password</h1>
        <p className="text-sm text-gray-500 mb-6">Must be at least 8 characters.</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
              New password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              autoComplete="new-password"
              minLength={8}
              autoFocus
            />
          </div>
          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-1">
              Confirm new password
            </label>
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
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={submitting || password.length < 8 || confirmPassword.length < 8}
            className="w-full py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium"
          >
            {submitting ? 'Updating…' : 'Update password'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-600/20 border-t-indigo-600" />
      </div>
    }>
      <ResetPasswordInner />
    </Suspense>
  )
}
