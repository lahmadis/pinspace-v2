'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import NetworkRouteShell from '@/components/discovery/NetworkRouteShell'
import { type BubbleNode } from '@/components/network/BubbleNetwork'
import { StatusState } from '@/components/ui'
import { useAuthSession } from '@/hooks/useAuthSession'

interface SharedWorkspace { id: string; name: string; subRoomCount: number; createdAt: string }

function SharedNetworkInner() {
  const router = useRouter()
  const { status: authStatus } = useAuthSession()
  const [nodes, setNodes] = useState<BubbleNode[]>([])
  const [loadState, setLoadState] = useState<'loading' | 'ok' | 'error'>('loading')

  useEffect(() => { if (authStatus === 'unauthenticated') router.push('/sign-in') }, [authStatus, router])
  const load = useCallback(async () => {
    if (authStatus !== 'authenticated') return
    await Promise.resolve()
    setLoadState('loading')
    try {
      const response = await fetch('/api/network/shared', { cache: 'no-store' })
      if (!response.ok) throw new Error('Shared network request failed')
      const data = await response.json()
      const workspaces: SharedWorkspace[] = data.workspaces ?? []
      setNodes(workspaces.map((workspace) => ({ id: workspace.id, name: workspace.name, label: workspace.name, count: workspace.subRoomCount, url: `/network/shared/${workspace.id}`, color: 'rgb(var(--color-primary))' })))
      setLoadState('ok')
    } catch (error) { console.error(error); setLoadState('error') }
  }, [authStatus])
  // The effect starts an external request; loading state is part of that request lifecycle.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])

  return <NetworkRouteShell title="Your shared network" eyebrow="Shared discovery" countLabel={nodes.length === 1 ? 'space' : 'spaces'} backHref="/dashboard" backLabel="Dashboard" nodes={nodes} loadState={authStatus === 'loading' ? 'loading' : loadState} loadingTitle="Loading shared network" errorTitle="Could not load shared network" errorDescription="Check your connection and try again." emptyTitle="No shared spaces yet" emptyDescription="Spaces shared with you will appear here." emptyAction={<Link href="/dashboard" className="inline-flex min-h-11 items-center rounded-pinspace border border-pinspace-ink bg-primary px-4 py-2 font-semibold text-pinspace-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Go to dashboard</Link>} onRetry={() => void load()} onNodeClick={(node) => router.push(`/network/shared/${node.id}`)} />
}

export default function SharedNetworkPage() {
  return <Suspense fallback={<main className="flex min-h-screen items-center justify-center bg-pinspace-forest px-4"><StatusState status="loading" title="Loading shared network" /></main>}><SharedNetworkInner /></Suspense>
}
