'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import BubbleNetwork, { BubbleNode } from '@/components/network/BubbleNetwork'
import DemoBanner from '@/components/DemoBanner'
import { prefetchStudioView } from '@/lib/studioViewCache'
import { STUDIOS } from '@/lib/constants/studios'

type StudioResponse = {
  studios: BubbleNode[]
  totals: { studios: number; students: number }
  hasOrg?: boolean
  /** What this institution calls its network, e.g. "WIT Network". */
  networkLabel?: string | null
}

/** How many matched names to spell out before collapsing to a count. */
const MAX_NAMED_PEOPLE = 3

/**
 * Bucket for spaces published before sections existed, i.e. with no
 * network_metadata.studio.
 *
 * They need a bucket rather than a filter: dropping them would make every
 * already-published studio in the network vanish the moment this level shipped,
 * and the drill-down is the only way into them. The label is deliberately not a
 * plausible studio name — it must never collide with a real value from
 * lib/constants/studios, since the two are compared as plain strings here.
 */
const UNFILED_STUDIO = 'Not in a studio'


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

  /**
   * The drill-down, one entry per level: department → year → studio → section.
   *
   * Department leads. It is the stable, self-contained thing — a visitor knows
   * which one they are looking for before they know anything else, and the
   * three of them partition the network cleanly. Year led originally, which
   * opened the map on a set of buckets that each still mixed every department
   * together, so the first click narrowed nothing anyone had actually asked
   * about.
   *
   * 'studios' is the level that was inserted here, and the rename underneath it
   * is the part to read carefully. What used to be called 'studios' — the
   * workspace bubbles — is now 'sections', because that is what a workspace is:
   * one instructor's section of a studio. 'studios' now means the BUCKET
   * (Studio 01 … Thesis Studio), which is a group-by over
   * network_metadata.studio and not a row anywhere.
   *
   * Ten sections of Studio 01 used to land as ten sibling bubbles in a year's
   * department, indistinguishable from the eight other studios' sections. The
   * extra level is what makes "show me Studio 01" a thing you can click.
   */
  type HierarchyLevel = 'years' | 'departments' | 'studios' | 'sections'

  const [hierarchyLevel, setHierarchyLevel] = useState<HierarchyLevel>('departments')
  const [selectedYear, setSelectedYear] = useState<string | number | null>(null)
  const [selectedDepartment, setSelectedDepartment] = useState<string | null>(null)
  const [selectedStudio, setSelectedStudio] = useState<string | null>(null)
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

    /** A section bubble: multi-room drills into its rooms, single-room opens. */
    const openSection = (n: BubbleNode) => {
      if (n.publishedRooms && n.publishedRooms.length > 1) {
        setRoomDrillWorkspace(n)
        return
      }
      if (n.url) {
        const url = n.url.includes('?') ? `${n.url}&demo=true` : `${n.url}${demoParam}`
        router.push(url)
      }
    }

    // Already drilled into a workspace: bubbles here are its rooms — open one.
    if (roomDrillWorkspace) {
      if (node.url) {
        const url = node.url.includes('?') ? `${node.url}&demo=true` : `${node.url}${demoParam}`
        router.push(url)
      }
      return
    }

    // While searching, what is on screen is matching SECTIONS regardless of
    // which level the drill-down is on — see displayedNodes — so a click here
    // opens one rather than descending a level.
    if (searchQuery.trim()) {
      openSection(node)
      return
    }

    if (hierarchyLevel === 'departments') {
      setSelectedDepartment(node.department || node.label)
      setHierarchyLevel('years')
    } else if (hierarchyLevel === 'years') {
      setSelectedYear(node.year ?? node.label)
      setHierarchyLevel('studios')
    } else if (hierarchyLevel === 'studios') {
      // Reads `studio` off the bucket node, which displayedNodes set from the
      // group key — including UNFILED_STUDIO, so the unfiled bucket drills in
      // like any other rather than being a dead bubble.
      setSelectedStudio(node.studio ?? node.label)
      setHierarchyLevel('sections')
    } else {
      openSection(node)
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

    /*
     * A search shows its matches DIRECTLY, skipping the drill-down.
     *
     * This is what the removed "All Spaces" button used to provide. Without it
     * a query would only prune which department bubbles appear, so finding a
     * person still meant three more clicks through levels you had already
     * narrowed to one — which is not a search, it is a filter on a menu.
     */
    if (searchQuery.trim()) return source

    // Top level: every department that has anything published, unfiltered.
    if (hierarchyLevel === 'departments') {
      const departments = Array.from(new Set(source.map(n => n.department ?? 'Unknown')))
      return departments.map((d, idx) => ({
        id: `dept-${d}-${idx}`,
        label: d,
        name: d,
        department: d,
        color: '#3B6EF6',
        radius: 70,
      })) as BubbleNode[]
    }

    // Second level: the years that department actually runs. Scoped to the
    // chosen department, so a department with no fifth year simply has no
    // fifth-year bubble rather than an empty one.
    if (hierarchyLevel === 'years' && selectedDepartment !== null) {
      const years = Array.from(
        new Set(
          source
            .filter(n => (n.department ?? '') === selectedDepartment)
            .map(n => n.year ?? 'Unknown')
        )
      )
      return years.map((y, idx) => ({
        id: `year-${y}-${idx}`,
        label: y === 'Masters' ? 'Masters' : `Year ${y}`,
        name: String(y),
        year: y,
        department: selectedDepartment ?? undefined,
        color: '#3B6EF6',
        radius: 70,
      })) as BubbleNode[]
    }

    // Department + year are the filter every level below them shares, so it is
    // written once here rather than repeated in the two branches under it.
    const inSelectedYearAndDept = (n: BubbleNode) => {
      const matchYear = selectedYear === null ? true : (n.year ?? '').toString() === selectedYear.toString()
      const matchDept = selectedDepartment === null ? true : (n.department ?? '') === selectedDepartment
      return matchYear && matchDept
    }

    if (hierarchyLevel === 'studios') {
      const scoped = source.filter(inSelectedYearAndDept)
      // Counted, not just listed: a studio bucket with two sections and one
      // with eleven are the same bubble otherwise, and `count` is what sizes
      // them. Sections carry `count` = board total, so summing keeps the
      // bucket's size proportional to the work inside it rather than to the
      // number of sections, which is the same rule the level below uses.
      const buckets = new Map<string, { sections: number; boards: number }>()
      for (const n of scoped) {
        const key = n.studio ?? UNFILED_STUDIO
        const b = buckets.get(key) ?? { sections: 0, boards: 0 }
        b.sections += 1
        b.boards += n.count ?? 0
        buckets.set(key, b)
      }
      return Array.from(buckets.entries())
        // Ordered by the canonical list, not alphabetically: Studio 01 → 08 is
        // a progression through the degree, and sorting the strings would open
        // with 'Global Research Studio' because G precedes S. Anything not in
        // the list — the unfiled bucket, or a value from a future edit to
        // STUDIOS this build predates — gets index -1, so it is pushed to the
        // end rather than silently leading the row.
        .sort(([a], [b]) => {
          const ia = STUDIOS.indexOf(a as (typeof STUDIOS)[number])
          const ib = STUDIOS.indexOf(b as (typeof STUDIOS)[number])
          return (ia === -1 ? STUDIOS.length : ia) - (ib === -1 ? STUDIOS.length : ib)
        })
        .map(([studio, { sections, boards }], idx) => ({
          id: `studio-${studio}-${idx}`,
          label: studio,
          name: studio,
          studio,
          year: selectedYear ?? undefined,
          department: selectedDepartment ?? undefined,
          count: boards,
          sectionCount: sections,
          color: '#3B6EF6',
          radius: 70,
        })) as BubbleNode[]
    }

    if (hierarchyLevel === 'sections') {
      return source.filter(n => {
        if (!inSelectedYearAndDept(n)) return false
        if (selectedStudio === null) return true
        return (n.studio ?? UNFILED_STUDIO) === selectedStudio
      })
    }

    return source
  }, [roomDrillWorkspace, hierarchyLevel, searchQuery, searchFilteredNodes, selectedYear, selectedDepartment, selectedStudio])

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
                {/* The blue terminal period, as on the landing page and the
                    studio header. This was the last surface still spelling the
                    wordmark without it. A true circle rather than the font's
                    '.', sized in em so it tracks the text. */}
                <span
                  aria-hidden="true"
                  className="inline-block align-baseline rounded-full bg-[#3B6EF6] w-[0.2em] h-[0.2em] ml-[0.06em]"
                />
              </Link>
              {/* Dashboard link — mobile only (sits in top row opposite logo) */}
              <Link
                href="/dashboard"
                className="md:hidden text-sm px-4 py-2 rounded-full bg-white text-[#16181D] font-medium border border-[#16181D]/[0.12] hover:bg-[#F4F6FB] transition-colors shrink-0"
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
            {/*
              There were two buttons here and they were a mode toggle: All
              Spaces (every section at once) against the drill-down. All Spaces
              is gone, so there is no mode left to pick and nothing to show as
              selected — this is now a single ACTION that returns the map to the
              top of the drill-down, and it is styled as one. Neutral, not the
              filled blue an active toggle wore.

              It also keeps the path visible, which is the other half of what
              the pair did: it is the only place the four levels are named in
              order, and from three levels deep that is worth reading.
            */}
            <div className="flex items-center gap-2 sm:gap-3">
              <button
                onClick={() => {
                  setHierarchyLevel('departments')
                  setSelectedYear(null)
                  setSelectedDepartment(null)
                  setSelectedStudio(null)
                  setRoomDrillWorkspace(null)
                  setSearchQuery('')
                }}
                title="Back to all departments"
                className="px-4 py-2 text-sm rounded-full bg-white text-[#16181D] font-medium border border-[#16181D]/[0.12] hover:bg-[#F4F6FB] transition-colors"
              >
                <span className="sm:hidden">Departments</span>
                <span className="hidden sm:inline">Department → Year → Studio → Section</span>
              </button>
            </div>
          </div>

          {/* Right: Dashboard — desktop only (mobile version lives in the top row above) */}
          <div className="hidden md:flex items-center justify-end min-w-0 md:flex-1">
            <Link
              href="/dashboard"
              className="text-sm px-4 py-2 rounded-full bg-white text-[#16181D] font-medium border border-[#16181D]/[0.12] hover:bg-[#F4F6FB] transition-colors shrink-0"
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
                ? 'bg-[#3B6EF6] text-white'
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
                  ? 'bg-[#3B6EF6] text-white'
                  : 'bg-white/80 text-[#5A5E6B] hover:bg-white border border-[#16181D]/[0.12]'
              }`}
            >
              {year}
              <span className={`ml-1.5 text-xs ${selectedAcademicYear === year ? 'text-white/70' : 'text-[#8A8FA0]'}`}>
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

      {/* Floating back pill.
          It used to exist ONLY for the room drill, which meant the hierarchy
          had no way back at all — you got to the studios list and your only
          exit was the mode button, which resets to years. That was survivable
          at three levels and is not at four, so the pill now walks the whole
          stack: rooms → sections → studios → departments → years.

          It names where you ARE, not where it takes you — the same thing the
          room-drill version did with the workspace name — because on a canvas
          of unlabelled sibling bubbles the useful information is which bucket
          you are inside. */}
      {(() => {
        const back =
          roomDrillWorkspace
            ? { label: roomDrillWorkspace.name, go: () => setRoomDrillWorkspace(null) }
            : hierarchyLevel === 'sections'
                ? {
                    label: selectedStudio ?? 'Studio',
                    go: () => { setSelectedStudio(null); setHierarchyLevel('studios') },
                  }
                : hierarchyLevel === 'studios'
                  ? {
                      label:
                        selectedYear === 'Masters'
                          ? 'Masters'
                          : selectedYear !== null ? `Year ${selectedYear}` : 'Year',
                      go: () => { setSelectedYear(null); setHierarchyLevel('years') },
                    }
                  : hierarchyLevel === 'years'
                    ? {
                        label: selectedDepartment ?? 'Department',
                        go: () => { setSelectedDepartment(null); setHierarchyLevel('departments') },
                      }
                    : null
        if (!back) return null
        return (
          <button
            type="button"
            onClick={back.go}
            aria-label="Back one level"
            className="fixed left-4 z-30 flex items-center gap-2 max-w-[70vw] px-4 py-2 rounded-full bg-white/85 hover:bg-white text-[#16181D] text-sm font-medium border border-[#16181D]/10 backdrop-blur-sm shadow-lg transition-colors"
            style={{ top: measuredHeaderHeight + (!isDemo && availableAcademicYears.length > 0 ? 44 : 0) + 12 }}
          >
            <span aria-hidden className="text-base leading-none">←</span>
            <span className="truncate">{back.label}</span>
          </button>
        )
      })()}
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
