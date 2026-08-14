'use client'

import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js'

import { Button, Card, StatusState } from '@/components/ui'
import { supabase } from '@/lib/supabase/client'
import { toast } from '@/lib/toast'

interface WorkspaceInfo {
  id: string
  name: string
  inviteCode: string
  memberCount: number
  institutionSlug?: string
}

export default function JoinWorkspacePage() {
  const params = useParams()
  const router = useRouter()
  const inviteCode = params.code as string
  const [user, setUser] = useState<User | null>(null)
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)
  // The ref guards the membership-creating POST against same-tick activation.
  // The server still owns membership deduplication and permission enforcement.
  const joiningRef = useRef(false)
  const [error, setError] = useState('')
  const [joinError, setJoinError] = useState('')
  const [profileFullName, setProfileFullName] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }: { data: { session: Session | null } }) => {
      setUser(session?.user || null)
    }).catch(() => {
      setUser(null)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      setUser(session?.user || null)
    })

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    const fetchWorkspaceInfo = async () => {
      try {
        const response = await fetch(`/api/workspaces/by-invite/${inviteCode}`)
        if (!response.ok) {
          setError('Invitation unavailable')
          return
        }
        const data = await response.json()
        setWorkspace(data.workspace)
      } catch (loadError) {
        console.error('Error:', loadError)
        setError('Invitation unavailable')
      } finally {
        setLoading(false)
      }
    }
    void fetchWorkspaceInfo()
  }, [inviteCode])

  useEffect(() => {
    if (!user?.id) return
    fetch('/api/user-profile', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        const fullName = typeof data?.full_name === 'string' ? data.full_name.trim() : ''
        setProfileFullName(fullName || null)
      })
      .catch(() => setProfileFullName(null))
  }, [user?.id])

  const profileFirstName = profileFullName ? profileFullName.split(/\s+/)[0] : null

  const handleJoin = async () => {
    if (!user || !workspace || joiningRef.current) return

    try {
      joiningRef.current = true
      setJoining(true)
      setJoinError('')
      const response = await fetch(`/api/workspaces/${workspace.id}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inviteCode,
          userName: profileFullName || user.user_metadata?.full_name || user.email?.split('@')[0] || 'Student',
        }),
      })
      await response.json().catch(() => ({}))
      if (!response.ok) throw new Error('Could not join workspace. Check the invitation and try again.')

      // Keep the established post-join destination: the workspace room list.
      router.push(`/workspace/${workspace.id}`)
    } catch (joinFailure) {
      console.error('Error:', joinFailure)
      const message = joinFailure instanceof Error ? joinFailure.message : 'Failed to join workspace'
      setJoinError(message)
      toast.error(message)
    } finally {
      joiningRef.current = false
      setJoining(false)
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
        <StatusState status="loading" title="Loading invitation" description="Checking this workspace invitation." className="w-full max-w-md" />
      </main>
    )
  }

  if (error || !workspace) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
        <StatusState
          status="error"
          title="Invitation unavailable"
          description="This invitation is invalid, expired, or no longer available. Ask the workspace owner for a new link."
          action={(
            <Link
              href="/dashboard"
              className="inline-flex min-h-11 items-center justify-center rounded-kova border border-kova-ink bg-primary px-4 py-2 text-sm font-semibold text-kova-ink shadow-[0_3px_0_rgb(var(--color-ink))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            >
              Go to dashboard
            </Link>
          )}
          className="w-full max-w-md"
        />
      </main>
    )
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10 sm:px-6">
      <Card className="w-full max-w-lg p-6 sm:p-8">
        <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-accent">Workspace invitation</p>
        <h1 className="mt-2 break-words text-3xl font-black tracking-tight text-text-primary sm:text-4xl">
          Join {workspace.name}
        </h1>
        <p className="mt-3 text-text-secondary">Collaborate in the shared studio and add your work after joining.</p>

        <div className="my-6 rounded-kova border border-border bg-background-lighter p-4">
          <p className="font-semibold text-text-primary">{workspace.memberCount} member{workspace.memberCount !== 1 ? 's' : ''}</p>
          <p className="mt-1 text-sm text-text-secondary">Membership is tied to your signed-in account.</p>
        </div>

        {user ? (
          <div className="space-y-4">
            <p className="rounded-kova border border-border bg-primary-muted p-4 text-sm text-text-primary">
              Signed in as <strong>{profileFirstName || user.email?.split('@')[0] || 'User'}</strong>
            </p>
            {joinError && <StatusState status="error" title={joinError} className="p-3 text-sm" />}
            <Button type="button" onClick={handleJoin} loading={joining} className="w-full">
              {joining ? 'Joining workspace' : 'Join workspace'}
            </Button>
            <p className="text-center text-xs text-text-muted">You&apos;ll be taken to the workspace room list after joining.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <StatusState status="info" title="Sign in before joining" description="We’ll bring you back to this invitation after sign in." />
            <Link
              href={workspace.institutionSlug ? `/sign-in?institution=${workspace.institutionSlug}&redirect=/join/${inviteCode}` : `/sign-in?redirect=/join/${inviteCode}`}
              className="inline-flex min-h-12 w-full items-center justify-center rounded-kova border border-kova-ink bg-primary px-5 py-2.5 font-semibold text-kova-ink shadow-[0_3px_0_rgb(var(--color-ink))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            >
              Sign in to join
            </Link>
            <p className="text-center text-sm text-text-secondary">
              Don&apos;t have an account?{' '}
              <Link
                href={workspace.institutionSlug ? `/sign-up?institution=${workspace.institutionSlug}&redirect=/join/${inviteCode}` : `/sign-up?redirect=/join/${inviteCode}`}
                className="font-semibold text-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Sign up
              </Link>
            </p>
          </div>
        )}
      </Card>
    </main>
  )
}
