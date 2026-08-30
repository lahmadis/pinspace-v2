'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import BubbleNetwork, { BubbleNode } from '@/components/network/BubbleNetwork'
import { useAuthSession } from '@/hooks/useAuthSession'

interface PersonalWorkspace {
  id: string
  name: string
  subRoomCount: number
  createdAt: string
  /** Derived server-side: the space has a member besides its owner. */
  shared: boolean
}

/**
 * Which slice of your spaces the map is showing.
 *
 * A filter over one set, not three separate networks: a shared space IS a
 * personal space that someone else is in, so 'all' is the honest default and
 * the other two are ways to narrow it. This is the tab that replaced the
 * dashboard's Shared scope — the distinction was worth keeping, the separate
 * place to keep it was not.
 */
type NetworkFilter = 'all' | 'personal' | 'shared'

function PersonalNetworkInner() {
  const router = useRouter()
  const { status: authStatus } = useAuthSession()
  const [workspaces, setWorkspaces] = useState<PersonalWorkspace[]>([])
  const [hasWorkspaces, setHasWorkspaces] = useState(true)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<NetworkFilter>('all')

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
        const res = await fetch('/api/network/personal', { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json()
        const rows: PersonalWorkspace[] = data.workspaces ?? []
        setHasWorkspaces(rows.length > 0)
        setWorkspaces(rows)
      } catch (e) {
        console.error(e)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [authStatus])

  const counts = {
    all: workspaces.length,
    personal: workspaces.filter((w) => !w.shared).length,
    shared: workspaces.filter((w) => w.shared).length,
  }

  const nodes: BubbleNode[] = workspaces
    .filter((w) => filter === 'all' || (filter === 'shared' ? w.shared : !w.shared))
    .map((w) => ({
      id: w.id,
      name: w.name,
      label: w.name,
      count: w.subRoomCount,
      url: `/network/${w.id}`,
      // Shared spaces read in the accent blue the rest of the app uses for
      // "someone else is here"; solo spaces keep the neutral indigo. The tab
      // narrows the set, this tells them apart inside 'all'.
      color: w.shared ? '#3B6EF6' : '#6366f1',
    }))

  const handleNodeClick = (node: BubbleNode) => {
    router.push(`/network/${node.id}`)
  }

  if (authStatus === 'loading' || loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-[#3B6EF6]/20 border-t-[#3B6EF6]" />
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
            <h1 className="text-lg font-semibold text-white">Your network</h1>
            <p className="text-xs text-slate-400">
              {nodes.length} {nodes.length === 1 ? 'space' : 'spaces'}
            </p>
          </div>

          {/* Personal / Shared. Only rendered once something IS shared —
              before that it is three tabs over one set, which teaches a
              distinction the account has not met yet. */}
          {counts.shared > 0 && (
            <nav aria-label="Filter spaces" className="ml-auto flex items-center gap-1 shrink-0">
              {([
                ['all', 'All'],
                ['personal', 'Personal'],
                ['shared', 'Shared'],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  aria-current={filter === key ? 'page' : undefined}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                    filter === key
                      ? 'bg-[#3B6EF6] text-white'
                      : 'text-slate-300 hover:bg-slate-700/60'
                  }`}
                >
                  {label}
                  <span className={`ml-1.5 ${filter === key ? 'text-white/70' : 'text-slate-500'}`}>
                    {counts[key]}
                  </span>
                </button>
              ))}
            </nav>
          )}
        </div>
      </header>

      {!hasWorkspaces ? (
        <div className="min-h-screen flex items-center justify-center px-6">
          <div className="text-center max-w-sm">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-800 mb-4">
              <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-white mb-2">No spaces yet</h2>
            <p className="text-slate-400 text-sm mb-6">
              You haven&apos;t created any personal spaces yet. Create your first space to see it here.
            </p>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#3B6EF6] text-white rounded-full hover:bg-[#16181D] transition-colors font-semibold text-sm"
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

export default function PersonalNetworkPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-900 flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-[#3B6EF6]/20 border-t-[#3B6EF6]" />
        </div>
      }
    >
      <PersonalNetworkInner />
    </Suspense>
  )
}
