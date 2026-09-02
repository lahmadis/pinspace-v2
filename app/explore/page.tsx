'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import BubbleNetwork, { BubbleNode } from '@/components/network/BubbleNetwork'
import DemoBanner from '@/components/DemoBanner'
import { prefetchStudioView } from '@/lib/studioViewCache'
import { gradeLabel } from '@/lib/constants/departments'
import { STUDIOS } from '@/lib/constants/studios'
import { compareTermsDesc } from '@/lib/term'

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
const UNFILED_STUDIO = 'Not in a class'

/** Same idea as UNFILED_STUDIO, for rows published before terms were recorded. */
const UNFILED_TERM = 'No semester'


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
   * The drill-down, one entry per level:
   * Department → Semester → Grade Level → Class → Section.
   *
   * SEMESTER IS A LEVEL, not a filter. It used to be a row of chips above
   * the canvas — All Years / 2026-2027 / 2025-2026 — which is a different
   * mechanism for the same question and a worse one: a chip row is a mode you
   * can leave switched on by accident, it competes with the drill-down for the
   * same click, and it has to be sized and offset around the header on every
   * viewport. As a level it is just the second bubble you click.
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
  type HierarchyLevel = 'departments' | 'semesters' | 'years' | 'studios' | 'sections'

  /**
   * The drill-down lives in the URL, and that is what makes it survivable.
   *
   * Entering a space and pressing back used to dump you at the top of the map,
   * four clicks from where you were, because the levels were React state that
   * died with the page. As query params they are a place: the space carries the
   * explore URL it was opened from and returns you to it, a link to a class
   * opens on that class, and the browser's own back button walks the levels.
   *
   * Seeded once from the URL rather than read live — the effect below is the
   * writer, and a component that both reads and writes the same params every
   * render is a loop waiting to happen.
   */
  const [hierarchyLevel, setHierarchyLevel] = useState<HierarchyLevel>(() => {
    const raw = searchParams?.get('level')
    return raw === 'semesters' || raw === 'years' || raw === 'studios' || raw === 'sections'
      ? raw
      : 'departments'
  })
  const [selectedYear, setSelectedYear] = useState<string | number | null>(
    () => searchParams?.get('grade') ?? null
  )
  const [selectedDepartment, setSelectedDepartment] = useState<string | null>(
    () => searchParams?.get('dept') ?? null
  )
  const [selectedStudio, setSelectedStudio] = useState<string | null>(
    () => searchParams?.get('class') ?? null
  )
  const [searchQuery, setSearchQuery] = useState('')
  /**
   * The term drilled into, '' for none. Empty is not "All Years" any more —
   * it just means the drill-down has not reached that level yet, the same way
   * selectedDepartment is null above it.
   *
   * This no longer feeds the fetch. The page loads every term at once and the
   * levels below slice it, so moving between terms is a click on the canvas
   * rather than a refetch.
   */
  const [selectedTerm, setSelectedTerm] = useState<string>(
    () => searchParams?.get('term') ?? ''
  )
  const [roomDrillWorkspace, setRoomDrillWorkspace] = useState<BubbleNode | null>(null)

  /**
   * The explore URL for the CURRENT drill position — what a space is handed as
   * its way back. Unknown params (demo, org, institution) are carried through
   * rather than rebuilt, so nothing else on the page loses its query.
   */
  const drillHref = useMemo(() => {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    const set = (key: string, value: string | null) => {
      if (value) params.set(key, value)
      else params.delete(key)
    }
    set('level', hierarchyLevel === 'departments' ? null : hierarchyLevel)
    set('dept', selectedDepartment)
    set('term', selectedTerm || null)
    set('grade', selectedYear === null ? null : String(selectedYear))
    set('class', selectedStudio)
    const qs = params.toString()
    return qs ? `/explore?${qs}` : '/explore'
  }, [searchParams, hierarchyLevel, selectedDepartment, selectedTerm, selectedYear, selectedStudio])

  // Keep the address bar on the drill position. replace, not push: the back
  // pill and the trail are this page's own navigation, and pushing a history
  // entry per level would make the browser's back button undo one bubble click
  // at a time before it ever left the page.
  useEffect(() => {
    const current = typeof window !== 'undefined'
      ? `${window.location.pathname}${window.location.search}`
      : null
    if (current !== null && current !== drillHref) router.replace(drillHref, { scroll: false })
  }, [drillHref, router])

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

  // Filter nodes by search (space name, instructor, or anyone with work pinned
  // in the space).
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


  useEffect(() => {
    const load = async () => {
      try {
        const params = new URLSearchParams()
        if (isDemo) params.set('demo', 'true')
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
  }, [isDemo, orgParam, router])

  const handleNodeHover = useCallback(
    (node: BubbleNode) => {
      if (!node.url) return
      prefetchStudioView(node.id, isDemo, node.workspaceId ?? node.id)
      const path = node.url.split('?')[0]
      router.prefetch(path)
    },
    [isDemo, router]
  )

  /** Tack the current drill position onto a space's URL as its way back. */
  const withReturnTo = (url: string) =>
    `${url}${url.includes('?') ? '&' : '?'}returnTo=${encodeURIComponent(drillHref)}`

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
        router.push(withReturnTo(url))
      }
    }

    // Already drilled into a workspace: bubbles here are its rooms — open one.
    if (roomDrillWorkspace) {
      if (node.url) {
        const url = node.url.includes('?') ? `${node.url}&demo=true` : `${node.url}${demoParam}`
        router.push(withReturnTo(url))
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
      setHierarchyLevel('semesters')
    } else if (hierarchyLevel === 'semesters') {
      setSelectedTerm(node.academicYear ?? node.label)
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

    // Second level: the SEMESTERS that department has published work in.
    // Newest first — a visitor is far more often after the current term than
    // one three years ago.
    //
    // These used to be academic years ('2025-2026'), which sorted correctly as
    // plain strings; semesters do not — 'Fall 2025' sorts after 'Spring 2026'
    // alphabetically and before it in time — so the ordering is delegated to
    // lib/term. compareTermsDesc also keeps the unfiled bucket last, which is
    // what the two hand-written guards here used to do.
    if (hierarchyLevel === 'semesters' && selectedDepartment !== null) {
      const terms = Array.from(
        new Set(
          source
            .filter(n => (n.department ?? '') === selectedDepartment)
            .map(n => n.academicYear ?? UNFILED_TERM)
        )
      ).sort(compareTermsDesc)
      return terms.map((t, idx) => ({
        id: `term-${t}-${idx}`,
        label: t,
        name: t,
        academicYear: t,
        department: selectedDepartment ?? undefined,
        color: '#3B6EF6',
        radius: 70,
      })) as BubbleNode[]
    }

    // Third level: the grade levels that department runs in that semester.
    // Scoped to both, so a department with no fifth year simply has no
    // fifth-year bubble rather than an empty one.
    if (hierarchyLevel === 'years' && selectedDepartment !== null) {
      const years = Array.from(
        new Set(
          source
            .filter(n => (n.department ?? '') === selectedDepartment)
            .filter(n => selectedTerm === ''
              || (n.academicYear ?? UNFILED_TERM) === selectedTerm)
            .map(n => n.year ?? 'Unknown')
        )
      )
      return years.map((y, idx) => ({
        id: `year-${y}-${idx}`,
        // "Sophomore", not "Year 2" — the name the section was filed under in
        // its settings. gradeLabel takes the bare number the explore API
        // sends; see lib/constants/departments.
        label: gradeLabel(y),
        name: String(y),
        year: y,
        academicYear: selectedTerm || undefined,
        department: selectedDepartment ?? undefined,
        color: '#3B6EF6',
        radius: 70,
      })) as BubbleNode[]
    }

    // Department + semester + grade level are the filter every level below
    // them shares, so it is written once here rather than repeated in the
    // branches under it.
    const inSelectedScope = (n: BubbleNode) => {
      const matchYear = selectedYear === null ? true : (n.year ?? '').toString() === selectedYear.toString()
      const matchDept = selectedDepartment === null ? true : (n.department ?? '') === selectedDepartment
      const matchTerm = selectedTerm === ''
        ? true
        : (n.academicYear ?? UNFILED_TERM) === selectedTerm
      return matchYear && matchDept && matchTerm
    }

    if (hierarchyLevel === 'studios') {
      const scoped = source.filter(inSelectedScope)
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
          academicYear: selectedTerm || undefined,
          department: selectedDepartment ?? undefined,
          count: boards,
          sectionCount: sections,
          color: '#3B6EF6',
          radius: 70,
        })) as BubbleNode[]
    }

    if (hierarchyLevel === 'sections') {
      return source.filter(n => {
        if (!inSelectedScope(n)) return false
        if (selectedStudio === null) return true
        return (n.studio ?? UNFILED_STUDIO) === selectedStudio
      })
    }

    return source
  }, [roomDrillWorkspace, hierarchyLevel, searchQuery, searchFilteredNodes, selectedYear, selectedDepartment, selectedStudio, selectedTerm])

  /**
   * The levels reached so far, in order — what the header pill prints.
   *
   * Title case throughout, matching every other level label in the product.
   */
  const trail = useMemo(() => {
    const levels: { label: string; level: HierarchyLevel }[] = [
      { label: 'Department', level: 'departments' },
      { label: 'Semester', level: 'semesters' },
      { label: 'Grade Level', level: 'years' },
      { label: 'Class', level: 'studios' },
      { label: 'Section', level: 'sections' },
    ]
    const depth: Record<HierarchyLevel, number> = {
      departments: 1,
      semesters: 2,
      years: 3,
      studios: 4,
      sections: 5,
    }
    return levels.slice(0, depth[hierarchyLevel])
  }, [hierarchyLevel])

  /**
   * Jump straight to a level in the trail, the way a path bar works.
   *
   * Going UP clears every selection below the target — staying on 'Class' while
   * jumping back to 'Department' would leave the page filtered by a class you
   * are no longer looking at, which is the bug that makes breadcrumbs feel
   * haunted. Nothing here can go DOWN: the trail only ever shows levels already
   * reached, so the target is always at or above the current one.
   */
  const goToLevel = (level: HierarchyLevel) => {
    setRoomDrillWorkspace(null)
    setSearchQuery('')
    if (level === 'departments') setSelectedDepartment(null)
    if (level === 'departments' || level === 'semesters') setSelectedTerm('')
    if (level === 'departments' || level === 'semesters' || level === 'years') setSelectedYear(null)
    if (level !== 'sections') setSelectedStudio(null)
    setHierarchyLevel(level)
  }

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
                placeholder="Search by space, instructor, or student…"
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setRoomDrillWorkspace(null) }}
                className="w-full px-3 py-2 rounded-lg bg-white/80 border border-[#16181D]/[0.12] text-[#16181D] placeholder-[#8A8FA0] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B6EF6] focus:border-transparent"
                aria-label="Search spaces by name, instructor, or student"
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
              the pair did.

              The path is now the levels you have ACTUALLY REACHED, not the
              whole map. Printing all five up front named four places you had
              not been and could not click, which reads as broken navigation
              rather than as an itinerary; at the top of the drill-down it
              simply says "Department", and each level you open appends itself.
            */}
            {/* A path bar, not a label. Every level named in it is somewhere
                you have been, so every level in it is somewhere you can click
                back to — the same contract a file explorer's path has. The
                LAST crumb is where you already are and is rendered inert
                rather than as a button that does nothing. */}
            <div className="flex items-center gap-2 sm:gap-3">
              <nav
                aria-label="Drill-down path"
                className="flex items-center rounded-full bg-white border border-[#16181D]/[0.12] px-2 py-1 text-sm"
              >
                <button
                  onClick={() => goToLevel('departments')}
                  title="Back to all departments"
                  className="sm:hidden px-2 py-1 rounded-full text-[#16181D] font-medium hover:bg-[#F4F6FB] transition-colors"
                >
                  Departments
                </button>
                {trail.map((crumb, i) => {
                  const isCurrent = i === trail.length - 1
                  return (
                    <span key={crumb.level} className="hidden sm:flex items-center">
                      {i > 0 && <span aria-hidden className="px-1 text-[#A8ADBA]">→</span>}
                      {isCurrent ? (
                        <span aria-current="page" className="px-2 py-1 font-semibold text-[#16181D]">
                          {crumb.label}
                        </span>
                      ) : (
                        <button
                          onClick={() => goToLevel(crumb.level)}
                          title={`Back to ${crumb.label}`}
                          className="px-2 py-1 rounded-full text-[#5A5E6B] font-medium hover:bg-[#F4F6FB] hover:text-[#16181D] transition-colors"
                        >
                          {crumb.label}
                        </button>
                      )}
                    </span>
                  )
                })}
              </nav>
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

      {/* Full Canvas Bubble Network or empty state */}
      {(() => {
        const headerHeight = measuredHeaderHeight
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
          had no way back at all — you got to the class list and your only
          exit was the mode button, which resets to the top. That was survivable
          at three levels and is not at five, so the pill now walks the whole
          stack: rooms → sections → classes → grade levels → semesters →
          departments.

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
                    label: selectedStudio ?? 'Class',
                    go: () => { setSelectedStudio(null); setHierarchyLevel('studios') },
                  }
                : hierarchyLevel === 'studios'
                  ? {
                      label: selectedYear !== null ? gradeLabel(selectedYear) : 'Grade Level',
                      go: () => { setSelectedYear(null); setHierarchyLevel('years') },
                    }
                  : hierarchyLevel === 'years'
                    ? {
                        label: selectedTerm || 'Semester',
                        go: () => { setSelectedTerm(''); setHierarchyLevel('semesters') },
                      }
                    : hierarchyLevel === 'semesters'
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
            style={{ top: measuredHeaderHeight + 12 }}
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
