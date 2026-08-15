'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { LayoutDashboard, PanelsTopLeft, Settings } from 'lucide-react'
import { useRouter } from 'next/navigation'

import { AppShell } from '@/components/layout/AppShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button, Card, Input, Skeleton, StatusState } from '@/components/ui'
import { useAuthSession } from '@/hooks/useAuthSession'

const navigation = [
  { href: '/dashboard', label: 'Projects', icon: <LayoutDashboard className="h-4 w-4" />, exact: true },
  { href: '/my-boards', label: 'My boards', icon: <PanelsTopLeft className="h-4 w-4" />, exact: true },
]

const footerNavigation = [
  { href: '/settings', label: 'Settings', icon: <Settings className="h-4 w-4" /> },
]

function LoadingState() {
  return (
    <AppShell navigation={navigation} footerNavigation={footerNavigation} currentPath="/studio/new">
      <div role="status" aria-label="Loading room creation" className="mx-auto w-full max-w-3xl space-y-5 px-4 py-8 sm:px-6 lg:px-8">
        <span className="sr-only">Loading room creation</span>
        <Skeleton className="h-9 w-64" />
        <Card className="space-y-4"><Skeleton className="h-11 w-full" /><Skeleton className="h-24 w-full" /></Card>
      </div>
    </AppShell>
  )
}

export default function NewStudioPage() {
  const router = useRouter()
  const { status: authStatus } = useAuthSession()
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({ name: '', description: '' })
  const [error, setError] = useState('')
  const submittingRef = useRef(false)

  useEffect(() => {
    if (authStatus === 'unauthenticated') router.push('/sign-in')
  }, [authStatus, router])

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submittingRef.current) return
    const name = formData.name.trim()
    if (!name) {
      setError('Enter a room name')
      return
    }

    submittingRef.current = true
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description: formData.description.trim() || null,
          type: 'personal',
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to create room')
      const workspaceId = data.workspace?.id || data.id
      if (!workspaceId) throw new Error('Room created but no workspace ID was returned')
      router.push(`/workspace/${workspaceId}`)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Failed to create room')
    } finally {
      submittingRef.current = false
      setLoading(false)
    }
  }

  if (authStatus === 'loading') return <LoadingState />

  return (
    <AppShell navigation={navigation} footerNavigation={footerNavigation} currentPath="/studio/new">
      <PageHeader
        eyebrow="Personal studio"
        title="Create a personal room"
        description="Set up a private 3D space for boards, models, and portfolio work."
      />
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
        <Card className="p-5 sm:p-7">
          <form onSubmit={handleSubmit} className="space-y-6" noValidate>
            <div>
              <label htmlFor="room-name" className="mb-1.5 block text-sm font-semibold text-text-primary">Room name</label>
              <Input
                id="room-name"
                value={formData.name}
                onChange={(event) => {
                  setFormData((current) => ({ ...current, name: event.target.value }))
                  if (error === 'Enter a room name') setError('')
                }}
                maxLength={100}
                placeholder="e.g. Thesis experiments"
                disabled={loading}
                aria-invalid={error === 'Enter a room name'}
                aria-describedby={error === 'Enter a room name' ? 'room-name-help room-form-error' : 'room-name-help'}
              />
              <p id="room-name-help" className="mt-1.5 text-sm text-text-secondary">Choose a clear name for your personal studio.</p>
            </div>

            <div>
              <label htmlFor="room-description" className="mb-1.5 block text-sm font-semibold text-text-primary">Description (optional)</label>
              <textarea
                id="room-description"
                value={formData.description}
                onChange={(event) => setFormData((current) => ({ ...current, description: event.target.value }))}
                rows={4}
                maxLength={500}
                disabled={loading}
                placeholder="Describe what this room is for…"
                className="min-h-28 w-full resize-y rounded-pinspace border border-border bg-background-light px-3.5 py-2 text-text-primary placeholder:text-text-dim hover:border-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:bg-background-lighter"
              />
            </div>

            <div className="rounded-pinspace border border-border bg-primary-muted p-4 text-sm text-text-primary">
              <p className="font-semibold">What happens next?</p>
              <p className="mt-1 text-text-secondary">We create the workspace and its first room, then take you to the room list so you can review the setup before entering the studio.</p>
            </div>

            {error && <StatusState id="room-form-error" status="error" title={error} />}

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Link href="/dashboard" className="inline-flex min-h-11 items-center justify-center rounded-pinspace px-4 py-2 text-sm font-semibold text-text-primary hover:bg-background-lighter focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Cancel</Link>
              <Button type="submit" size="lg" loading={loading} aria-label={loading ? 'Creating room' : 'Create room'}>
                {loading ? 'Creating room…' : 'Create room'}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </AppShell>
  )
}
