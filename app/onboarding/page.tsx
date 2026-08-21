'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuthSession } from '@/hooks/useAuthSession'
import { safeRedirectPath } from '@/lib/security/safeRedirect'
import { AuthLoading, AuthShell, fieldLabelClass } from '@/components/auth/AuthShell'
import { Button, Input, Select, StatusState } from '@/components/ui'

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
  const [institutionId, setInstitutionId] = useState<string | null>(() =>
    typeof window !== 'undefined' ? sessionStorage.getItem('pinspace_institution_id') : null,
  )
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
    if (institutionId) return
    const slug = searchParams?.get('institution')
    if (!slug) return
    fetch('/api/institutions', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: { institutions: { id: string; slug: string }[] }) => {
        const inst = (data?.institutions || []).find((i) => i.slug === slug)
        if (inst) setInstitutionId(inst.id)
      })
      .catch(() => {})
  }, [institutionId, searchParams])

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
    try {
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
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || data.details || 'Failed to save')
        return
      }
      sessionStorage.removeItem('pinspace_institution_id')
      router.replace(redirectTo)
    } catch {
      setError('We could not save your profile. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (!isLoaded || !user || hasProfile === null) {
    return <AuthLoading label="Preparing your profile" />
  }

  if (hasProfile === true) {
    return <AuthLoading label="Opening your workspace" />
  }

  return (
    <AuthShell
      eyebrow="Step 3 of 3"
      title="Welcome to pinspace"
      description="Tell us a little about your practice. Required fields are marked; the rest is optional and used for community insights."
      wide
    >
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="min-w-0">
              <label htmlFor="first-name" className={fieldLabelClass}>First name <span aria-hidden="true">*</span></label>
              <Input
                id="first-name"
                type="text"
                value={formData.first_name}
                onChange={(e) => setFormData((p) => ({ ...p, first_name: e.target.value }))}
                placeholder="Jane"
                autoComplete="given-name"
                required
                aria-invalid={error.includes('First and last name') || undefined}
                aria-describedby={error ? 'onboarding-error' : undefined}
              />
            </div>
            <div className="min-w-0">
              <label htmlFor="last-name" className={fieldLabelClass}>Last name <span aria-hidden="true">*</span></label>
              <Input
                id="last-name"
                type="text"
                value={formData.last_name}
                onChange={(e) => setFormData((p) => ({ ...p, last_name: e.target.value }))}
                placeholder="Smith"
                autoComplete="family-name"
                required
                aria-invalid={error.includes('First and last name') || undefined}
                aria-describedby={error ? 'onboarding-error' : undefined}
              />
            </div>
          </div>
          <div>
            <label htmlFor="community-role" className={fieldLabelClass}>I am a <span aria-hidden="true">*</span></label>
            <Select
              id="community-role"
              value={formData.role}
              onChange={(e) => setFormData((p) => ({ ...p, role: e.target.value }))}
              required
              aria-describedby={error ? 'onboarding-error' : undefined}
            >
              <option value="">Select…</option>
              {ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor="age-range" className={fieldLabelClass}>Age range</label>
            <Select
              id="age-range"
              value={formData.age_range}
              onChange={(e) => setFormData((p) => ({ ...p, age_range: e.target.value }))}
            >
              <option value="">Optional</option>
              {AGE_RANGES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </Select>
          </div>
          {formData.role === 'Student' && (
          <div>
            <label htmlFor="study-year" className={fieldLabelClass}>Year</label>
            <Select
              id="study-year"
              value={formData.year}
              onChange={(e) => setFormData((p) => ({ ...p, year: e.target.value }))}
            >
              <option value="">Select year</option>
              {YEARS.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </Select>
          </div>
          )}
          {(formData.role === 'Student' || formData.role === 'Faculty') && (
          <div>
            <label htmlFor="major-program" className={fieldLabelClass}>Major / program</label>
            <Select
              id="major-program"
              value={formData.major}
              onChange={(e) => setFormData((p) => ({ ...p, major: e.target.value }))}
            >
              <option value="">Select major</option>
              {MAJORS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </Select>
            {formData.major === 'Other' && (
              <div className="mt-3">
              <label htmlFor="major-other" className={fieldLabelClass}>Specify your major</label>
              <Input
                id="major-other"
                type="text"
                value={formData.major_other}
                onChange={(e) => setFormData((p) => ({ ...p, major_other: e.target.value }))}
                placeholder="Specify your major"
              />
              </div>
            )}
          </div>
          )}
          <div>
            <label htmlFor="how-heard" className={fieldLabelClass}>How did you hear about pinspace?</label>
            <Select
              id="how-heard"
              value={formData.how_heard}
              onChange={(e) => setFormData((p) => ({ ...p, how_heard: e.target.value }))}
            >
              <option value="">Optional</option>
              {HOW_HEARD.map((h) => (
                <option key={h} value={h}>{h}</option>
              ))}
            </Select>
          </div>
          {error && <StatusState id="onboarding-error" status="error" title={error} />}
          <Button type="submit" loading={submitting} className="w-full">
            {submitting ? 'Saving…' : 'Continue'}
          </Button>
        </form>
    </AuthShell>
  )
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={<AuthLoading label="Preparing your profile" />}>
      <OnboardingContent />
    </Suspense>
  )
}
