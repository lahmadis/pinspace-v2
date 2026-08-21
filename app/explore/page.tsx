'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Network } from 'lucide-react'
import BubbleNetwork, { BubbleNode } from '@/components/network/BubbleNetwork'
import { NetworkShimmerCanvas, ExplorePageShimmer } from '@/components/network/NetworkShimmer'
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
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-pinspace-forest text-white">
      <DemoBanner />
      <header className="z-30 shrink-0 border-b border-white/15 bg-pinspace-forest/95 px-4 py-3 backdrop-blur-md sm:px-6">
        <div className="mx-auto flex w-full flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-3 min-w-0">
            <Link href="/" className="inline-flex min-h-11 items-center rounded-pinspace px-2 text-lg font-black text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">pinspace</Link>
            <Link href="/dashboard" className="inline-flex min-h-11 items-center rounded-pinspace px-2 text-sm font-semibold text-primary hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">Dashboard</Link>
            <span className="hidden sm:inline text-white/30">|</span>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-bold leading-tight text-white sm:text-xl">Studio network</h1>
              <p className="text-xs text-white/70">{totals.studios} studios · {totals.students} students</p>
            </div>
          </div>

          <div className="flex w-full flex-wrap items-center gap-3 lg:w-auto">
            <div className="min-w-[200px] max-w-md flex-1">
              <Input type="search" aria-label="Search studios by name or professor" placeholder="Search by studio name or professor…" value={searchQuery} onChange={(event) => { setSearchQuery(event.target.value); setRoomDrillWorkspace(null) }} className="min-h-10 border-white/20 bg-white/10 text-white placeholder:text-white/50 focus:border-primary focus:ring-primary" />
            </div>

            {!isDemo && availableAcademicYears.length > 0 && (
              <Select id="academic-year" value={selectedAcademicYear} onChange={(event) => { setSelectedAcademicYear(event.target.value); setRoomDrillWorkspace(null) }} className="min-h-10 w-auto border-white/20 bg-white/10 font-medium text-white focus:border-primary">
                <option value="" className="bg-pinspace-forest text-white">All years</option>
                {availableAcademicYears.map(({ year, count }) => <option key={year} value={year} className="bg-pinspace-forest text-white">{year} ({count})</option>)}
              </Select>
            )}

            <div className="flex items-center gap-2" role="group" aria-label="Network view">
              <Button type="button" variant={viewMode === 'flat' ? 'primary' : 'ghost'} className={viewMode === 'flat' ? '' : 'border-white/20 text-white hover:bg-white/10'} aria-pressed={viewMode === 'flat'} onClick={resetToStudios}>All studios</Button>
              <Button type="button" variant={viewMode === 'hierarchy' ? 'primary' : 'ghost'} className={viewMode === 'hierarchy' ? '' : 'border-white/20 text-white hover:bg-white/10'} aria-pressed={viewMode === 'hierarchy'} onClick={() => { setViewMode('hierarchy'); setHierarchyLevel('years'); setSelectedYear(null); setSelectedDepartment(null); setRoomDrillWorkspace(null) }}>Browse levels</Button>
            </div>

            {(roomDrillWorkspace || hierarchyLevel !== 'years') && (
              <Button type="button" variant="ghost" className="border-white/20 text-white hover:bg-white/10" onClick={() => {
                if (roomDrillWorkspace) setRoomDrillWorkspace(null)
                else if (hierarchyLevel === 'studios') { setHierarchyLevel('departments'); setSelectedDepartment(null) }
                else { setHierarchyLevel('years'); setSelectedYear(null) }
              }}><ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />Back</Button>
            )}
          </div>
        </div>
      </header>

      <main className="relative flex-1 min-h-0 w-full bg-pinspace-forest">
        <section aria-label="Studio network results" className="h-full w-full">
          {loadState === 'loading' ? (
            <NetworkShimmerCanvas />
          ) : loadState === 'error' ? (
            <div className="flex h-full w-full items-center justify-center p-4"><StatusState status="error" title="Could not load the studio network" description="Check your connection and try again." action={<Button type="button" onClick={() => void loadStudios()}>Try again</Button>} className="w-full max-w-lg" /></div>
          ) : displayedNodes.length === 0 ? (
            <div className="flex h-full w-full items-center justify-center p-4"><EmptyState title={emptyTitle} description={emptyDescription} icon={<Network className="h-8 w-8" aria-hidden="true" />} className="w-full max-w-lg text-white" /></div>
          ) : (
            <BubbleNetwork nodes={displayedNodes} onNodeClick={selectNode} onNodeHover={prefetchNode} />
          )}
        </section>
      </main>
    </div>
  )
}

function ExploreLoading() {
  return <ExplorePageShimmer />
}

export default function ExplorePage() {
  return <Suspense fallback={<ExploreLoading />}><ExplorePageInner /></Suspense>
}
