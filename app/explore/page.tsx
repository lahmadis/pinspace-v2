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
  /** What this institution calls its network, e.g. "WIT Network". */
  networkLabel?: string | null
}

/** How many matched names to spell out before collapsing to a count. */
const MAX_NAMED_PEOPLE = 3


function ExplorePageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [nodes, setNodes] = useState<BubbleNode[]>([])
  const [totalStudios, setTotalStudios] = useState(0)
  const [totalStudents, setTotalStudents] = useState(0)
  const [hasOrg, setHasOrg] = useState<boolean>(true)
  /**
   * Titles the page after the school. Null until the studios fetch resolves,
   * and null for an org that has set neither a network_label nor a name — the
   * heading falls back to a generic word rather than rendering "null network".
   */
  const [networkLabel, setNetworkLabel] = useState<string | null>(null)

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

  // Filter nodes by search (studio name, professor/instructor, or anyone with
  // work pinned in the space).
  const searchFilteredNodes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return nodes
    return nodes.filter(
      (n) =>
        (n.name && n.name.toLowerCase().includes(q)) ||
        (n.instructor && n.instructor.toLowerCase().includes(q)) ||
        n.contributors?.some((c) => c.toLowerCase().includes(q))
    )
  }, [nodes, searchQuery])

  /**
   * The people the query matched, for the line under the search box.
   *
   * Without it a student search is baffling: you type a name and some spaces
   * survive with nothing on screen explaining why, because the thing that
   * matched — who has work inside — is not written on the bubble. Naming the
   * people also disambiguates a partial query that hit several of them.
   */
  const matchedPeople = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return []
    // Keyed case-insensitively so the same person stored two ways across two
    // studios lists once; the first spelling seen is the one shown.
    const byKey = new Map<string, string>()
    for (const n of nodes) {
      for (const c of n.contributors ?? []) {
        const key = c.toLowerCase()
        if (key.includes(q) && !byKey.has(key)) byKey.set(key, c)
      }
    }
    return Array.from(byKey.values()).sort((a, b) => a.localeCompare(b))
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
          setNetworkLabel(data.networkLabel ?? null)
          // Eager-prefetch first few studios so opening them is instant even without hover
          const toPrefetch = studios.filter((n) => n.url).slice(0, 5)
          for (const node of toPrefetch) {
            prefetchStudioView(node.id, isDemo, node.workspaceId ?? node.id)
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
      prefetchStudioView(node.id, isDemo, node.workspaceId ?? node.id)
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
        color: '#3B6EF6',
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
        color: '#3B6EF6',
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
        color: '#3B6EF6',
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
    <div className="min-h-screen bg-[#E6ECFC]">
      <DemoBanner />
      {/* Floating Header */}
      {/* No bar: no fill, no border, no blur. The grid runs to the top of the
          viewport and these controls sit on it. Each control keeps its own
          background, so nothing here depends on the strip that used to be
          behind them; the bubble simulation is biased below this height rather
          than the canvas being inset by it (see BubbleNetwork). */}
      <header
        ref={headerRef}
        // pointer-events-none on the strip, auto on the controls inside it.
        // With no background the header is an invisible full-width box sitting
        // on a drag-to-pan canvas; without this it would swallow every gesture
        // along the top of the graph, including in the empty space between the
        // title and the search box.
        className={`fixed ${isDemo ? 'top-12' : 'top-0'} left-0 right-0 z-40 pointer-events-none`}
      >
        <div className="max-w-full px-4 md:px-6 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3 md:gap-4 [&_a]:pointer-events-auto [&_button]:pointer-events-auto [&_input]:pointer-events-auto">
          {/* Left: logo + title */}
          <div className="flex flex-col md:flex-row md:items-center md:gap-4 md:min-w-0 md:flex-1 md:justify-start">
            <div className="flex items-center justify-between md:justify-start gap-4 w-full md:w-auto">
              <Link
                href="/"
                className="text-xl font-bold text-[#16181D] hover:text-[#3B6EF6] transition-colors shrink-0"
              >
                pinspace
              </Link>
              {/* Dashboard link — mobile only (sits in top row opposite logo) */}
              <Link
                href="/dashboard"
                className="md:hidden text-sm px-4 py-2 rounded-lg border border-[#16181D]/[0.12] text-[#5A5E6B] hover:bg-white transition-colors shrink-0"
              >
                Dashboard
              </Link>
            </div>
            <div className="hidden md:block h-5 w-px bg-[#16181D]/15 shrink-0" />
            <div className="min-w-0">
              <h1 className="text-lg font-semibold text-[#16181D]">{networkLabel ?? 'Network'}</h1>
              <p className="text-xs text-[#5A5E6B]">{totalStudios} spaces • {totalStudents} students</p>
            </div>
          </div>

          {/* Center: search + All Studios + Drill-down */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 w-full md:w-auto md:shrink-0">
            <div className="w-full sm:w-80 sm:min-w-[18rem]">
              <input
                type="search"
                placeholder="Search by space, professor, or student…"
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setRoomDrillWorkspace(null) }}
                className="w-full px-3 py-2 rounded-lg bg-white/80 border border-[#16181D]/[0.12] text-[#16181D] placeholder-[#8A8FA0] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B6EF6] focus:border-transparent"
                aria-label="Search spaces by name, professor, or student"
              />
              {/* Says WHY these spaces matched. A student's name isn't written
                  on any bubble, so without this a name search looks like an
                  unexplained filter. */}
              {matchedPeople.length > 0 && (
                <p className="mt-1 text-[11px] text-[#5A5E6B] truncate" aria-live="polite">
                  <span className="text-[#8A8FA0]">Work by </span>
                  {matchedPeople.slice(0, MAX_NAMED_PEOPLE).join(', ')}
                  {matchedPeople.length > MAX_NAMED_PEOPLE &&
                    ` +${matchedPeople.length - MAX_NAMED_PEOPLE} more`}
                </p>
              )}
            </div>
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
                    ? 'bg-[#3B6EF6] text-[#16181D] border-[#3B6EF6]'
                    : 'bg-white/80 text-[#16181D] border-[#16181D]/10 hover:bg-white'
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
                    ? 'bg-[#3B6EF6] text-[#16181D] border-[#3B6EF6]'
                    : 'bg-white/80 text-[#16181D] border-[#16181D]/10 hover:bg-white'
                }`}
              >
                <span className="sm:hidden">Years</span>
                <span className="hidden sm:inline">Year → Dept → Space</span>
              </button>
            </div>
          </div>

          {/* Right: Dashboard — desktop only (mobile version lives in the top row above) */}
          <div className="hidden md:flex items-center justify-end min-w-0 md:flex-1">
            <Link
              href="/dashboard"
              className="text-sm px-4 py-2 rounded-lg border border-[#16181D]/[0.12] text-[#5A5E6B] hover:bg-white transition-colors shrink-0"
            >
              Dashboard
            </Link>
          </div>
        </div>
      </header>

      {/* Academic Year Tab Bar */}
      {!isDemo && availableAcademicYears.length > 0 && (
        <div className="fixed top-[57px] left-0 right-0 z-30 px-6 py-2 flex items-center gap-2 overflow-x-auto pointer-events-none [&_button]:pointer-events-auto">
          <button
            onClick={() => { setSelectedAcademicYear(''); setRoomDrillWorkspace(null) }}
            className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              selectedAcademicYear === ''
                ? 'bg-[#3B6EF6] text-[#16181D]'
                : 'bg-white/80 text-[#5A5E6B] hover:bg-white border border-[#16181D]/[0.12]'
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
                  ? 'bg-[#3B6EF6] text-[#16181D]'
                  : 'bg-white/80 text-[#5A5E6B] hover:bg-white border border-[#16181D]/[0.12]'
              }`}
            >
              {year}
              <span className={`ml-1.5 text-xs ${selectedAcademicYear === year ? 'text-[#16181D]/70' : 'text-[#8A8FA0]'}`}>
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
              <p className="text-[#5A5E6B] text-xl font-medium">No spaces yet</p>
              <p className="text-[#8A8FA0] text-sm mt-2">
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

      {/* The Connections legend lives in BubbleNetwork, next to the styles it
          describes. A second copy used to sit here at the same bottom-left
          corner, painting over it — with blue/purple/emerald swatches that
          matched none of the three lines actually drawn. Exactly the drift the
          component's legend is now wired against, so it is gone rather than
          re-coloured. */}

      {/* Floating back pill — shown while drilled into a workspace's rooms.
          Clearing roomDrillWorkspace lands back one level (studios list in
          either flat or hierarchy mode, since no other view state changed). */}
      {roomDrillWorkspace && (
        <button
          type="button"
          onClick={() => setRoomDrillWorkspace(null)}
          aria-label="Back to spaces"
          className="fixed left-4 z-30 flex items-center gap-2 max-w-[70vw] px-4 py-2 rounded-full bg-white/85 hover:bg-white text-[#16181D] text-sm font-medium border border-[#16181D]/10 backdrop-blur-sm shadow-lg transition-colors"
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
