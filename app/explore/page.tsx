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
}


function ExplorePageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [nodes, setNodes] = useState<BubbleNode[]>([])
  const [totalStudios, setTotalStudios] = useState(0)
  const [totalStudents, setTotalStudents] = useState(0)

  type ViewMode = 'flat' | 'hierarchy'
  type HierarchyLevel = 'years' | 'departments' | 'studios'

  const [viewMode, setViewMode] = useState<ViewMode>('flat')
  const [hierarchyLevel, setHierarchyLevel] = useState<HierarchyLevel>('years')
  const [selectedYear, setSelectedYear] = useState<string | number | null>(null)
  const [selectedDepartment, setSelectedDepartment] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedAcademicYear, setSelectedAcademicYear] = useState<string>(currentAcademicYear())
  const [availableAcademicYears, setAvailableAcademicYears] = useState<{ year: string; count: number }[]>([])

  const isDemo = searchParams?.get('demo') === 'true'

  // Institution switcher state
  const [activeInstitution, setActiveInstitution] = useState<string | null>(() => {
    return searchParams?.get('institution') ?? null
  })
  const [institutions, setInstitutions] = useState<{ id: string; name: string; slug: string; network_label?: string }[]>([])

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

  // Persist institution so other pages (Dashboard, etc.) can link "home" to this institution
  useEffect(() => {
    if (typeof window !== 'undefined' && activeInstitution) {
      window.sessionStorage.setItem('pinspace_institution', activeInstitution)
    }
  }, [activeInstitution])

  // On mount: initialize activeInstitution from URL or sessionStorage
  useEffect(() => {
    const urlInst = searchParams?.get('institution') ?? null
    if (urlInst) {
      setActiveInstitution(urlInst)
    } else if (typeof window !== 'undefined') {
      // Don't auto-restore from sessionStorage — start global if no URL param
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch institution list for tab bar
  useEffect(() => {
    if (isDemo) return
    const fetchInstitutions = async () => {
      try {
        const res = await fetch('/api/institutions', { cache: 'no-store' })
        if (res.ok) {
          const data = await res.json()
          setInstitutions(data.institutions || [])
        }
      } catch (e) {
        console.error(e)
      }
    }
    fetchInstitutions()
  }, [isDemo])

  // Load available academic years for the tab bar
  useEffect(() => {
    if (isDemo) return
    const loadAcademicYears = async () => {
      try {
        const params = new URLSearchParams()
        if (activeInstitution) params.set('institution_slug', activeInstitution)
        const url = `/api/explore/academic-years${params.toString() ? `?${params.toString()}` : ''}`
        const res = await fetch(url, { cache: 'no-store' })
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
  }, [isDemo, activeInstitution])

  useEffect(() => {
    const load = async () => {
      try {
        const params = new URLSearchParams()
        if (isDemo) params.set('demo', 'true')
        if (activeInstitution) params.set('institution_slug', activeInstitution)
        if (!isDemo && selectedAcademicYear) params.set('academic_year', selectedAcademicYear)
        const url = `/api/explore/studios${params.toString() ? `?${params.toString()}` : ''}`
        const res = await fetch(url, { cache: 'no-store' })
        if (res.ok) {
          const data: StudioResponse = await res.json()
          const studios = data.studios || []
          setNodes(studios)
          setTotalStudios(data.totals?.studios ?? 0)
          setTotalStudents(data.totals?.students ?? 0)
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
  }, [isDemo, activeInstitution, selectedAcademicYear, router])

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
              href={activeInstitution ? `/i/${activeInstitution}` : '/'}
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
          
          {/* Right: My Boards */}
          <div className="flex items-center justify-end min-w-0 flex-1">
            <Link 
              href="/dashboard" 
              className="text-sm px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-800 transition-colors shrink-0"
            >
              My Boards
            </Link>
          </div>
        </div>
      </header>

      {/* Institution Switcher Tab Bar */}
      {!isDemo && institutions.length > 0 && (
        <div className="fixed top-[57px] left-0 right-0 z-[31] bg-slate-900/95 border-b border-slate-700/30 px-6 py-2 flex items-center gap-2 overflow-x-auto">
          <button
            onClick={() => setActiveInstitution(null)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              activeInstitution === null
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-600'
            }`}
          >
            🌍 All Schools
          </button>
          {institutions.map((inst) => (
            <button
              key={inst.slug}
              onClick={() => setActiveInstitution(inst.slug)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                activeInstitution === inst.slug
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-600'
              }`}
            >
              {inst.network_label || inst.name}
            </button>
          ))}
        </div>
      )}

      {/* Academic Year Tab Bar */}
      {!isDemo && availableAcademicYears.length > 0 && (
        <div className={`fixed ${!isDemo && institutions.length > 0 ? 'top-[101px]' : 'top-[57px]'} left-0 right-0 z-30 bg-slate-900/95 border-b border-slate-700/50 px-6 py-2 flex items-center gap-2 overflow-x-auto`}>
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
        const hasInstBar = !isDemo && institutions.length > 0
        const hasYearBar = !isDemo && availableAcademicYears.length > 0
        const headerHeight = 57 + (hasInstBar ? 44 : 0) + (hasYearBar ? 44 : 0)
        return displayedNodes.length === 0 ? (
          <div
            className="flex items-center justify-center"
            style={{ height: '100vh', paddingTop: headerHeight }}
          >
            <div className="text-center">
              <p className="text-slate-400 text-xl font-medium">No studios yet</p>
              <p className="text-slate-500 text-sm mt-2">
                {!isDemo && selectedAcademicYear
                  ? `No published studios for ${selectedAcademicYear}`
                  : activeInstitution
                    ? 'No published studios found for this institution'
                    : 'No globally published studios found'}
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
