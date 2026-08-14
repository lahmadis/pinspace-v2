'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuthSession } from '@/hooks/useAuthSession'
import { safeRedirectPath } from '@/lib/security/safeRedirect'

const ROLES = ['Student', 'Faculty', 'Professional (working at a firm)', 'Independent Creator'] as const
const ROLE_TO_VALUE: Record<string, 'student' | 'faculty' | 'professional' | null> = {
  Student: 'student',
  Faculty: 'faculty',
  'Professional (working at a firm)': 'professional',
  'Independent Creator': null,
}
const YEARS = ['Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', 'Masters'] as const
const MAJORS = ['Architecture', 'Interior Design', 'Industrial Design', 'Other'] as const
const AGE_RANGES = ['18-22', '23-30', '31-40', '41+'] as const
const HOW_HEARD = ['Professor or instructor', 'Classmate', 'School website', 'Social media', 'Other'] as const

function OnboardingContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { status: authStatus, user } = useAuthSession()
  const isLoaded = authStatus !== 'loading'
  const [hasProfile, setHasProfile] = useState<boolean | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [institutionId, setInstitutionId] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    first_name: '',
    last_name: '',
    role: '',
    age_range: '',
    year: '',
    major: '',
    major_other: '',
    how_heard: '',
  })

  const redirectTo = safeRedirectPath(searchParams?.get('redirect'))

  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      router.replace('/sign-in')
    }
  }, [authStatus, router])

  useEffect(() => {
    const stored = sessionStorage.getItem('pinspace_institution_id')
    if (stored) {
      setInstitutionId(stored)
      return
    }
    const slug = searchParams?.get('institution')
    if (!slug) return
    fetch('/api/institutions', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: { institutions: { id: string; slug: string }[] }) => {
        const inst = (data?.institutions || []).find((i) => i.slug === slug)
        if (inst) setInstitutionId(inst.id)
      })
      .catch(() => {})
  }, [searchParams])

  useEffect(() => {
    if (!user?.id) return
    fetch('/api/user-profile', { cache: 'no-store' })
      .then((r) => {
        if (r.status === 401) return null
        return r.json()
      })
      .then((data) => {
        setHasProfile(!!(data && data.user_id))
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
    if (!formData.first_name.trim() || !formData.last_name.trim()) {
      setError('First and last name are required.')
      return
    }
    const role = ROLE_TO_VALUE[formData.role] ?? null
    const showYearField = role === 'student'
    const showMajorField = role === 'student' || role === 'faculty'
    const year = showYearField ? (formData.year || null) : null
    const major = showMajorField
      ? (formData.major === 'Other' ? (formData.major_other.trim() || null) : (formData.major || null))
      : null
    setSubmitting(true)
    const res = await fetch('/api/user-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: `${formData.first_name.trim()} ${formData.last_name.trim()}`.trim() || null,
        role,
        age_range: formData.age_range || null,
        year,
        major,
        how_heard: formData.how_heard || null,
        organization_id: institutionId || null,
      }),
    })
    setSubmitting(false)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || data.details || 'Failed to save')
      return
    }
    sessionStorage.removeItem('pinspace_institution_id')
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
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">First name <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={formData.first_name}
                onChange={(e) => setFormData((p) => ({ ...p, first_name: e.target.value }))}
                placeholder="Jane"
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">Last name <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={formData.last_name}
                onChange={(e) => setFormData((p) => ({ ...p, last_name: e.target.value }))}
                placeholder="Smith"
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
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
          {formData.role === 'Student' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Year</label>
            <select
              value={formData.year}
              onChange={(e) => setFormData((p) => ({ ...p, year: e.target.value }))}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            >
              <option value="">Select year</option>
              {YEARS.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          )}
          {(formData.role === 'Student' || formData.role === 'Faculty') && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Major / Program</label>
            <select
              value={formData.major}
              onChange={(e) => setFormData((p) => ({ ...p, major: e.target.value }))}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
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
          )}
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
