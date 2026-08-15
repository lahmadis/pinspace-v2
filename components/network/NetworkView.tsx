'use client'

import { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import { useRouter } from 'next/navigation'
import { School } from '@/types'
import { getYearsBySchool, getStudiosByYear } from '@/lib/mockData'

interface NetworkNode {
  id: string
  type: 'school' | 'year' | 'studio'
  label: string
  data: unknown
  x?: number
  y?: number
  radius: number
  color: string
}

interface NetworkViewProps {
  schools: School[]
  selectedSchool: School | null
  selectedYear: string | null
  selectedStudio: string | null
  onSelectSchool: (school: School) => void
  onSelectYear: (yearId: string) => void
  onSelectStudio: (studioId: string) => void
}

export default function NetworkView({ schools, selectedSchool, selectedYear, onSelectSchool, onSelectYear }: NetworkViewProps) {
  const router = useRouter()
  const containerRef = useRef<HTMLDivElement>(null)
  const [nodes, setNodes] = useState<NetworkNode[]>([])
  const [dimensions, setDimensions] = useState({ width: 900, height: 640 })

  useEffect(() => {
    const updateDimensions = () => {
      if (!containerRef.current) return
      setDimensions({ width: containerRef.current.clientWidth || 900, height: containerRef.current.clientHeight || 640 })
    }
    updateDimensions()
    const observer = new ResizeObserver(updateDimensions)
    if (containerRef.current) observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let nextNodes: NetworkNode[]
    if (!selectedSchool) {
      nextNodes = schools.map((school) => ({ id: school.id, type: 'school', label: school.abbreviation, data: school, radius: 72, color: school.color || 'rgb(var(--color-primary))' }))
    } else if (!selectedYear) {
      nextNodes = getYearsBySchool(selectedSchool.id).map((year) => ({ id: year.id, type: 'year', label: `Year ${year.year} · ${year.semester}`, data: year, radius: 60, color: 'rgb(var(--color-primary))' }))
    } else {
      nextNodes = getStudiosByYear(selectedYear).map((studio) => ({ id: studio.id, type: 'studio', label: studio.name, data: studio, radius: 68, color: 'rgb(var(--color-secondary))' }))
    }
    const simulation = d3.forceSimulation(nextNodes)
      .force('charge', d3.forceManyBody().strength(80))
      .force('center', d3.forceCenter(dimensions.width / 2, dimensions.height / 2))
      .force('collision', d3.forceCollide<NetworkNode>().radius((node) => node.radius + 24))
      .stop()
    for (let index = 0; index < 240; index += 1) simulation.tick()
    queueMicrotask(() => setNodes(nextNodes))
  }, [dimensions, schools, selectedSchool, selectedYear])

  const selectNode = (node: NetworkNode) => {
    if (node.type === 'school') onSelectSchool(node.data as School)
    else if (node.type === 'year') onSelectYear(node.id)
    else router.push(`/studio/${node.id}/view`)
  }

  return (
    <section ref={containerRef} aria-label="Network directory" className="relative min-h-[38rem] w-full overflow-hidden rounded-kova-lg bg-kova-forest text-white">
      {(selectedSchool || selectedYear) && (
        <button type="button" onClick={() => selectedYear ? onSelectYear(null as unknown as string) : onSelectSchool(null as unknown as School)} className="absolute left-4 top-4 z-20 min-h-11 rounded-kova border border-white/25 bg-kova-forest/90 px-4 py-2 text-sm font-semibold hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">← Back one level</button>
      )}
      <div role="img" aria-label={`Network map with ${nodes.length} items. Items are also available as keyboard buttons.`} className="absolute inset-0 opacity-20" style={{ backgroundImage: 'linear-gradient(to right, rgb(var(--color-paper) / 0.35) 1px, transparent 1px), linear-gradient(to bottom, rgb(var(--color-paper) / 0.35) 1px, transparent 1px)', backgroundSize: '60px 60px' }} />
      <ul className="absolute inset-0">
        {nodes.map((node) => {
          const width = Math.min(176, Math.max(112, node.radius * 2))
          const left = Math.max(8, Math.min(dimensions.width - width - 8, (node.x ?? dimensions.width / 2) - width / 2))
          const top = Math.max(72, Math.min(dimensions.height - width - 8, (node.y ?? dimensions.height / 2) - width / 2))
          return (
            <li key={node.id} className="absolute" style={{ left, top, width, height: width }}>
              <button type="button" onClick={() => selectNode(node)} aria-label={`Open ${node.label}`} className="flex h-full w-full items-center justify-center rounded-full border-2 border-white/55 p-4 text-center text-sm font-bold text-kova-ink shadow-[var(--shadow-soft)] transition-transform hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-kova-forest motion-reduce:transform-none" style={{ backgroundColor: node.color }}>
                <span className="break-words">{node.label}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
