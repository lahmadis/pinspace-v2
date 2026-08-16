'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { notFound, useParams } from 'next/navigation'
import { Maximize2, Minimize2, Network } from 'lucide-react'
import BubbleNetwork, { type BubbleNode } from '@/components/network/BubbleNetwork'
import { Button, Card, EmptyState, StatusState } from '@/components/ui'

const DEPARTMENTS: Record<string, string> = {
  'aerospace-engineering': 'Aerospace Engineering', architecture: 'Architecture',
  'civil-engineering': 'Civil Engineering', 'electrical-engineering': 'Electrical Engineering',
  'industrial-design': 'Industrial Design', 'interior-design': 'Interior Design',
  'mechanical-engineering': 'Mechanical Engineering', 'robotics-engineering': 'Robotics Engineering',
}
const YEARS: Record<string, { label: string; number: number | 'Masters' }> = {
  'year-1': { label: 'Year 1', number: 1 }, 'year-2': { label: 'Year 2', number: 2 },
  'year-3': { label: 'Year 3', number: 3 }, 'year-4': { label: 'Year 4', number: 4 },
  masters: { label: 'Masters', number: 'Masters' },
}

type LoadState = 'loading' | 'ok' | 'error'

export default function YearPage() {
  const params = useParams<{ department: string; year: string }>()
  const departmentName = DEPARTMENTS[params.department]
  const year = YEARS[params.year]
  const [nodes, setNodes] = useState<BubbleNode[]>([])
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [isFullScreen, setIsFullScreen] = useState(false)

  const loadStudios = useCallback(async () => {
    if (!departmentName || !year) return
    await Promise.resolve()
    setLoadState('loading')
    try {
      const response = await fetch(`/api/workspaces/public?department=${encodeURIComponent(departmentName)}&year=${encodeURIComponent(year.label)}`, { cache: 'no-store' })
      if (!response.ok) throw new Error('Programme year request failed')
      const data = await response.json()
      const studios: { id: string; name: string; memberCount?: number; members?: unknown[]; studioId?: string; instructor?: string; semester?: string }[] = data.workspaces || []
      setNodes(studios.map((studio) => ({ id: studio.id, name: studio.name, label: studio.name, count: studio.memberCount ?? studio.members?.length ?? 0, memberCount: studio.memberCount ?? studio.members?.length ?? 0, url: `/studio/${studio.studioId || studio.id}/view`, color: 'rgb(var(--color-primary))', radius: 65, instructor: studio.instructor, semester: studio.semester, year: year.number })))
      setLoadState('ok')
    } catch (error) { console.error(error); setLoadState('error') }
  }, [departmentName, year])
  // The effect starts an external request; loading state is part of that request lifecycle.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadStudios() }, [loadStudios])

  if (!departmentName || !year) return notFound()
  const openNode = (node: BubbleNode) => { if (node.url) window.location.href = node.url }

  if (isFullScreen) {
    return (
      <div className="min-h-screen overflow-hidden bg-pinspace-forest text-white">
        <header className="fixed inset-x-0 top-0 z-40 flex min-h-20 flex-wrap items-center gap-3 border-b border-white/15 bg-pinspace-forest/95 px-4 py-3 backdrop-blur-md sm:px-6">
          <Button type="button" variant="ghost" className="border-white/20 text-white hover:bg-white/10" onClick={() => setIsFullScreen(false)}><Minimize2 className="h-4 w-4" aria-hidden="true" />Exit full screen</Button>
          <div className="min-w-0 border-l border-white/20 pl-4"><h1 className="break-words text-xl font-bold">{departmentName} · {year.label}</h1><p className="text-xs text-white/70">{nodes.length} {nodes.length === 1 ? 'studio' : 'studios'}</p></div>
        </header>
        <BubbleNetwork nodes={nodes} onNodeClick={openNode} fullScreen headerHeight={80} />
      </div>
    )
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-text-primary">
      <header className="border-b border-border bg-background-light">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
          <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm"><Link href="/explore" className="min-h-11 content-center rounded-pinspace px-2 font-semibold text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Explore</Link><span aria-hidden="true">/</span><Link href={`/explore/${params.department}`} className="min-h-11 content-center rounded-pinspace px-2 font-semibold text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">{departmentName}</Link><span aria-hidden="true">/</span><span>{year.label}</span></nav>
          <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div><p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-accent">Programme year</p><h1 className="mt-1 break-words text-3xl font-black sm:text-5xl">{departmentName} · {year.label}</h1><p className="mt-2 text-text-secondary">{nodes.length} {nodes.length === 1 ? 'published studio' : 'published studios'}</p></div>
            <div className="flex flex-wrap gap-3">
              <Link href="/my-boards" className="inline-flex min-h-11 items-center rounded-pinspace border border-border bg-background px-4 py-2 text-sm font-semibold text-accent hover:bg-background-lighter focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">My boards</Link>
              <Button type="button" variant="secondary" onClick={() => setIsFullScreen(true)} disabled={loadState !== 'ok' || nodes.length === 0}><Maximize2 className="h-4 w-4" aria-hidden="true" />Full screen</Button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <section aria-label={`${departmentName} ${year.label} studio network`} className="min-h-[34rem] overflow-hidden rounded-pinspace-lg border border-border bg-pinspace-forest sm:min-h-[40rem]">
          {loadState === 'loading' ? <div className="flex min-h-[34rem] items-center justify-center p-4"><StatusState status="loading" title="Loading studios" /></div>
            : loadState === 'error' ? <div className="flex min-h-[34rem] items-center justify-center p-4"><StatusState status="error" title="Could not load studios" description="Try the request again." action={<Button type="button" onClick={() => void loadStudios()}>Try again</Button>} className="w-full max-w-lg" /></div>
              : nodes.length === 0 ? <div className="flex min-h-[34rem] items-center justify-center p-4"><EmptyState title="No studios published yet" description={`There are no published ${year.label} ${departmentName} studios.`} icon={<Network className="h-8 w-8" aria-hidden="true" />} className="w-full max-w-lg" /></div>
                : <BubbleNetwork nodes={nodes} onNodeClick={openNode} />}
        </section>
        <aside><Card><p className="font-mono text-xs uppercase tracking-[0.16em] text-accent">Network summary</p><h2 className="mt-2 text-xl font-bold">{year.label}</h2><dl className="mt-4 flex justify-between gap-4 text-sm"><dt>Studios</dt><dd className="font-bold">{nodes.length}</dd></dl><p className="mt-4 text-sm text-text-secondary">The directory in the network includes names and metadata so discovery never depends on colour or position alone.</p></Card></aside>
      </main>
    </div>
  )
}
