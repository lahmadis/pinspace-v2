'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import BubbleNetwork, { BubbleNode } from '@/components/network/BubbleNetwork'
import DemoBanner from '@/components/DemoBanner'
import { prefetchStudioView } from '@/lib/studioViewCache'
import { currentAcademicYear } from '@/lib/academicYear'

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
  const [selectedAcademicYear, setSelectedAcademicYear] = useState<string>(currentAcademicYear())
  const [availableAcademicYears, setAvailableAcademicYears] = useState<{ year: string; count: number }[]>([])
  const [roomPickerNode, setRoomPickerNode] = useState<BubbleNode | null>(null)

  const isDemo = searchParams?.get('demo') === 'true'

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
        const res = await fetch('/api/explore/academic-years', { cache: 'no-store' })
        if (res.ok) {
          const data = await res.json()
          setAvailableAcademicYears(data.academicYears || [])
          // Default to current year if available, otherwise first available
          const current = currentAcademicYear()
          const years: { year: string; count: number }[] = data.academicYears || []
          const hasCurrentYear = years.some((y: { year: string }) => y.year === current)
          if (!hasCurrentYear && years.length > 0) {
            setSelectedAcademicYear(years[0].year)
          }
        }
      } catch (e) {
        console.error(e)
      }
    }
    loadAcademicYears()
  }, [isDemo])

  useEffect(() => {
    const load = async () => {
      try {
        const params = new URLSearchParams()
        if (isDemo) params.set('demo', 'true')
        if (!isDemo && selectedAcademicYear) params.set('academic_year', selectedAcademicYear)
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
  }, [isDemo, selectedAcademicYear, router])

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

    if (viewMode === 'flat') {
      // Multi-room workspace: show picker
      if (node.publishedRooms && node.publishedRooms.length > 1) {
        setRoomPickerNode(node)
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
      if (node.url) {
        const url = node.url.includes('?') ? `${node.url}&demo=true` : `${node.url}${demoParam}`
        router.push(url)
      }
    }
  }

  const displayedNodes = useMemo(() => {
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
  }, [viewMode, hierarchyLevel, searchFilteredNodes, selectedYear, selectedDepartment])

  return (
    <div className="min-h-screen bg-slate-900">
      <DemoBanner />
      {/* Floating Header */}
      <header className={`fixed ${isDemo ? 'top-12' : 'top-0'} left-0 right-0 z-40 border-b border-slate-700/50 bg-slate-900/90 backdrop-blur-md`}>
        <div className="max-w-full px-6 py-3 flex items-center justify-between gap-4">
          {/* Left: logo + title */}
          <div className="flex items-center gap-4 min-w-0 flex-1 justify-start">
            <Link
              href="/"
              className="text-xl font-bold text-white hover:text-indigo-400 transition-colors shrink-0"
            >
              PinSpace
            </Link>
            <div className="h-5 w-px bg-slate-600 shrink-0" />
            <div className="min-w-0">
              <h1 className="text-lg font-semibold text-white">Studio Network</h1>
              <p className="text-xs text-slate-400">{totalStudios} studios • {totalStudents} students</p>
            </div>
          </div>

          {/* Center: search + All Studios + Drill-down */}
          <div className="flex items-center gap-3 shrink-0">
            <input
              type="search"
              placeholder="Search by studio name or professor…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-80 min-w-[18rem] px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              aria-label="Search studios by name or professor"
            />
            <button
              onClick={() => {
                setViewMode('flat')
                setHierarchyLevel('years')
                setSelectedYear(null)
                setSelectedDepartment(null)
              }}
              className={`px-4 py-2 text-sm rounded-lg border transition-colors shrink-0 ${
                viewMode === 'flat'
                  ? 'bg-indigo-600 text-white border-indigo-500'
                  : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700'
              }`}
            >
              All Studios
            </button>
            <button
              onClick={() => {
                setViewMode('hierarchy')
                setHierarchyLevel('years')
                setSelectedYear(null)
                setSelectedDepartment(null)
              }}
              className={`px-4 py-2 text-sm rounded-lg border transition-colors shrink-0 ${
                viewMode === 'hierarchy'
                  ? 'bg-indigo-600 text-white border-indigo-500'
                  : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700'
              }`}
            >
              Drill-down (Year → Dept → Studio)
            </button>
          </div>
          
          <div className="flex items-center justify-end min-w-0 flex-1">
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
            onClick={() => setSelectedAcademicYear('')}
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
              onClick={() => setSelectedAcademicYear(year)}
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
        const headerHeight = 57 + (hasYearBar ? 44 : 0)
        return displayedNodes.length === 0 ? (
          <div
            className="flex items-center justify-center"
            style={{ height: '100vh', paddingTop: headerHeight }}
          >
            <div className="text-center">
              <p className="text-slate-400 text-xl font-medium">No studios yet</p>
              <p className="text-slate-500 text-sm mt-2">
                {!isDemo && !hasOrg
                  ? "We couldn't find studios for your institution. Contact support if this seems wrong."
                  : !isDemo && selectedAcademicYear
                    ? `No published studios for ${selectedAcademicYear}`
                    : 'No published studios found for your institution'}
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

      {/* Room picker — shown when a multi-room workspace bubble is clicked */}
      {roomPickerNode && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
          onClick={() => setRoomPickerNode(null)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl max-w-sm w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-gray-900 mb-1">{roomPickerNode.name}</h2>
            {roomPickerNode.instructor && (
              <p className="text-sm text-gray-500 mb-4">{roomPickerNode.instructor}</p>
            )}
            <p className="text-sm font-medium text-gray-700 mb-3">Choose a room to view:</p>
            <div className="space-y-2">
              {(roomPickerNode.publishedRooms ?? []).map((room) => (
                <button
                  key={room.id}
                  onClick={() => {
                    setRoomPickerNode(null)
                    const demoParam = isDemo ? '?demo=true' : ''
                    router.push(`/studio/${room.id}/view${demoParam}`)
                  }}
                  className="w-full text-left px-4 py-3 rounded-lg border border-gray-200 hover:border-indigo-400 hover:bg-indigo-50 transition-colors text-sm font-medium text-gray-900"
                >
                  {room.name}
                </button>
              ))}
            </div>
            <button
              onClick={() => setRoomPickerNode(null)}
              className="mt-4 w-full px-4 py-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
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
