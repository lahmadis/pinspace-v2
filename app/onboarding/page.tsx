'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import type { Session, AuthChangeEvent } from '@supabase/supabase-js'
import Link from 'next/link'

const ROLES = ['Student', 'Faculty', 'Professional (working at a firm)'] as const
const ROLE_TO_VALUE: Record<string, 'student' | 'faculty' | 'professional' | null> = {
  Student: 'student',
  Faculty: 'faculty',
  'Professional (working at a firm)': 'professional',
}
const YEARS = ['Year 1', 'Year 2', 'Year 3', 'Year 4', 'Masters'] as const
const MAJORS = ['Architecture', 'Interior Design', 'Industrial Design', 'Other'] as const
const AGE_RANGES = ['18-22', '23-30', '31-40', '41+'] as const
const HOW_HEARD = ['Professor or instructor', 'Classmate', 'School website', 'Social media', 'Other'] as const

function OnboardingContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [user, setUser] = useState<any>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const [hasProfile, setHasProfile] = useState<boolean | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [formData, setFormData] = useState({
    full_name: '',
    role: '',
    age_range: '',
    year: '',
    major: '',
    major_other: '',
    how_heard: '',
  })

  const redirectTo = searchParams?.get('redirect') || '/dashboard'

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }: { data: { session: Session | null } }) => {
      if (!session) {
        router.replace('/sign-in')
        return
      }
      setUser(session.user)
      setIsLoaded(true)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      if (!session) router.replace('/sign-in')
      else setUser(session.user)
      setIsLoaded(true)
    })
    return () => subscription.unsubscribe()
  }, [router])

  useEffect(() => {
    if (!user?.id) return
    fetch('/api/user-profile', { cache: 'no-store' })
      .then((r) => {
        if (r.status === 401) return null
        return r.json()
      })
      .then((data) => {
        setHasProfile(data && data.user_id)
      })
      .catch(() => setHasProfile(false))
  }, [user?.id])

  useEffect(() => {
    if (hasProfile === true) {
      router.replace(redirectTo)
    }
  }, [hasProfile, redirectTo, router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const year = formData.year || null
    const major = formData.major === 'Other' ? (formData.major_other.trim() || null) : (formData.major || null)
    const role = ROLE_TO_VALUE[formData.role] ?? null
    if (!year && !major) {
      setError('Please fill in at least year and major')
      return
    }
    setSubmitting(true)
    const res = await fetch('/api/user-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: formData.full_name.trim() || null,
        role,
        age_range: formData.age_range || null,
        year,
        major,
        how_heard: formData.how_heard || null,
      }),
    })
    setSubmitting(false)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || data.details || 'Failed to save')
      return
    }
    router.replace(redirectTo)
  }

  if (!isLoaded || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-200 border-t-indigo-600" />
      </div>
    )
  }

  if (hasProfile === true) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-200 border-t-indigo-600" />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl border border-gray-200">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Welcome to PinSpace</h1>
        <p className="text-sm text-gray-500 mb-6">Quick info to help us understand our community (used for stats only).</p>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Full name</label>
            <input
              type="text"
              value={formData.full_name}
              onChange={(e) => setFormData((p) => ({ ...p, full_name: e.target.value }))}
              placeholder="e.g. Jane Smith"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">I am a</label>
            <select
              value={formData.role}
              onChange={(e) => setFormData((p) => ({ ...p, role: e.target.value }))}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              required
            >
              <option value="">Select…</option>
              {ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Age range</label>
            <select
              value={formData.age_range}
              onChange={(e) => setFormData((p) => ({ ...p, age_range: e.target.value }))}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            >
              <option value="">Optional</option>
              {AGE_RANGES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Year *</label>
            <select
              value={formData.year}
              onChange={(e) => setFormData((p) => ({ ...p, year: e.target.value }))}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              required
            >
              <option value="">Select year</option>
              {YEARS.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Major / Program *</label>
            <select
              value={formData.major}
              onChange={(e) => setFormData((p) => ({ ...p, major: e.target.value }))}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              required
            >
              <option value="">Select major</option>
              {MAJORS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            {formData.major === 'Other' && (
              <input
                type="text"
                value={formData.major_other}
                onChange={(e) => setFormData((p) => ({ ...p, major_other: e.target.value }))}
                placeholder="Specify your major"
                className="mt-2 w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">How did you hear about PinSpace?</label>
            <select
              value={formData.how_heard}
              onChange={(e) => setFormData((p) => ({ ...p, how_heard: e.target.value }))}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            >
              <option value="">Optional</option>
              {HOW_HEARD.map((h) => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium"
          >
            {submitting ? 'Saving…' : 'Continue'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-500/20 border-t-indigo-500 mx-auto mb-4" />
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    }>
      <OnboardingContent />
    </Suspense>
  )
}
