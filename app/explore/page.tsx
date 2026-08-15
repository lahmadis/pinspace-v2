'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Network } from 'lucide-react'
import BubbleNetwork, { BubbleNode } from '@/components/network/BubbleNetwork'
import DemoBanner from '@/components/DemoBanner'
import { Button, EmptyState, Input, Select, StatusState } from '@/components/ui'
import { prefetchStudioView } from '@/lib/studioViewCache'

type StudioResponse = {
  studios: BubbleNode[]
  totals: { studios: number; students: number }
  hasOrg?: boolean
}

type ViewMode = 'flat' | 'hierarchy'
type HierarchyLevel = 'years' | 'departments' | 'studios'
type LoadState = 'loading' | 'ok' | 'error'

function prefetchNodeView(node: BubbleNode, isDemo: boolean): void {
  const roomId = node.publishedRooms?.[0]?.id ?? node.id
  const workspaceId = node.workspaceId ?? node.id
  void prefetchStudioView(roomId, isDemo, workspaceId)
}

function ExplorePageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [nodes, setNodes] = useState<BubbleNode[]>([])
  const [totals, setTotals] = useState({ studios: 0, students: 0 })
  const [hasOrg, setHasOrg] = useState(true)
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [viewMode, setViewMode] = useState<ViewMode>('flat')
  const [hierarchyLevel, setHierarchyLevel] = useState<HierarchyLevel>('years')
  const [selectedYear, setSelectedYear] = useState<string | number | null>(null)
  const [selectedDepartment, setSelectedDepartment] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedAcademicYear, setSelectedAcademicYear] = useState('')
  const [availableAcademicYears, setAvailableAcademicYears] = useState<{ year: string; count: number }[]>([])
  const [roomDrillWorkspace, setRoomDrillWorkspace] = useState<BubbleNode | null>(null)

  const isDemo = searchParams?.get('demo') === 'true'
  const orgParam = searchParams?.get('org') || null

  useEffect(() => {
    if (isDemo) return
    const loadAcademicYears = async () => {
      try {
        const url = orgParam ? `/api/explore/academic-years?org=${encodeURIComponent(orgParam)}` : '/api/explore/academic-years'
        const response = await fetch(url, { cache: 'no-store' })
        if (!response.ok) return
        const data = await response.json()
        const years: { year: string; count: number }[] = data.academicYears || []
        setAvailableAcademicYears(years)
        setSelectedAcademicYear(years[0]?.year ?? '')
      } catch (error) {
        console.error(error)
      }
    }
    void loadAcademicYears()
  }, [isDemo, orgParam])

  const loadStudios = useCallback(async () => {
    await Promise.resolve()
    setLoadState('loading')
    try {
      const params = new URLSearchParams()
      if (isDemo) params.set('demo', 'true')
      if (!isDemo && selectedAcademicYear) params.set('academic_year', selectedAcademicYear)
      if (orgParam) params.set('org', orgParam)
      const response = await fetch(`/api/explore/studios${params.size ? `?${params}` : ''}`, { cache: 'no-store' })
      if (!response.ok) throw new Error('Studio network request failed')
      const data: StudioResponse = await response.json()
      const studios = data.studios || []
      setNodes(studios)
      setTotals({ studios: data.totals?.studios ?? 0, students: data.totals?.students ?? 0 })
      setHasOrg(data.hasOrg !== false)
      setRoomDrillWorkspace(null)
      setLoadState('ok')
      for (const node of studios.filter((item) => item.url).slice(0, 5)) {
        prefetchNodeView(node, isDemo)
        router.prefetch(node.url!.split('?')[0])
      }
    } catch (error) {
      console.error(error)
      setLoadState('error')
    }
  }, [isDemo, orgParam, router, selectedAcademicYear])

  // The effect starts an external request; loading state is part of that request lifecycle.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadStudios() }, [loadStudios])

  const searchFilteredNodes = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return nodes
    return nodes.filter((node) => node.name?.toLowerCase().includes(query) || node.instructor?.toLowerCase().includes(query))
  }, [nodes, searchQuery])

  const displayedNodes = useMemo(() => {
    if (roomDrillWorkspace) {
      return (roomDrillWorkspace.publishedRooms ?? []).map((room) => ({
        id: room.id,
        name: room.name,
        label: room.name,
        count: room.boardCount,
        url: `/studio/${room.id}/view`,
        workspaceId: roomDrillWorkspace.workspaceId ?? roomDrillWorkspace.id,
        color: 'rgb(var(--color-primary))',
      })) as BubbleNode[]
    }
    if (viewMode === 'flat') return searchFilteredNodes
    if (hierarchyLevel === 'years') {
      return Array.from(new Set(searchFilteredNodes.map((node) => node.year ?? 'Unknown'))).map((year, index) => ({
        id: `year-${year}-${index}`, name: String(year), label: year === 'Masters' ? 'Masters' : `Year ${year}`, year,
        color: 'rgb(var(--color-primary))', radius: 70,
      })) as BubbleNode[]
    }
    if (hierarchyLevel === 'departments' && selectedYear !== null) {
      return Array.from(new Set(searchFilteredNodes.filter((node) => String(node.year ?? '') === String(selectedYear)).map((node) => node.department ?? 'Unknown'))).map((department, index) => ({
        id: `dept-${department}-${index}`, name: department, label: department, year: selectedYear, department,
        color: 'rgb(var(--color-secondary))', radius: 70,
      })) as BubbleNode[]
    }
    return searchFilteredNodes.filter((node) => (selectedYear === null || String(node.year ?? '') === String(selectedYear)) && (selectedDepartment === null || node.department === selectedDepartment))
  }, [hierarchyLevel, roomDrillWorkspace, searchFilteredNodes, selectedDepartment, selectedYear, viewMode])

  const resetToStudios = () => {
    setViewMode('flat')
    setHierarchyLevel('years')
    setSelectedYear(null)
    setSelectedDepartment(null)
    setRoomDrillWorkspace(null)
  }

  const selectNode = (node: BubbleNode) => {
    const demoParam = isDemo ? '?demo=true' : ''
    if (roomDrillWorkspace || viewMode === 'flat' || hierarchyLevel === 'studios') {
      if (!roomDrillWorkspace && node.publishedRooms && node.publishedRooms.length > 1) {
        setRoomDrillWorkspace(node)
        return
      }
      if (node.url) router.push(node.url.includes('?') && isDemo ? `${node.url}&demo=true` : `${node.url}${demoParam}`)
      return
    }
    if (hierarchyLevel === 'years') {
      setSelectedYear(node.year ?? node.label)
      setHierarchyLevel('departments')
    } else {
      setSelectedDepartment(node.department || node.label)
      setHierarchyLevel('studios')
    }
  }

  const prefetchNode = useCallback((node: BubbleNode) => {
    if (!node.url) return
    prefetchNodeView(node, isDemo)
    router.prefetch(node.url.split('?')[0])
  }, [isDemo, router])

  const emptyTitle = searchQuery.trim() ? 'No studios match your filters' : 'No studios yet'
  const emptyDescription = searchQuery.trim()
    ? 'Try a different studio name or instructor.'
    : !isDemo && !hasOrg
      ? "We couldn't find studios for your institution. Contact support if this seems wrong."
      : selectedAcademicYear
        ? `No published studios for ${selectedAcademicYear}`
        : 'No published studios found for your institution.'

  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-text-primary">
      <DemoBanner />
      <header className="border-b border-border bg-background-light">
        <div className="mx-auto flex max-w-[96rem] flex-col gap-5 px-4 py-5 sm:px-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <Link href="/" className="inline-flex min-h-11 items-center rounded-pinspace px-2 text-lg font-black hover:bg-background-lighter focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">PinSpace</Link>
              <Link href="/dashboard" className="inline-flex min-h-11 items-center rounded-pinspace px-2 text-sm font-semibold text-accent hover:bg-background-lighter focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Dashboard</Link>
            </div>
            <p className="mt-3 font-mono text-xs font-semibold uppercase tracking-[0.18em] text-accent">Institution discovery</p>
            <h1 className="mt-1 break-words text-3xl font-black tracking-tight sm:text-5xl">Studio network</h1>
            <p className="mt-2 text-sm text-text-secondary">{totals.studios} studios · {totals.students} students</p>
          </div>

          <div className="grid w-full gap-3 lg:max-w-2xl sm:grid-cols-[minmax(0,1fr)_auto]">
            <Input type="search" aria-label="Search studios by name or professor" placeholder="Search by studio name or professor…" value={searchQuery} onChange={(event) => { setSearchQuery(event.target.value); setRoomDrillWorkspace(null) }} />
            <div className="flex flex-wrap gap-2" role="group" aria-label="Network view">
              <Button type="button" variant={viewMode === 'flat' ? 'primary' : 'ghost'} aria-pressed={viewMode === 'flat'} onClick={resetToStudios}>All studios</Button>
              <Button type="button" variant={viewMode === 'hierarchy' ? 'primary' : 'ghost'} aria-pressed={viewMode === 'hierarchy'} onClick={() => { setViewMode('hierarchy'); setHierarchyLevel('years'); setSelectedYear(null); setSelectedDepartment(null); setRoomDrillWorkspace(null) }}>Browse levels</Button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[96rem] px-4 py-5 sm:px-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          {!isDemo && availableAcademicYears.length > 0 ? (
            <div className="w-full max-w-xs">
              <label htmlFor="academic-year" className="mb-2 block text-sm font-semibold">Academic year</label>
              <Select id="academic-year" value={selectedAcademicYear} onChange={(event) => { setSelectedAcademicYear(event.target.value); setRoomDrillWorkspace(null) }}>
                <option value="">All years</option>
                {availableAcademicYears.map(({ year, count }) => <option key={year} value={year}>{year} ({count})</option>)}
              </Select>
            </div>
          ) : <span />}
          {(roomDrillWorkspace || hierarchyLevel !== 'years') && (
            <Button type="button" variant="ghost" onClick={() => {
              if (roomDrillWorkspace) setRoomDrillWorkspace(null)
              else if (hierarchyLevel === 'studios') { setHierarchyLevel('departments'); setSelectedDepartment(null) }
              else { setHierarchyLevel('years'); setSelectedYear(null) }
            }}><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back one level</Button>
          )}
        </div>

        <section aria-label="Studio network results" className="min-h-[32rem] overflow-hidden rounded-pinspace-lg border border-border bg-pinspace-forest shadow-[var(--shadow-soft)] sm:min-h-[40rem]">
          {loadState === 'loading' ? (
            <div className="flex min-h-[32rem] items-center justify-center p-4 sm:min-h-[40rem]"><StatusState status="loading" title="Loading studio network" description="Finding published studios and their connections." /></div>
          ) : loadState === 'error' ? (
            <div className="flex min-h-[32rem] items-center justify-center p-4 sm:min-h-[40rem]"><StatusState status="error" title="Could not load the studio network" description="Check your connection and try again." action={<Button type="button" onClick={() => void loadStudios()}>Try again</Button>} className="w-full max-w-lg" /></div>
          ) : displayedNodes.length === 0 ? (
            <div className="flex min-h-[32rem] items-center justify-center p-4 sm:min-h-[40rem]"><EmptyState title={emptyTitle} description={emptyDescription} icon={<Network className="h-8 w-8" aria-hidden="true" />} className="w-full max-w-lg" /></div>
          ) : (
            <BubbleNetwork nodes={displayedNodes} onNodeClick={selectNode} onNodeHover={prefetchNode} />
          )}
        </section>
      </main>
    </div>
  )
}

function ExploreLoading() {
  return <main className="flex min-h-screen items-center justify-center bg-background px-4"><StatusState status="loading" title="Loading studio network" /></main>
}

export default function ExplorePage() {
  return <Suspense fallback={<ExploreLoading />}><ExplorePageInner /></Suspense>
}
