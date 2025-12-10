'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import BubbleNetwork, { BubbleNode } from '@/components/network/BubbleNetwork'

const DEPT_MAP: Record<string, { name: string; color: string; accent: string }> = {
  'architecture': { name: 'Architecture', color: '#6366f1', accent: 'text-indigo-600' },
  'interior-design': { name: 'Interior Design', color: '#10b981', accent: 'text-emerald-600' },
  'industrial-design': { name: 'Industrial Design', color: '#f59e0b', accent: 'text-orange-600' },
}

const YEAR_MAP: Record<string, { label: string; num: number }> = {
  'year-1': { label: 'Year 1', num: 1 },
  'year-2': { label: 'Year 2', num: 2 },
  'year-3': { label: 'Year 3', num: 3 },
  'year-4': { label: 'Year 4', num: 4 },
  'masters': { label: 'Masters', num: 5 },
}

const YEAR_COLORS: Record<string, string> = {
  'Year 1': '#3B82F6',
  'Year 2': '#60A5FA',
  'Year 3': '#8B5CF6',
  'Year 4': '#A78BFA',
  'Masters': '#EC4899',
}

export default function YearPage({ params }: { params: { department: string; year: string } }) {
  const deptMeta = DEPT_MAP[params.department]
  if (!deptMeta) return notFound()

  const yearInfo = YEAR_MAP[params.year]
  if (!yearInfo) return notFound()
  
  const yearLabel = yearInfo.label
  const yearNum = yearInfo.num

  const [nodes, setNodes] = useState<BubbleNode[]>([])
  const [studioCount, setStudioCount] = useState(0)
  const [isFullScreen, setIsFullScreen] = useState(false)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`/api/workspaces/public?department=${encodeURIComponent(deptMeta.name)}&year=${encodeURIComponent(yearLabel)}`, { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json()
        const studios: any[] = data.workspaces || []
        setStudioCount(studios.length)
        setNodes(studios.map((studio) => ({
          id: studio.id,
          label: studio.name,
          name: studio.name,
          count: studio.memberCount ?? studio.members?.length ?? 0,
          memberCount: studio.memberCount ?? studio.members?.length ?? 0,
          url: `/studio/${studio.studioId || studio.id}/view`,
          color: YEAR_COLORS[yearLabel] || deptMeta.color,
          radius: 65,
          // Relationship data
          instructor: studio.instructor,
          semester: studio.semester,
          year: yearNum,
        })))
      } catch (e) {
        console.error(e)
      }
    }
    load()
  }, [deptMeta.name, deptMeta.color, yearLabel, yearNum])

  const handleClick = (node: BubbleNode) => {
    if (node.url) window.location.href = node.url
  }

  // Full screen mode
  if (isFullScreen) {
    return (
      <div className="min-h-screen bg-slate-900">
        {/* Floating Header */}
        <header className="fixed top-0 left-0 right-0 z-40 border-b border-slate-700/50 bg-slate-900/80 backdrop-blur-md">
          <div className="max-w-full px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setIsFullScreen(false)}
                className="flex items-center gap-2 text-sm text-slate-300 hover:text-white transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Exit Full Screen
              </button>
              <div className="h-5 w-px bg-slate-600" />
              <div>
                <h1 className="text-lg font-semibold text-white">{deptMeta.name} - {yearLabel}</h1>
                <p className="text-xs text-slate-400">{studioCount} studios</p>
              </div>
            </div>
            
            <Link 
              href="/my-boards" 
              className="text-sm px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-800 transition-colors"
            >
              My Boards
            </Link>
          </div>
        </header>

        {/* Full Canvas Bubble Network */}
        <BubbleNetwork 
          nodes={nodes} 
          onNodeClick={handleClick}
          fullScreen={true}
          headerHeight={73}
        />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100">
      <header className="border-b border-gray-200 bg-white/90 backdrop-blur-sm sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href={`/explore/${params.department}`} className="text-sm text-gray-600 hover:text-gray-900">← Back</Link>
            <div className="text-sm text-gray-500">/</div>
            <div className="text-sm font-semibold text-gray-900">{deptMeta.name}</div>
            <div className="text-sm text-gray-500">/</div>
            <div className="text-sm font-semibold text-gray-900">{yearLabel}</div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsFullScreen(true)}
              className="text-sm px-4 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
              </svg>
              Full Screen
            </button>
          <Link href="/my-boards" className="text-sm px-4 py-2 rounded-lg border border-gray-200 hover:bg-gray-50">My Boards</Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-12 grid grid-cols-1 lg:grid-cols-4 gap-8">
        <div className="lg:col-span-3 space-y-8">
          <div>
            <p className={`text-sm font-semibold uppercase ${deptMeta.accent}`}>Explore / {deptMeta.name} / {yearLabel}</p>
            <h1 className="text-3xl font-bold text-gray-900 mt-1">{deptMeta.name} - {yearLabel}</h1>
            <p className="text-gray-600 mt-2">{studioCount} {studioCount === 1 ? 'studio' : 'studios'}</p>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden" style={{ height: 600 }}>
            {studioCount === 0 ? (
              <div className="h-full flex items-center justify-center">
                <div className="text-center p-10">
                  <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                  </div>
                  <p className="text-gray-500">No studios published in {yearLabel} {deptMeta.name} yet</p>
                </div>
              </div>
            ) : (
              <BubbleNetwork nodes={nodes} onNodeClick={handleClick} />
            )}
          </div>

          {/* Interaction hints */}
          {studioCount > 0 && (
            <div className="flex flex-wrap gap-4 text-xs text-gray-500">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
                </svg>
                <span>Click bubbles to enter studio</span>
              </div>
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11" />
                </svg>
                <span>Drag to pan, scroll to zoom</span>
              </div>
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
                <span>Hover to see connections</span>
              </div>
            </div>
          )}
        </div>

        <aside className="space-y-4">
          <div className="bg-white rounded-2xl shadow p-6 border border-gray-100">
            <div className={`text-sm font-semibold uppercase ${deptMeta.accent}`}>{deptMeta.name} Program</div>
            <h3 className="text-xl font-bold text-gray-900 mt-1">{yearLabel}</h3>
            <p className="text-gray-600 text-sm mt-1">WIT Design Network</p>
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Studios</span>
                <span className="text-gray-900 font-semibold">{studioCount}</span>
              </div>
            </div>
          </div>

          {/* Connection Legend */}
          <div className="bg-white rounded-2xl shadow p-6 border border-gray-100">
            <h4 className="text-sm font-semibold text-gray-900 mb-3">Connection Types</h4>
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-3">
                <div className="w-8 h-0.5 bg-blue-500 rounded" />
                <span className="text-gray-600">Same Instructor</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-0.5 rounded" style={{ background: 'repeating-linear-gradient(90deg, #8B5CF6, #8B5CF6 3px, transparent 3px, transparent 6px)' }} />
                <span className="text-gray-600">Same Year</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-0.5 rounded" style={{ background: 'repeating-linear-gradient(90deg, #10B981, #10B981 4px, transparent 4px, transparent 8px)' }} />
                <span className="text-gray-600">Same Semester</span>
              </div>
            </div>
            <p className="mt-4 text-xs text-gray-400">Hover over a studio bubble to see its connections to other studios.</p>
          </div>
        </aside>
      </main>
    </div>
  )
}
