'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { LayoutDashboard, PanelsTopLeft, Settings } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'

import { AppShell } from '@/components/layout/AppShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button, Card, Input, Select, Skeleton, StatusState } from '@/components/ui'
import { useAuthSession } from '@/hooks/useAuthSession'
import { useAccountMode } from '@/lib/useAccountMode'
import type { Institution } from '@/types'

const navigation = [
  { href: '/dashboard', label: 'Projects', icon: <LayoutDashboard className="h-4 w-4" />, exact: true },
  { href: '/my-boards', label: 'My boards', icon: <PanelsTopLeft className="h-4 w-4" />, exact: true },
]

const footerNavigation = [
  { href: '/settings', label: 'Settings', icon: <Settings className="h-4 w-4" /> },
]

function LoadingState() {
  return (
    <AppShell navigation={navigation} footerNavigation={footerNavigation} currentPath="/workspace/new" contentClassName="bg-background">
      <div role="status" aria-label="Loading project creation" className="mx-auto w-full max-w-3xl space-y-5 px-4 py-8 sm:px-6 lg:px-8">
        <span className="sr-only">Loading project creation</span>
        <Skeleton className="h-9 w-64" />
        <Card className="space-y-4"><Skeleton className="h-11 w-full" /><Skeleton className="h-11 w-full" /></Card>
      </div>
    </AppShell>
  )
}

function NewWorkspaceForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const typeParam = searchParams?.get('type') === 'shared' ? 'shared' : null
  const { status: authStatus, user } = useAuthSession()
  const { mode: accountMode } = useAccountMode(user?.id)
  const [loading, setLoading] = useState(false)
  const [institutions, setInstitutions] = useState<Institution[]>([])
  const [name, setName] = useState('')
  const [institutionSlug, setInstitutionSlug] = useState('')
  const [error, setError] = useState('')
  const submittingRef = useRef(false)

  const title = typeParam === 'shared'
    ? 'Create Shared Project'
    : accountMode === 'personal'
      ? 'Create a Personal Project'
      : 'Create a Project'
  const description = typeParam === 'shared'
    ? 'Set up a shared space for collaboration.'
    : accountMode === 'personal'
      ? 'Set up a private space for your own work.'
      : 'Set up a space where collaborators can work together.'

  useEffect(() => {
    if (authStatus === 'unauthenticated') router.push('/sign-in')
  }, [authStatus, router])

  useEffect(() => {
    if (authStatus === 'loading') return
    fetch('/api/institutions', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : [])
      .then((list: Institution[]) => {
        setInstitutions(list)
        if (!list.length) return
        const initialSlug = list.find((institution) => institution.slug === 'wit')?.slug ?? list[0].slug
        setInstitutionSlug((current) => current || initialSlug)
      })
      .catch(() => setInstitutions([]))
  }, [authStatus])

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submittingRef.current) return
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('Enter a project name')
      return
    }

    submittingRef.current = true
    setLoading(true)
    setError('')
    try {
      let creatorName = ''
      try {
        const profileResponse = await fetch('/api/user-profile', { cache: 'no-store' })
        if (profileResponse.ok) {
          const profile = await profileResponse.json()
          if (typeof profile?.full_name === 'string') creatorName = profile.full_name.trim()
        }
      } catch {
        // Profile lookup is best effort; preserve the established fallback.
      }

      const payload: Record<string, string> = {
        name: trimmedName,
        creatorName: creatorName || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Instructor',
      }
      if (institutionSlug) payload.institution_slug = institutionSlug
      if (typeParam === 'shared') payload.type = 'shared'

      const response = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || data.details || 'Failed to create project')
      const workspaceId = data.id || data.workspace?.id
      if (!workspaceId) throw new Error('Project created but no ID returned')
      router.push(`/workspace/${workspaceId}/settings`)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Failed to create project')
    } finally {
      submittingRef.current = false
      setLoading(false)
    }
  }

  if (authStatus === 'loading') return <LoadingState />

  return (
    <AppShell navigation={navigation} footerNavigation={footerNavigation} currentPath="/workspace/new" contentClassName="bg-background">
      <PageHeader eyebrow="Projects" title={title} description={description} />
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
        <Card className="p-5 sm:p-7">
          <form onSubmit={handleSubmit} className="space-y-6" noValidate>
            <div>
              <label htmlFor="project-name" className="mb-1.5 block text-sm font-semibold text-text-primary">Project name</label>
              <Input
                id="project-name"
                type="text"
                value={name}
                onChange={(event) => {
                  setName(event.target.value)
                  if (error === 'Enter a project name') setError('')
                }}
                maxLength={100}
                placeholder="e.g. Studio 08 — Fall 2026"
                disabled={loading}
                aria-invalid={error === 'Enter a project name'}
                aria-describedby={error === 'Enter a project name' ? 'project-name-help project-form-error' : 'project-name-help'}
              />
              <p id="project-name-help" className="mt-1.5 text-sm text-text-secondary">Use a clear name that will still make sense in a long project list.</p>
            </div>

            {institutions.length > 0 && (
              <div>
                <label htmlFor="project-institution" className="mb-1.5 block text-sm font-semibold text-text-primary">Institution or school</label>
                <Select id="project-institution" value={institutionSlug} disabled={loading} onChange={(event) => setInstitutionSlug(event.target.value)}>
                  {institutions.map((institution) => <option key={institution.id} value={institution.slug}>{institution.name}</option>)}
                </Select>
                <p className="mt-1.5 text-sm text-text-secondary">This project appears under the selected school in Explore.</p>
              </div>
            )}

            {error && <StatusState id="project-form-error" role="alert" status="error" title={error} />}

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Link href="/dashboard" className="inline-flex min-h-11 items-center justify-center rounded-pinspace px-4 py-2 text-sm font-semibold text-text-primary hover:bg-background-lighter focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Cancel</Link>
              <Button type="submit" size="lg" loading={loading}>{loading ? 'Creating project…' : 'Create project'}</Button>
            </div>
          </form>
        </Card>
        <p className="mt-5 text-center text-sm text-text-secondary">Questions? Contact your instructor or system administrator.</p>
      </div>
    </AppShell>
  )
}

export default function NewWorkspacePage() {
  return <Suspense fallback={<LoadingState />}><NewWorkspaceForm /></Suspense>
}
