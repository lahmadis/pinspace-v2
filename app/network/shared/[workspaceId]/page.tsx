'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import NetworkRouteShell from '@/components/discovery/NetworkRouteShell'
import { type BubbleNode } from '@/components/network/BubbleNetwork'
import { StatusState } from '@/components/ui'
import { useAuthSession } from '@/hooks/useAuthSession'

interface SharedRoom { id: string; name: string; boardCount: number }
interface WorkspaceData { id: string; name: string }
type LoadState = 'loading' | 'ok' | 'not-found' | 'error'

function SharedWorkspaceNetworkInner() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const router = useRouter()
  const { status: authStatus } = useAuthSession()
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null)
  const [nodes, setNodes] = useState<BubbleNode[]>([])
  const [loadState, setLoadState] = useState<LoadState>('loading')

  useEffect(() => { if (authStatus === 'unauthenticated') router.push('/sign-in') }, [authStatus, router])
  const load = useCallback(async () => {
    if (authStatus !== 'authenticated' || !workspaceId) return
    await Promise.resolve()
    setLoadState('loading')
    try {
      const response = await fetch(`/api/network/shared/${workspaceId}`, { cache: 'no-store' })
      if (response.status === 404) { setLoadState('not-found'); return }
      if (!response.ok) throw new Error('Shared workspace network request failed')
      const data = await response.json()
      setWorkspace(data.workspace as WorkspaceData)
      const rooms: SharedRoom[] = data.rooms ?? []
      setNodes(rooms.map((room) => ({ id: room.id, name: room.name, label: room.name, count: room.boardCount, url: `/studio/${room.id}/view`, color: 'rgb(var(--color-primary))' })))
      setLoadState('ok')
    } catch (error) { console.error(error); setLoadState('error') }
  }, [authStatus, workspaceId])
  // The effect starts an external request; loading state is part of that request lifecycle.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])

  return <NetworkRouteShell title={workspace?.name ?? 'Shared workspace network'} eyebrow="Shared workspace" countLabel={nodes.length === 1 ? 'studio' : 'studios'} backHref="/network/shared" backLabel="Shared network" nodes={nodes} loadState={authStatus === 'loading' ? 'loading' : loadState} loadingTitle="Loading shared workspace" errorTitle="Could not load this shared workspace" errorDescription="We had trouble loading this workspace. Try again." notFoundTitle="This shared network is unavailable" notFoundDescription="We could not find this shared workspace or you do not have access." emptyTitle="No studios here yet" emptyDescription="Add rooms to this workspace and they will appear in the network." emptyAction={<Link href={`/workspace/${workspaceId}`} className="inline-flex min-h-11 items-center rounded-pinspace border border-pinspace-ink bg-primary px-4 py-2 font-semibold text-pinspace-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Add rooms</Link>} headerAction={workspace && <Link href={`/workspace/${workspaceId}`} className="inline-flex min-h-11 items-center rounded-pinspace border border-white/25 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">Manage rooms</Link>} onRetry={() => void load()} onNodeClick={(node) => { if (node.url) router.push(node.url) }} />
}

export default function SharedWorkspaceNetworkPage() {
  return <Suspense fallback={<main className="flex min-h-screen items-center justify-center bg-pinspace-forest px-4"><StatusState status="loading" title="Loading shared workspace" /></main>}><SharedWorkspaceNetworkInner /></Suspense>
}
