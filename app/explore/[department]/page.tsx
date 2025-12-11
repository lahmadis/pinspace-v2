'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { notFound, useSearchParams, useRouter } from 'next/navigation'
import BubbleNetwork, { BubbleNode } from '@/components/network/BubbleNetwork'

const DEPT_MAP: Record<string, { name: string; color: string; accent: string }> = {
  'architecture': { name: 'Architecture', color: '#6366f1', accent: 'text-indigo-600' },
  'interior-design': { name: 'Interior Design', color: '#10b981', accent: 'text-emerald-600' },
  'industrial-design': { name: 'Industrial Design', color: '#f59e0b', accent: 'text-orange-600' },
}

const YEAR_COLORS: Record<string, string> = {
  'Year 1': '#3B82F6',
  'Year 2': '#60A5FA',
  'Year 3': '#8B5CF6',
  'Year 4': '#A78BFA',
  'Masters': '#EC4899',
}

type YearItem = { year: string; slug: string; studioCount: number }
type StudioItem = {
  id: string
  name: string
  studioId?: string
  memberCount?: number
  members?: any[]
  instructor?: string
  semester?: string
  networkMetadata?: { year?: string }
}

export default function DepartmentPage({ params }: { params: { department: string } }) {
  const meta = DEPT_MAP[params.department]
  if (!meta) return notFound()

  const searchParams = useSearchParams()
  const router = useRouter()
  const viewParam = searchParams.get('view')
  const [viewMode, setViewMode] = useState<'years' | 'all'>(viewParam === 'all' ? 'all' : 'years')

  const [yearNodes, setYearNodes] = useState<BubbleNode[]>([])
  const [years, setYears] = useState<YearItem[]>([])
  const [studioNodes, setStudioNodes] = useState<BubbleNode[]>([])
  const [studios, setStudios] = useState<StudioItem[]>([])
  const [yearFilter, setYearFilter] = useState<string>('All Years')

  // sync URL
  useEffect(() => {
    const current = viewMode === 'all' ? 'all' : null
    const url = new URL(window.location.href)
    if (current) url.searchParams.set('view', 'all')
    else url.searchParams.delete('view')
    router.replace(url.pathname + (url.search ? url.search : ''), { scroll: false })
  }, [viewMode, router])

  // Load years (for years view)
  useEffect(() => {
    const loadYears = async () => {
      try {
        const res = await fetch(`/api/explore/${params.department}/years`, { cache: 'no-store' })
        if (!res.ok) return
        const data: YearItem[] = await res.json()
        setYears(data)
        setYearNodes(data.map((y) => ({
          id: y.slug,
          name: y.year,
          label: y.year,
          count: y.studioCount,
          url: `/explore/${params.department}/${y.slug}`,
          color: YEAR_COLORS[y.year] || meta.color,
          radius: 70,
        })))
      } catch (e) {
        console.error(e)
      }
    }
    loadYears()
  }, [params.department, meta.color])

  // Load all studios for "view all"
  useEffect(() => {
    if (viewMode !== 'all') return
    const loadStudios = async () => {
      try {
        const res = await fetch(`/api/workspaces/public?department=${encodeURIComponent(meta.name)}`, { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json()
        const list: StudioItem[] = data.workspaces || []
        setStudios(list)
      } catch (e) {
        console.error(e)
      }
    }
    loadStudios()
  }, [viewMode, meta.name])

  // Build studio nodes with filters
  useEffect(() => {
    if (viewMode !== 'all') return
    const filtered = studios.filter((s) => {
      if (yearFilter === 'All Years') return true
      return s.networkMetadata?.year === yearFilter
    })

    // Parse year number from "Year X" string
    const parseYear = (yearStr?: string): number | undefined => {
      if (!yearStr) return undefined
      if (yearStr === 'Masters') return 5
      const match = yearStr.match(/Year (\d+)/)
      return match ? parseInt(match[1], 10) : undefined
    }

    setStudioNodes(filtered.map((s) => ({
      id: s.id,
      label: s.name,
      name: s.name,
      count: s.memberCount ?? s.members?.length ?? 0,
      memberCount: s.memberCount ?? s.members?.length ?? 0,
      url: `/studio/${s.studioId || s.id}/view`,
      color: YEAR_COLORS[s.networkMetadata?.year || 'Year 1'] || meta.color,
      radius: 65,
      // Add relationship data
      instructor: s.instructor,
      semester: s.semester,
      year: parseYear(s.networkMetadata?.year),
    })))
  }, [studios, viewMode, yearFilter, meta.color])

  const handleNodeClick = (node: BubbleNode) => {
    if (node.url) window.location.href = node.url
  }

  const uniqueYears = useMemo(() => ['All Years', ...Array.from(new Set(studios.map(s => s.networkMetadata?.year).filter(Boolean)))], [studios])

  // Full screen mode for "View All Studios"
  if (viewMode === 'all') {
    return (
      <div className="min-h-screen bg-slate-900">
        {/* Floating Header */}
        <header className="fixed top-0 left-0 right-0 z-40 border-b border-slate-700/50 bg-slate-900/80 backdrop-blur-md">
          <div className="max-w-full px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setViewMode('years')}
                className="flex items-center gap-2 text-sm text-slate-300 hover:text-white transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                Back to Years
              </button>
              <div className="h-5 w-px bg-slate-600" />
              <div>
                <h1 className="text-lg font-semibold text-white">{meta.name} Network</h1>
                <p className="text-xs text-slate-400">{studioNodes.length} studios</p>
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              {/* Year Filter */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Filter:</span>
                <select
                  value={yearFilter}
                  onChange={(e) => setYearFilter(e.target.value)}
                  className="px-3 py-1.5 bg-slate-800 border border-slate-600 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {uniqueYears.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>

              {/* Year Legend */}
              <div className="hidden md:flex items-center gap-3 text-xs">
                {Object.entries(YEAR_COLORS).map(([year, color]) => (
                  <div key={year} className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                    <span className="text-slate-400">{year}</span>
                  </div>
                ))}
              </div>

              <Link 
                href="/my-boards" 
                className="text-sm px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-800 transition-colors"
              >
                My Boards
              </Link>
            </div>
          </div>
        </header>

        {/* Full Canvas Bubble Network */}
        <BubbleNetwork 
          nodes={studioNodes} 
          onNodeClick={handleNodeClick}
          fullScreen={true}
          headerHeight={73}
        />
      </div>
    )
  }

  // Standard layout for "By Year" view
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100">
      <header className="border-b border-gray-200 bg-white/90 backdrop-blur-sm sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/explore" className="text-sm text-gray-600 hover:text-gray-900">← Back to Explore</Link>
            <div className="text-sm text-gray-500">/</div>
            <div className="text-sm font-semibold text-gray-900">{meta.name}</div>
          </div>
          <Link href="/my-boards" className="text-sm px-4 py-2 rounded-lg border border-gray-200 hover:bg-gray-50">My Boards</Link>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-12 grid grid-cols-1 lg:grid-cols-4 gap-8">
        <div className="lg:col-span-3 space-y-8">
          <div>
            <p className={`text-sm font-semibold uppercase ${meta.accent}`}>Explore / {meta.name}</p>
            <h1 className="text-3xl font-bold text-gray-900 mt-1">{meta.name}</h1>
            <p className="text-gray-600 mt-2">Browse by year or see the full network of studios.</p>
            {(() => {
              const currentMode: 'years' | 'all' = viewMode
              return (
                <div className="mt-4 flex items-center gap-3 text-sm">
                  <span className="text-gray-700 font-semibold">View:</span>
                  <button
                    onClick={() => setViewMode('years')}
                    className={`px-3 py-1 rounded-full border text-sm ${currentMode === 'years' ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                  >
                    By Year
                  </button>
                  <button
                    onClick={() => setViewMode('all')}
                    className={`px-3 py-1 rounded-full border text-sm ${currentMode === 'all' ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                  >
                    View All Studios
                  </button>
                </div>
              )
            })()}
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden" style={{ height: 620 }}>
            <BubbleNetwork nodes={yearNodes} onNodeClick={handleNodeClick} />
          </div>
        </div>

        <aside className="space-y-4">
          <div className="bg-white rounded-2xl shadow p-6 border border-gray-100">
            <div className={`text-sm font-semibold uppercase ${meta.accent}`}>{meta.name} Program</div>
            <h3 className="text-xl font-bold text-gray-900 mt-1">Studios by Year</h3>
            <p className="text-gray-600 text-sm mt-1">WIT Design Network</p>
            <div className="mt-4 space-y-2 text-sm">
              {years.map((y) => (
                <div className="flex justify-between" key={y.slug}>
                  <span className="text-gray-600">{y.year}</span>
                  <span className="text-gray-900 font-semibold">{y.studioCount}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Year Colors Legend */}
          <div className="bg-white rounded-2xl shadow p-6 border border-gray-100">
            <h4 className="text-sm font-semibold text-gray-900 mb-3">Year Colors</h4>
            <div className="space-y-2">
              {Object.entries(YEAR_COLORS).map(([year, color]) => (
                <div key={year} className="flex items-center gap-2 text-sm">
                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                  <span className="text-gray-600">{year}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </main>
    </div>
  )
}
