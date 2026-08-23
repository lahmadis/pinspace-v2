'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import BubbleNetwork, { BubbleNode } from '@/components/network/BubbleNetwork'
import DemoBanner from '@/components/DemoBanner'
import { prefetchStudioView } from '@/lib/studioViewCache'

type StudioResponse = {
  studios: BubbleNode[]
  totals: { studios: number; students: number }
  hasOrg?: boolean
}


function ExplorePageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [nodes, setNodes] = useState<BubbleNode[]>([])
  const [totalStudios, setTotalStudios] = useState(0)
  const [totalStudents, setTotalStudents] = useState(0)
  const [hasOrg, setHasOrg] = useState<boolean>(true)

  type ViewMode = 'flat' | 'hierarchy'
  type HierarchyLevel = 'years' | 'departments' | 'studios'

  const [viewMode, setViewMode] = useState<ViewMode>('flat')
  const [hierarchyLevel, setHierarchyLevel] = useState<HierarchyLevel>('years')
  const [selectedYear, setSelectedYear] = useState<string | number | null>(null)
  const [selectedDepartment, setSelectedDepartment] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  // Starts as All Years and is narrowed once we know which years actually have
  // published rooms. It used to start at today's calendar year, which meant
  // that whenever nothing was published in that year the page rendered empty —
  // and because the year bar only renders when years exist, there was no tab to
  // click to escape it. Defaulting wide and narrowing is the safe direction.
  const [selectedAcademicYear, setSelectedAcademicYear] = useState<string>('')
  const [availableAcademicYears, setAvailableAcademicYears] = useState<{ year: string; count: number }[]>([])
  const [roomDrillWorkspace, setRoomDrillWorkspace] = useState<BubbleNode | null>(null)

  const headerRef = useRef<HTMLElement>(null)
  const [measuredHeaderHeight, setMeasuredHeaderHeight] = useState(57)

  const isDemo = searchParams?.get('demo') === 'true'
  // Superadmin org override: when present, requests this org's network instead
  // of the caller's own. Forwarded to the explore endpoints, which honor it
  // ONLY after verifying superadmin server-side (ignored for everyone else).
  const orgParam = searchParams?.get('org') || null

  useEffect(() => {
    const el = headerRef.current
    if (!el) return
    const update = () => setMeasuredHeaderHeight(el.offsetHeight)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
    }
  }, [])

  // Filter nodes by search (studio name or professor/instructor)
  const searchFilteredNodes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return nodes
    return nodes.filter(
      (n) =>
        (n.name && n.name.toLowerCase().includes(q)) ||
        (n.instructor && n.instructor.toLowerCase().includes(q))
    )
  }, [nodes, searchQuery])

  // Load available academic years for the tab bar — scoped to user's own institution server-side
  useEffect(() => {
    if (isDemo) return
    const loadAcademicYears = async () => {
      try {
        const ayUrl = orgParam
          ? `/api/explore/academic-years?org=${encodeURIComponent(orgParam)}`
          : '/api/explore/academic-years'
        const res = await fetch(ayUrl, { cache: 'no-store' })
        if (res.ok) {
          const data = await res.json()
          const years: { year: string; count: number }[] = data.academicYears || []
          setAvailableAcademicYears(years)
          // Default to the most recent year that actually HAS published rooms
          // (the endpoint returns them sorted descending, and every entry has a
          // non-zero count), never to today's calendar year. If nothing is
          // published yet, stay on All Years rather than picking an empty one.
          setSelectedAcademicYear(years.length > 0 ? years[0].year : '')
        }
      } catch (e) {
        console.error(e)
      }
    }
    loadAcademicYears()
  }, [isDemo, orgParam])

  useEffect(() => {
    const load = async () => {
      try {
        const params = new URLSearchParams()
        if (isDemo) params.set('demo', 'true')
        if (!isDemo && selectedAcademicYear) params.set('academic_year', selectedAcademicYear)
        if (orgParam) params.set('org', orgParam)
        const url = `/api/explore/studios${params.toString() ? `?${params.toString()}` : ''}`
        const res = await fetch(url, { cache: 'no-store' })
        if (res.ok) {
          const data: StudioResponse = await res.json()
          const studios = data.studios || []
          setNodes(studios)
          setTotalStudios(data.totals?.studios ?? 0)
          setTotalStudents(data.totals?.students ?? 0)
          setHasOrg(data.hasOrg !== false)
          // Eager-prefetch first few studios so opening them is instant even without hover
          const toPrefetch = studios.filter((n) => n.url).slice(0, 5)
          for (const node of toPrefetch) {
            prefetchStudioView(node.id, isDemo)
            const path = node.url!.split('?')[0]
            router.prefetch(path)
          }
        }
      } catch (e) {
        console.error(e)
      }
    }
    load()
  }, [isDemo, selectedAcademicYear, orgParam, router])

  const handleNodeHover = useCallback(
    (node: BubbleNode) => {
      if (!node.url) return
      prefetchStudioView(node.id, isDemo)
      const path = node.url.split('?')[0]
      router.prefetch(path)
    },
    [isDemo, router]
  )

  const handleClick = (node: BubbleNode) => {
    const demoParam = isDemo ? '?demo=true' : ''

    // Already drilled into a workspace: bubbles here are its rooms — open one.
    if (roomDrillWorkspace) {
      if (node.url) {
        const url = node.url.includes('?') ? `${node.url}&demo=true` : `${node.url}${demoParam}`
        router.push(url)
      }
      return
    }

    if (viewMode === 'flat') {
      // Multi-room workspace: drill into its rooms in-place. Single-room: open directly.
      if (node.publishedRooms && node.publishedRooms.length > 1) {
        setRoomDrillWorkspace(node)
        return
      }
      if (node.url) {
        const url = node.url.includes('?') ? `${node.url}&demo=true` : `${node.url}${demoParam}`
        router.push(url)
      }
      return
    }

    if (hierarchyLevel === 'years') {
      setSelectedYear(node.year ?? node.label)
      setHierarchyLevel('departments')
    } else if (hierarchyLevel === 'departments') {
      setSelectedDepartment(node.department || node.label)
      setHierarchyLevel('studios')
    } else {
      // Studios level: multi-room drills in-place; single-room opens directly.
      if (node.publishedRooms && node.publishedRooms.length > 1) {
        setRoomDrillWorkspace(node)
        return
      }
      if (node.url) {
        const url = node.url.includes('?') ? `${node.url}&demo=true` : `${node.url}${demoParam}`
        router.push(url)
      }
    }
  }

  const displayedNodes = useMemo(() => {
    // Drilled into a workspace: render its published rooms as child bubbles.
    // boardCount maps to `count` so rooms get the same visual treatment (size +
    // tooltip) as the parent studio bubbles.
    if (roomDrillWorkspace) {
      return (roomDrillWorkspace.publishedRooms ?? []).map((room) => ({
        id: room.id,
        name: room.name,
        label: room.name,
        count: room.boardCount,
        url: `/studio/${room.id}/view`,
        color: '#6366f1',
      })) as BubbleNode[]
    }

    const source = searchFilteredNodes
    if (viewMode === 'flat') return source

    if (hierarchyLevel === 'years') {
      const years = Array.from(new Set(source.map(n => n.year ?? 'Unknown')))
      return years.map((y, idx) => ({
        id: `year-${y}-${idx}`,
        label: y === 'Masters' ? 'Masters' : `Year ${y}`,
        name: String(y),
        year: y,
        color: '#6366f1',
        radius: 70,
      })) as BubbleNode[]
    }

    if (hierarchyLevel === 'departments' && selectedYear !== null) {
      const departments = Array.from(
        new Set(
          source
            .filter(n => (n.year ?? '').toString() === selectedYear!.toString())
            .map(n => n.department ?? 'Unknown')
        )
      )
      return departments.map((d, idx) => ({
        id: `dept-${d}-${idx}`,
        label: d,
        name: d,
        year: selectedYear ?? undefined,
        department: d,
        color: '#6366f1',
        radius: 70,
      })) as BubbleNode[]
    }

    if (hierarchyLevel === 'studios') {
      return source.filter(n => {
        const matchYear = selectedYear === null ? true : (n.year ?? '').toString() === selectedYear.toString()
        const matchDept = selectedDepartment === null ? true : (n.department ?? '') === selectedDepartment
        return matchYear && matchDept
      })
    }

    return source
  }, [roomDrillWorkspace, viewMode, hierarchyLevel, searchFilteredNodes, selectedYear, selectedDepartment])

  return (
    <div className="min-h-screen bg-slate-900">
      <DemoBanner />
      {/* Floating Header */}
      <header ref={headerRef} className={`fixed ${isDemo ? 'top-12' : 'top-0'} left-0 right-0 z-40 border-b border-slate-700/50 bg-slate-900/90 backdrop-blur-md`}>
        <div className="max-w-full px-4 md:px-6 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3 md:gap-4">
          {/* Left: logo + title */}
          <div className="flex flex-col md:flex-row md:items-center md:gap-4 md:min-w-0 md:flex-1 md:justify-start">
            <div className="flex items-center justify-between md:justify-start gap-4 w-full md:w-auto">
              <Link
                href="/"
                className="text-xl font-bold text-white hover:text-indigo-400 transition-colors shrink-0"
              >
                pinspace
              </Link>
              {/* Dashboard link — mobile only (sits in top row opposite logo) */}
              <Link
                href="/dashboard"
                className="md:hidden text-sm px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-800 transition-colors shrink-0"
              >
                Dashboard
              </Link>
            </div>
            <div className="hidden md:block h-5 w-px bg-slate-600 shrink-0" />
            <div className="min-w-0">
              <h1 className="text-lg font-semibold text-white">Space Network</h1>
              <p className="text-xs text-slate-400">{totalStudios} spaces • {totalStudents} students</p>
            </div>
          </div>

          {/* Center: search + All Studios + Drill-down */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 w-full md:w-auto md:shrink-0">
            <input
              type="search"
              placeholder="Search by space name or professor…"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setRoomDrillWorkspace(null) }}
              className="w-full sm:w-80 sm:min-w-[18rem] px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              aria-label="Search spaces by name or professor"
            />
            <div className="flex items-center gap-2 sm:gap-3">
              <button
                onClick={() => {
                  setViewMode('flat')
                  setHierarchyLevel('years')
                  setSelectedYear(null)
                  setSelectedDepartment(null)
                  setRoomDrillWorkspace(null)
                }}
                className={`px-4 py-2 text-sm rounded-lg border transition-colors ${
                  viewMode === 'flat'
                    ? 'bg-indigo-600 text-white border-indigo-500'
                    : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700'
                }`}
              >
                All Spaces
              </button>
              <button
                onClick={() => {
                  setViewMode('hierarchy')
                  setHierarchyLevel('years')
                  setSelectedYear(null)
                  setSelectedDepartment(null)
                  setRoomDrillWorkspace(null)
                }}
                className={`px-4 py-2 text-sm rounded-lg border transition-colors ${
                  viewMode === 'hierarchy'
                    ? 'bg-indigo-600 text-white border-indigo-500'
                    : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700'
                }`}
              >
                Drill-down<span className="hidden sm:inline"> (Year → Dept → Space)</span>
              </button>
            </div>
          </div>

          {/* Right: Dashboard — desktop only (mobile version lives in the top row above) */}
          <div className="hidden md:flex items-center justify-end min-w-0 md:flex-1">
            <Link
              href="/dashboard"
              className="text-sm px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-800 transition-colors shrink-0"
            >
              Dashboard
            </Link>
          </div>
        </div>
      </header>

      {/* Academic Year Tab Bar */}
      {!isDemo && availableAcademicYears.length > 0 && (
        <div className="fixed top-[57px] left-0 right-0 z-30 bg-slate-900/95 border-b border-slate-700/50 px-6 py-2 flex items-center gap-2 overflow-x-auto">
          <button
            onClick={() => { setSelectedAcademicYear(''); setRoomDrillWorkspace(null) }}
            className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              selectedAcademicYear === ''
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-600'
            }`}
          >
            All Years
          </button>
          {availableAcademicYears.map(({ year, count }) => (
            <button
              key={year}
              onClick={() => { setSelectedAcademicYear(year); setRoomDrillWorkspace(null) }}
              className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                selectedAcademicYear === year
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-600'
              }`}
            >
              {year}
              <span className={`ml-1.5 text-xs ${selectedAcademicYear === year ? 'text-indigo-200' : 'text-slate-500'}`}>
                {count}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Full Canvas Bubble Network or empty state */}
      {(() => {
        const hasYearBar = !isDemo && availableAcademicYears.length > 0
        const headerHeight = measuredHeaderHeight + (hasYearBar ? 44 : 0)
        return displayedNodes.length === 0 ? (
          <div
            className="flex items-center justify-center"
            style={{ height: '100vh', paddingTop: headerHeight }}
          >
            <div className="text-center">
              <p className="text-slate-400 text-xl font-medium">No spaces yet</p>
              <p className="text-slate-500 text-sm mt-2">
                {!isDemo && !hasOrg
                  ? "We couldn't find spaces for your institution. Contact support if this seems wrong."
                  : !isDemo && selectedAcademicYear
                    ? `No published spaces for ${selectedAcademicYear}`
                    : 'No published spaces found for your institution'}
              </p>
            </div>
          </div>
        ) : (
          <BubbleNetwork
            nodes={displayedNodes}
            onNodeClick={handleClick}
            onNodeHover={handleNodeHover}
            fullScreen={true}
            headerHeight={headerHeight}
          />
        )
      })()}

      {/* Connection Legend - Bottom Left */}
      <div className="fixed bottom-4 left-4 z-30 bg-slate-800/90 backdrop-blur-sm rounded-lg border border-slate-700 p-4">
        <h4 className="text-sm font-semibold text-white mb-3">Connections</h4>
        <div className="space-y-2 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-6 h-0.5 bg-blue-500" />
            <span className="text-slate-300">Same Instructor</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-0.5 border-t-2 border-dashed border-purple-500" />
            <span className="text-slate-300">Same Year</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-0.5 border-t-2 border-dotted border-emerald-500" />
            <span className="text-slate-300">Same Department</span>
          </div>
        </div>
      </div>

      {/* Floating back pill — shown while drilled into a workspace's rooms.
          Clearing roomDrillWorkspace lands back one level (studios list in
          either flat or hierarchy mode, since no other view state changed). */}
      {roomDrillWorkspace && (
        <button
          type="button"
          onClick={() => setRoomDrillWorkspace(null)}
          aria-label="Back to spaces"
          className="fixed left-4 z-30 flex items-center gap-2 max-w-[70vw] px-4 py-2 rounded-full bg-slate-800/90 hover:bg-slate-700 text-white text-sm font-medium border border-slate-600/50 backdrop-blur-sm shadow-lg transition-colors"
          style={{ top: measuredHeaderHeight + (!isDemo && availableAcademicYears.length > 0 ? 44 : 0) + 12 }}
        >
          <span aria-hidden className="text-base leading-none">←</span>
          <span className="truncate">{roomDrillWorkspace.name}</span>
        </button>
      )}
    </div>
  )
}

export default function ExplorePage() {
  return (
    <Suspense fallback={null}>
      <ExplorePageInner />
    </Suspense>
  )
}
