'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import BubbleNetwork, { BubbleNode } from '@/components/network/BubbleNetwork'

type StudioResponse = {
  studios: BubbleNode[]
  totals: { studios: number; students: number }
}


export default function ExplorePage() {
  const router = useRouter()
  const [nodes, setNodes] = useState<BubbleNode[]>([])
  const [totalStudios, setTotalStudios] = useState(0)
  const [totalStudents, setTotalStudents] = useState(0)

  type ViewMode = 'flat' | 'hierarchy'
  type HierarchyLevel = 'years' | 'departments' | 'studios'

  const [viewMode, setViewMode] = useState<ViewMode>('flat')
  const [hierarchyLevel, setHierarchyLevel] = useState<HierarchyLevel>('years')
  const [selectedYear, setSelectedYear] = useState<string | number | null>(null)
  const [selectedDepartment, setSelectedDepartment] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/explore/studios', { cache: 'no-store' })
        if (res.ok) {
          const data: StudioResponse = await res.json()
          setNodes(data.studios || [])
          setTotalStudios(data.totals?.studios ?? 0)
          setTotalStudents(data.totals?.students ?? 0)
        }
      } catch (e) {
        console.error(e)
      }
    }
    load()
  }, [])

  const handleClick = (node: BubbleNode) => {
    if (viewMode === 'flat') {
      if (node.url) router.push(node.url)
      return
    }

    if (hierarchyLevel === 'years') {
      setSelectedYear(node.year ?? node.label)
      setHierarchyLevel('departments')
    } else if (hierarchyLevel === 'departments') {
      setSelectedDepartment(node.department || node.label)
      setHierarchyLevel('studios')
    } else {
      if (node.url) router.push(node.url)
    }
  }

  const displayedNodes = useMemo(() => {
    if (viewMode === 'flat') return nodes

    if (hierarchyLevel === 'years') {
      const years = Array.from(new Set(nodes.map(n => n.year ?? 'Unknown')))
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
          nodes
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
      return nodes.filter(n => {
        const matchYear = selectedYear === null ? true : (n.year ?? '').toString() === selectedYear.toString()
        const matchDept = selectedDepartment === null ? true : (n.department ?? '') === selectedDepartment
        return matchYear && matchDept
      })
    }

    return nodes
  }, [viewMode, hierarchyLevel, nodes, selectedYear, selectedDepartment])

  return (
    <div className="min-h-screen bg-slate-900">
      {/* Floating Header */}
      <header className="fixed top-0 left-0 right-0 z-40 border-b border-slate-700/50 bg-slate-900/90 backdrop-blur-md">
        <div className="max-w-full px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link 
              href="/"
              className="text-xl font-bold text-white hover:text-indigo-400 transition-colors"
            >
              PinSpace
            </Link>
            <div className="h-5 w-px bg-slate-600" />
            <div>
              <h1 className="text-lg font-semibold text-white">Studio Network</h1>
              <p className="text-xs text-slate-400">{totalStudios} studios • {totalStudents} students</p>
            </div>
          </div>
          
          {/* View Mode Toggle */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                setViewMode('flat')
                setHierarchyLevel('years')
                setSelectedYear(null)
                setSelectedDepartment(null)
              }}
              className={`px-4 py-2 text-sm rounded-lg border transition-colors ${
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
              className={`px-4 py-2 text-sm rounded-lg border transition-colors ${
                viewMode === 'hierarchy'
                  ? 'bg-indigo-600 text-white border-indigo-500'
                  : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700'
              }`}
            >
              Drill-down (Year → Dept → Studio)
            </button>
          </div>
          
          <div className="flex items-center gap-3">
            <Link 
              href="/dashboard" 
              className="text-sm px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-800 transition-colors"
            >
              My Boards
            </Link>
          </div>
        </div>
      </header>

      {/* Full Canvas Bubble Network */}
      <BubbleNetwork 
        nodes={displayedNodes} 
        onNodeClick={handleClick}
        fullScreen={true}
        headerHeight={65}
      />

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
