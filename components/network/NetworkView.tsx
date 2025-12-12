'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import * as d3 from 'd3'
import { School } from '@/types'
import { getYearsBySchool, getStudiosByYear } from '@/lib/sampleData'

interface NetworkNode {
  id: string
  type: 'school' | 'year' | 'studio'
  label: string
  data: any
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

export default function NetworkView({
  schools,
  selectedSchool,
  selectedYear,
  selectedStudio,
  onSelectSchool,
  onSelectYear,
  onSelectStudio,
}: NetworkViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [nodes, setNodes] = useState<NetworkNode[]>([])
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })

  // Update dimensions on mount and resize
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        })
      }
    }

    updateDimensions()
    window.addEventListener('resize', updateDimensions)
    return () => window.removeEventListener('resize', updateDimensions)
  }, [])

  // Generate nodes based on selection state
  useEffect(() => {
    if (dimensions.width === 0) return

    let newNodes: NetworkNode[] = []

    if (!selectedSchool) {
      // Show all schools as bubbles
      newNodes = schools.map((school) => ({
        id: school.id,
        type: 'school' as const,
        label: school.abbreviation,
        data: school,
        radius: 80,
        color: school.color || '#6366f1',
      }))
    } else if (!selectedYear) {
      // Show years for selected school
      const years = getYearsBySchool(selectedSchool.id)
      newNodes = years.map((year) => ({
        id: year.id,
        type: 'year' as const,
        label: `Year ${year.year}\n${year.semester}`,
        data: year,
        radius: 60,
        color: '#ec4899',
      }))
    } else {
      // Show studios for selected year
      const studios = getStudiosByYear(selectedYear)
      newNodes = studios.map((studio) => ({
        id: studio.id,
        type: 'studio' as const,
        label: studio.name,
        data: studio,
        radius: 70,
        color: '#8b5cf6',
      }))
    }

    // Run D3 force simulation to position nodes
    const simulation = d3
      .forceSimulation(newNodes as any)
      .force('charge', d3.forceManyBody().strength(100))
      .force('center', d3.forceCenter(dimensions.width / 2, dimensions.height / 2))
      .force('collision', d3.forceCollide().radius((d: any) => d.radius + 20))
      .stop()

    // Run simulation
    for (let i = 0; i < 300; ++i) simulation.tick()

    setNodes(newNodes)
  }, [schools, selectedSchool, selectedYear, dimensions])

  const handleNodeClick = (node: NetworkNode) => {
    if (node.type === 'school') {
      onSelectSchool(node.data)
    } else if (node.type === 'year') {
      onSelectYear(node.id)
    } else if (node.type === 'studio') {
      // Navigate to 3D room view (view mode for public network)
      window.location.href = `/studio/${node.id}/view`
    }
  }

  const handleBack = () => {
    if (selectedYear) {
      onSelectYear(null as any)
    } else if (selectedSchool) {
      onSelectSchool(null as any)
    }
  }

  return (
    <div ref={containerRef} className="w-full h-screen relative">
      {/* Back button */}
      {(selectedSchool || selectedYear) && (
        <motion.button
          initial={{ x: -100, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          className="fixed left-6 top-24 bg-white border border-border rounded-full p-3 hover:bg-background-lighter transition-colors z-10 shadow-md"
          onClick={handleBack}
        >
          <svg
            className="w-6 h-6 text-text-primary"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10 19l-7-7m0 0l7-7m-7 7h18"
            />
          </svg>
        </motion.button>
      )}

      {/* Network nodes */}
      <svg className="w-full h-full absolute inset-0">
        <AnimatePresence mode="wait">
          {nodes.map((node, i) => (
            <motion.g
              key={node.id}
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0 }}
              transition={{ delay: i * 0.05, duration: 0.5 }}
            >
              {/* Subtle shadow effect */}
              <circle
                cx={node.x}
                cy={node.y}
                r={node.radius + 3}
                fill={node.color}
                opacity="0.15"
                className="blur-sm"
              />
              
              {/* Main circle */}
              <circle
                cx={node.x}
                cy={node.y}
                r={node.radius}
                fill={node.color}
                stroke="#ffffff"
                strokeWidth="2"
                opacity="0.95"
                className="cursor-pointer transition-all hover:opacity-100 hover:stroke-[3]"
                onClick={() => handleNodeClick(node)}
                style={{
                  filter: 'drop-shadow(0 4px 12px rgba(0, 0, 0, 0.15))',
                }}
              />

              {/* Label */}
              <text
                x={node.x}
                y={node.y}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="white"
                fontSize={node.type === 'school' ? '20' : '14'}
                fontWeight="600"
                className="pointer-events-none"
                style={{ userSelect: 'none' }}
              >
                {node.label.split('\n').map((line, i) => (
                  <tspan key={i} x={node.x} dy={i === 0 ? 0 : 18}>
                    {line}
                  </tspan>
                ))}
              </text>
            </motion.g>
          ))}
        </AnimatePresence>
      </svg>

      {/* Subtle grid background */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.03]">
        <div
          className="w-full h-full"
          style={{
            backgroundImage: `
              linear-gradient(to right, #64748b 1px, transparent 1px),
              linear-gradient(to bottom, #64748b 1px, transparent 1px)
            `,
            backgroundSize: '60px 60px',
          }}
        />
      </div>
    </div>
  )
}
