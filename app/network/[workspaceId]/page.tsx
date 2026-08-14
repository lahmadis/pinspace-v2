'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import BubbleNetwork, { BubbleNode } from '@/components/network/BubbleNetwork'
import { useAuthSession } from '@/hooks/useAuthSession'

interface PersonalRoom {
  id: string
  name: string
  boardCount: number
}

interface WorkspaceData {
  id: string
  name: string
}

type LoadState = 'loading' | 'ok' | 'not-found' | 'error'

function WorkspaceNetworkInner() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const router = useRouter()
  const { status: authStatus } = useAuthSession()
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null)
  const [nodes, setNodes] = useState<BubbleNode[]>([])
  const [loadState, setLoadState] = useState<LoadState>('loading')

  const headerRef = useRef<HTMLElement>(null)
  const [headerHeight, setHeaderHeight] = useState(57)

  useEffect(() => {
    if (authStatus === 'unauthenticated') router.push('/sign-in')
  }, [authStatus, router])

  useEffect(() => {
    const el = headerRef.current
    if (!el) return
    const update = () => setHeaderHeight(el.offsetHeight)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (authStatus !== 'authenticated' || !workspaceId) return
    const load = async () => {
      try {
        const res = await fetch(`/api/network/personal/${workspaceId}`, { cache: 'no-store' })
        if (res.status === 404) { setLoadState('not-found'); return }
        if (!res.ok) { setLoadState('error'); return }
        const data = await res.json()
        setWorkspace(data.workspace as WorkspaceData)
        const rooms: PersonalRoom[] = data.rooms ?? []
        setNodes(
          rooms.map((r) => ({
            id: r.id,
            name: r.name,
            label: r.name,
            count: r.boardCount,
            url: `/studio/${r.id}/view`,
            color: '#6366f1',
          }))
        )
        setLoadState('ok')
      } catch (e) {
        console.error(e)
        setLoadState('error')
      }
    }
    load()
  }, [authStatus, workspaceId])

  const handleNodeClick = (node: BubbleNode) => {
    if (node.url) router.push(node.url)
  }

  if (authStatus === 'loading' || loadState === 'loading') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-600/20 border-t-indigo-600" />
      </div>
    )
  }

  if (loadState === 'not-found' || loadState === 'error') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center px-6">
        <div className="text-center max-w-sm">
          <h2 className="text-xl font-semibold text-white mb-2">
            {loadState === 'not-found'
              ? "This network doesn't exist or isn't yours"
              : 'Something went wrong'}
          </h2>
          <p className="text-slate-400 text-sm mb-6">
            {loadState === 'not-found'
              ? "We couldn't find this room or you don't have access to it."
              : 'We had trouble loading this workspace. Try again.'}
          </p>
          <Link
            href="/network"
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium text-sm"
          >
            ← Back to your network
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-900">
      <header
        ref={headerRef}
        className="fixed top-0 left-0 right-0 z-40 border-b border-slate-700/50 bg-slate-900/90 backdrop-blur-md"
      >
        <div className="max-w-full px-4 md:px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <Link
              href="/network"
              className="flex items-center gap-2 text-slate-300 hover:text-white transition-colors text-sm shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
              Your network
            </Link>
            <div className="h-5 w-px bg-slate-600 shrink-0" />
            <div className="min-w-0">
              <h1 className="text-lg font-semibold text-white truncate">{workspace?.name ?? '…'}</h1>
              <p className="text-xs text-slate-400">
                {nodes.length} {nodes.length === 1 ? 'studio' : 'studios'}
              </p>
            </div>
          </div>
          {workspace && (
            <Link
              href={`/workspace/${workspaceId}`}
              className="text-sm px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-800 transition-colors shrink-0"
            >
              Manage rooms
            </Link>
          )}
        </div>
      </header>

      {nodes.length === 0 ? (
        <div className="min-h-screen flex items-center justify-center px-6">
          <div className="text-center max-w-sm">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-800 mb-4">
              <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-white mb-2">No studios here yet</h2>
            <p className="text-slate-400 text-sm mb-6">
              Add rooms to this workspace and they&apos;ll appear as bubbles in the network.
            </p>
            <Link
              href={`/workspace/${workspaceId}`}
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium text-sm"
            >
              Add rooms
            </Link>
          </div>
        </div>
      ) : (
        <BubbleNetwork
          nodes={nodes}
          onNodeClick={handleNodeClick}
          fullScreen
          headerHeight={headerHeight}
        />
      )}
    </div>
  )
}

export default function WorkspaceNetworkPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-900 flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-600/20 border-t-indigo-600" />
        </div>
      }
    >
      <WorkspaceNetworkInner />
    </Suspense>
  )
}
