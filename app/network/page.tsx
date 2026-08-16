'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { BubbleNode } from '@/components/network/BubbleNetwork'
import NetworkRouteShell from '@/components/discovery/NetworkRouteShell'
import { StatusState } from '@/components/ui'
import { useAuthSession } from '@/hooks/useAuthSession'

interface PersonalWorkspace {
  id: string
  name: string
  subRoomCount: number
  createdAt: string
}

type LoadState = 'loading' | 'ok' | 'error'

function PersonalNetworkInner() {
  const router = useRouter()
  const { status: authStatus } = useAuthSession()
  const [nodes, setNodes] = useState<BubbleNode[]>([])
  const [loadState, setLoadState] = useState<LoadState>('loading')

  useEffect(() => {
    if (authStatus === 'unauthenticated') router.push('/sign-in')
  }, [authStatus, router])

  const load = useCallback(async () => {
    if (authStatus !== 'authenticated') return
    await Promise.resolve()
    setLoadState('loading')
    try {
      const res = await fetch('/api/network/personal', { cache: 'no-store' })
      if (!res.ok) throw new Error('Network request failed')
      const data = await res.json()
      const workspaces: PersonalWorkspace[] = data.workspaces ?? []
      setNodes(workspaces.map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        label: workspace.name,
        count: workspace.subRoomCount,
        url: `/network/${workspace.id}`,
        color: 'rgb(var(--color-primary))',
      })))
      setLoadState('ok')
    } catch (error) {
      console.error(error)
      setLoadState('error')
    }
  }, [authStatus])

  // The effect starts an external request; loading state is part of that request lifecycle.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])

  return (
    <NetworkRouteShell
      title="Your network" eyebrow="Personal discovery" countLabel={nodes.length === 1 ? 'room' : 'rooms'}
      backHref="/dashboard" backLabel="Dashboard" nodes={nodes}
      loadState={authStatus === 'loading' ? 'loading' : loadState}
      loadingTitle="Loading your network" errorTitle="Could not load your network" errorDescription="Check your connection and try again."
      emptyTitle="No rooms yet" emptyDescription="Create your first room to see it mapped here."
      emptyAction={<Link href="/dashboard" className="inline-flex min-h-11 items-center rounded-pinspace border border-pinspace-ink bg-primary px-4 py-2 font-semibold text-pinspace-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Go to dashboard</Link>}
      onRetry={() => void load()} onNodeClick={(node) => router.push(`/network/${node.id}`)}
    />
  )
}

function LoadingNetwork() {
  return <main className="flex min-h-screen items-center justify-center bg-pinspace-forest px-4"><StatusState status="loading" title="Loading your network" /></main>
}

export default function PersonalNetworkPage() {
  return <Suspense fallback={<LoadingNetwork />}><PersonalNetworkInner /></Suspense>
}
