'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import BubbleNetwork, { BubbleNode } from '@/components/network/BubbleNetwork'
import { useAuthSession } from '@/hooks/useAuthSession'

interface SharedWorkspace {
  id: string
  name: string
  subRoomCount: number
  createdAt: string
}

function SharedNetworkInner() {
  const router = useRouter()
  const { status: authStatus } = useAuthSession()
  const [nodes, setNodes] = useState<BubbleNode[]>([])
  const [hasWorkspaces, setHasWorkspaces] = useState(true)
  const [loading, setLoading] = useState(true)

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
    if (authStatus !== 'authenticated') return
    const load = async () => {
      try {
        const res = await fetch('/api/network/shared', { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json()
        const workspaces: SharedWorkspace[] = data.workspaces ?? []
        setHasWorkspaces(workspaces.length > 0)
        setNodes(
          workspaces.map((w) => ({
            id: w.id,
            name: w.name,
            label: w.name,
            count: w.subRoomCount,
            url: `/network/shared/${w.id}`,
            color: '#6366f1',
          }))
        )
      } catch (e) {
        console.error(e)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [authStatus])

  const handleNodeClick = (node: BubbleNode) => {
    router.push(`/network/shared/${node.id}`)
  }

  if (authStatus === 'loading' || loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-600/20 border-t-indigo-600" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-900">
      <header
        ref={headerRef}
        className="fixed top-0 left-0 right-0 z-40 border-b border-slate-700/50 bg-slate-900/90 backdrop-blur-md"
      >
        <div className="max-w-full px-4 md:px-6 py-3 flex items-center gap-4">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 text-slate-300 hover:text-white transition-colors text-sm shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            Dashboard
          </Link>
          <div className="h-5 w-px bg-slate-600 shrink-0" />
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-white">Your shared network</h1>
            <p className="text-xs text-slate-400">
              {nodes.length} {nodes.length === 1 ? 'room' : 'rooms'}
            </p>
          </div>
        </div>
      </header>

      {!hasWorkspaces ? (
        <div className="min-h-screen flex items-center justify-center px-6">
          <div className="text-center max-w-sm">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-800 mb-4">
              <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-white mb-2">No shared rooms yet</h2>
            <p className="text-slate-400 text-sm mb-6">
              You haven&apos;t joined or created any shared rooms yet.
            </p>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium text-sm"
            >
              Go to dashboard
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

export default function SharedNetworkPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-900 flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-600/20 border-t-indigo-600" />
        </div>
      }
    >
      <SharedNetworkInner />
    </Suspense>
  )
}
