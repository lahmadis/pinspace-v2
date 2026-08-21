'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { useRouter } from 'next/navigation'

import { Button, Card, Input, Skeleton, StatusState } from '@/components/ui'
import { useAuthSession } from '@/hooks/useAuthSession'

function LoadingState() {
  return (
    <div role="status" aria-label="Loading space creation" className="min-h-dvh w-full bg-background text-text-primary animate-fade-in">
      <header className="border-b border-border bg-background-light py-5">
        <div className="mx-auto w-full max-w-[96rem] px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-pinspace shrink-0" />
            <div className="space-y-1.5 min-w-0">
              <Skeleton className="h-4 w-24 rounded" />
              <Skeleton className="h-8 w-64 rounded-pinspace" />
            </div>
          </div>
        </div>
      </header>
      <div className="mx-auto w-full max-w-[96rem] space-y-5 px-4 py-8 sm:px-6 lg:px-8">
        <span className="sr-only">Loading space creation</span>
        <Card className="max-w-3xl space-y-4 p-5 sm:p-7"><Skeleton className="h-11 w-full" /><Skeleton className="h-24 w-full" /></Card>
      </div>
    </div>
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
      setError('Enter a space name')
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
      if (!response.ok) throw new Error(data.error || 'Failed to create space')
      const workspaceId = data.workspace?.id || data.id
      if (!workspaceId) throw new Error('Space created but no workspace ID was returned')
      router.push(`/workspace/${workspaceId}`)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Failed to create space')
    } finally {
      submittingRef.current = false
      setLoading(false)
    }
  }

  if (authStatus === 'loading') return <LoadingState />

  return (
    <div className="min-h-dvh w-full bg-background text-text-primary">
      <header className="border-b border-border bg-background-light py-5">
        <div className="mx-auto w-full max-w-[96rem] px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              aria-label="Back to projects"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-pinspace border border-border bg-background-light text-text-secondary shadow-xs transition-colors hover:bg-background-lighter hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <ArrowLeft className="h-5 w-5" aria-hidden="true" />
            </Link>
            <div className="min-w-0">
              <span className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-text-secondary">
                Personal studio
              </span>
              <h1 className="break-words text-2xl font-bold tracking-tight text-text-primary sm:text-3xl">
                Create a personal space
              </h1>
            </div>
          </div>
          <p className="mt-2 text-sm text-text-secondary">
            Set up a private 3D studio for boards, models, and portfolio work.
          </p>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[96rem] px-4 py-6 sm:px-6 lg:px-8">
        <Card className="max-w-3xl p-5 sm:p-7">
          <form onSubmit={handleSubmit} className="space-y-6" noValidate>
            <div>
              <label htmlFor="room-name" className="mb-1.5 block text-sm font-semibold text-text-primary">Space name</label>
              <Input
                id="room-name"
                value={formData.name}
                onChange={(event) => {
                  setFormData((current) => ({ ...current, name: event.target.value }))
                  if (error === 'Enter a space name' || error === 'Enter a room name') setError('')
                }}
                maxLength={100}
                placeholder="e.g. Thesis experiments"
                disabled={loading}
                aria-invalid={error === 'Enter a space name' || error === 'Enter a room name'}
                aria-describedby={error === 'Enter a space name' || error === 'Enter a room name' ? 'room-name-help room-form-error' : 'room-name-help'}
              />
              <p id="room-name-help" className="mt-1.5 text-sm text-text-secondary">Choose a clear name for your personal space.</p>
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
                placeholder="Describe what this space is for…"
                className="min-h-28 w-full resize-y rounded-pinspace border border-border bg-background-light px-3.5 py-2 text-text-primary placeholder:text-text-dim hover:border-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:bg-background-lighter"
              />
            </div>

            <div className="rounded-pinspace border border-border bg-primary-muted p-4 text-sm text-text-primary">
              <p className="font-semibold">What happens next?</p>
              <p className="mt-1 text-text-secondary">We create the workspace and its first space, then take you to the space list so you can review the setup before entering the 3D studio.</p>
            </div>

            {error && <StatusState id="room-form-error" status="error" title={error} />}

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Link href="/dashboard" className="inline-flex min-h-11 items-center justify-center rounded-pinspace px-4 py-2 text-sm font-semibold text-text-primary hover:bg-background-lighter focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Cancel</Link>
              <Button type="submit" size="lg" loading={loading} aria-label={loading ? 'Creating space' : 'Create space'}>
                {loading ? 'Creating space…' : 'Create space'}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  )
}
