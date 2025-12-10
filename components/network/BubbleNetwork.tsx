'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import * as d3 from 'd3'

// ============================================================================
// TYPES
// ============================================================================

export interface StudioData {
  id: string
  name: string
  instructor?: string
  semester?: string
  year?: number | string // 1, 2, 3, 4, or Masters
  department?: string // Architecture, Interior Design, Industrial Design
  memberCount?: number
  color?: string
}

export interface BubbleNode extends StudioData {
  label: string
  count?: number
  url?: string
  radius?: number
  // D3 simulation adds these
  x?: number
  y?: number
  vx?: number
  vy?: number
  fx?: number | null
  fy?: number | null
}

interface BubbleNetworkProps {
  nodes: BubbleNode[]
  onNodeClick?: (node: BubbleNode) => void
  fullScreen?: boolean // When true, takes 100vw × 100vh minus header
  headerHeight?: number // Height of header to subtract (default 64px)
}

interface TooltipData {
  node: BubbleNode
  x: number
  y: number
  connections: {
    sameInstructor: BubbleNode[]
    sameYear: BubbleNode[]
    sameDepartment: BubbleNode[]
  }
}

interface ConnectionLine {
  source: BubbleNode
  target: BubbleNode
  type: 'instructor' | 'year' | 'department'
}

// ============================================================================
// CONSTANTS
// ============================================================================

const RELATIONSHIP_STYLES = {
  instructor: {
    color: '#3B82F6', // Blue - solid line
    width: 3,
    dasharray: '', // Solid line
    glowColor: 'rgba(59, 130, 246, 0.6)',
  },
  year: {
    color: '#8B5CF6', // Purple - dashed line
    width: 2.5,
    dasharray: '8,4',
    glowColor: 'rgba(139, 92, 246, 0.5)',
  },
  department: {
    color: '#10B981', // Green - dotted line
    width: 2,
    dasharray: '3,3',
    glowColor: 'rgba(16, 185, 129, 0.4)',
  },
}

const MAX_CONNECTIONS = 15
const HOVER_DEBOUNCE_MS = 100
const BUBBLE_SIZE_MIN = 55
const BUBBLE_SIZE_MAX = 75
const ANIMATION_DURATION = 300

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  return ((...args: Parameters<T>) => {
    if (timeoutId) clearTimeout(timeoutId)
    timeoutId = setTimeout(() => fn(...args), ms)
  }) as T
}

function generateBezierPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): string {
  const midX = (x1 + x2) / 2
  const midY = (y1 + y2) / 2
  const dx = x2 - x1
  const dy = y2 - y1
  const dist = Math.sqrt(dx * dx + dy * dy)
  
  // Create a curved path with control point offset perpendicular to the line
  const curvature = Math.min(dist * 0.15, 50)
  const perpX = -dy / dist * curvature
  const perpY = dx / dist * curvature
  
  const cx = midX + perpX
  const cy = midY + perpY
  
  return `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`
}

// ============================================================================
// TOOLTIP COMPONENT
// ============================================================================

function Tooltip({ data, containerRect }: { data: TooltipData | null; containerRect: DOMRect | null }) {
  if (!data || !containerRect) return null

  const { node, x, y, connections } = data
  const totalConnections = 
    connections.sameInstructor.length + 
    connections.sameYear.length + 
    connections.sameDepartment.length

  // Position tooltip to avoid going off screen
  const tooltipWidth = 280
  const tooltipHeight = 200
  let tooltipX = x + 20
  let tooltipY = y - tooltipHeight / 2

  // Adjust if going off right edge
  if (tooltipX + tooltipWidth > containerRect.width) {
    tooltipX = x - tooltipWidth - 20
  }
  // Adjust if going off bottom
  if (tooltipY + tooltipHeight > containerRect.height) {
    tooltipY = containerRect.height - tooltipHeight - 10
  }
  // Adjust if going off top
  if (tooltipY < 10) {
    tooltipY = 10
  }

  return (
    <div
      className="absolute pointer-events-none z-50 animate-fade-in"
      style={{
        left: tooltipX,
        top: tooltipY,
        width: tooltipWidth,
      }}
    >
      <div className="bg-slate-900/95 backdrop-blur-md rounded-xl border border-slate-700/50 shadow-2xl overflow-hidden">
        {/* Header */}
        <div 
          className="px-4 py-3 border-b border-slate-700/50"
          style={{ backgroundColor: `${node.color}20` }}
        >
          <h3 className="font-bold text-white text-sm truncate">{node.name || node.label}</h3>
          {node.instructor && (
            <p className="text-slate-300 text-xs mt-0.5 flex items-center gap-1">
              <span className="text-slate-400">👤</span> {node.instructor}
            </p>
          )}
        </div>
        
        {/* Details */}
        <div className="px-4 py-3 space-y-2 text-xs">
          <div className="flex justify-between text-slate-300">
            <span className="text-slate-400">Department</span>
            <span className="font-medium">{node.department || '—'}</span>
          </div>
          <div className="flex justify-between text-slate-300">
            <span className="text-slate-400">Year</span>
            <span className="font-medium">
              {node.year ? (node.year === 'Masters' ? 'Masters' : `Year ${node.year}`) : '—'}
            </span>
          </div>
          <div className="flex justify-between text-slate-300">
            <span className="text-slate-400">Members</span>
            <span className="font-medium">{node.memberCount ?? node.count ?? 0}</span>
          </div>
        </div>

        {/* Connections */}
        {totalConnections > 0 && (
          <div className="px-4 py-3 bg-slate-800/50 border-t border-slate-700/30">
            <p className="text-xs text-slate-400 mb-2 flex items-center gap-1">
              <span>🔗</span> Connected to:
            </p>
            <div className="space-y-1 text-xs">
              {connections.sameInstructor.length > 0 && node.instructor && (
                <div className="flex items-center gap-2 text-blue-400">
                  <span className="w-3 h-0.5 bg-blue-400 rounded"></span>
                  <span>{connections.sameInstructor.length} studios ({node.instructor})</span>
                </div>
              )}
              {connections.sameYear.length > 0 && node.year && (
                <div className="flex items-center gap-2 text-purple-400">
                  <span className="w-3 h-0.5 bg-purple-400 rounded" style={{ background: 'repeating-linear-gradient(90deg, #8B5CF6, #8B5CF6 2px, transparent 2px, transparent 4px)' }}></span>
                  <span>{connections.sameYear.length} studios ({node.year === 'Masters' ? 'Masters' : `Year ${node.year}`})</span>
                </div>
              )}
              {connections.sameDepartment.length > 0 && node.department && (
                <div className="flex items-center gap-2 text-emerald-400">
                  <span className="w-3 h-0.5 bg-emerald-400 rounded" style={{ background: 'repeating-linear-gradient(90deg, #10B981, #10B981 2px, transparent 2px, transparent 4px)' }}></span>
                  <span>{connections.sameDepartment.length} studios ({node.department})</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function BubbleNetwork({
  nodes,
  onNodeClick,
  fullScreen = false,
  headerHeight = 64,
}: BubbleNetworkProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const gRef = useRef<SVGGElement>(null)
  
  const [dimensions, setDimensions] = useState({ width: 900, height: 600 })
  const [positions, setPositions] = useState<BubbleNode[]>([])
  const [hoveredNode, setHoveredNode] = useState<BubbleNode | null>(null)
  const [tooltipData, setTooltipData] = useState<TooltipData | null>(null)
  const [connectionLines, setConnectionLines] = useState<ConnectionLine[]>([])
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 })
  const [isDragging, setIsDragging] = useState(false)
  const [isStabilized, setIsStabilized] = useState(false)
  
  const simulationRef = useRef<d3.Simulation<BubbleNode, undefined> | null>(null)
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null)

  // Memoize color scale
  const colorScale = useMemo(() => 
    d3.scaleOrdinal<string>()
      .range(['#6366f1', '#10b981', '#f59e0b', '#8b5cf6', '#14b8a6', '#ef4444', '#3b82f6', '#ec4899']),
    []
  )

  // ============================================================================
  // DIMENSIONS
  // ============================================================================

  useEffect(() => {
    const updateDimensions = () => {
      if (fullScreen) {
        setDimensions({
          width: window.innerWidth,
          height: window.innerHeight - headerHeight,
        })
      } else if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        setDimensions({
          width: rect.width || 900,
          height: rect.height || 600,
        })
      }
    }

    updateDimensions()
    window.addEventListener('resize', updateDimensions)
    return () => window.removeEventListener('resize', updateDimensions)
  }, [fullScreen, headerHeight])

  // ============================================================================
  // FORCE SIMULATION
  // ============================================================================

  useEffect(() => {
    if (!nodes || nodes.length === 0) {
      setPositions([])
      return
    }

    const { width, height } = dimensions
    
    // Reset stabilization state when nodes change
    setIsStabilized(false)

    // Create simulation nodes with initial positions spread across canvas
    const simNodes: BubbleNode[] = nodes.map((n, i) => {
      // Spread nodes across the entire canvas using golden angle distribution
      const goldenAngle = Math.PI * (3 - Math.sqrt(5))
      const angle = i * goldenAngle
      const radius = Math.sqrt(i / nodes.length) * Math.min(width, height) * 0.4
      
      return {
      ...n,
        radius: n.radius ?? Math.max(BUBBLE_SIZE_MIN, Math.min(BUBBLE_SIZE_MAX, (n.count || 10) * 1.5 + 45)),
      color: n.color || colorScale(n.id),
        x: width / 2 + Math.cos(angle) * radius,
        y: height / 2 + Math.sin(angle) * radius,
      }
    })

    // Stop existing simulation
    if (simulationRef.current) {
      simulationRef.current.stop()
    }

    // Create new force simulation
    const simulation = d3.forceSimulation(simNodes)
      .force('charge', d3.forceManyBody()
        .strength(-200) // Negative = repulsion, spread bubbles apart
      )
      .force('center', d3.forceCenter(width / 2, height / 2).strength(0.05))
      .force('collision', d3.forceCollide<BubbleNode>()
        .radius(d => (d.radius || 60) + 15)
        .strength(0.9)
      )
      .force('x', d3.forceX(width / 2).strength(0.02))
      .force('y', d3.forceY(height / 2).strength(0.02))
      .force('bounds', () => {
        // Keep nodes within bounds with padding
        const padding = 80
        for (const node of simNodes) {
          if (node.x !== undefined && node.y !== undefined && node.radius) {
            node.x = Math.max(padding, Math.min(width - padding, node.x))
            node.y = Math.max(padding, Math.min(height - padding, node.y))
          }
        }
      })
      .alphaDecay(0.1) // Very fast stabilization
      .velocityDecay(0.8) // Very high friction
      .alphaMin(0.001)

    simulationRef.current = simulation

    // Update positions on each tick (only while not stabilized)
    simulation.on('tick', () => {
      setPositions([...simNodes])
    })

    // Stop simulation once it has stabilized - FREEZE positions
    simulation.on('end', () => {
      console.log('✅ Simulation stabilized - bubbles now FROZEN')
      // Save final positions
      setPositions([...simNodes])
      setIsStabilized(true)
      // Completely stop the simulation
      simulation.stop()
    })

    // Run simulation
    simulation.alpha(1).restart()

    return () => {
      simulation.stop()
    }
  }, [nodes, dimensions, colorScale])

  // ============================================================================
  // ZOOM & PAN
  // ============================================================================

  useEffect(() => {
    if (!svgRef.current || !gRef.current) return

    const svg = d3.select(svgRef.current)
    const g = d3.select(gRef.current)

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on('zoom', (event) => {
        const { x, y, k } = event.transform
        setTransform({ x, y, k })
        g.attr('transform', `translate(${x},${y}) scale(${k})`)
      })

    svg.call(zoom)
    zoomRef.current = zoom

    // Disable double-click zoom
    svg.on('dblclick.zoom', null)

    return () => {
      svg.on('.zoom', null)
    }
  }, [])

  // ============================================================================
  // RELATIONSHIP CALCULATIONS
  // ============================================================================

  const findConnections = useCallback((node: BubbleNode): ConnectionLine[] => {
    const lines: ConnectionLine[] = []
    
    for (const other of positions) {
      if (other.id === node.id) continue
      
      // Same instructor (highest priority)
      if (node.instructor && other.instructor && 
          node.instructor.toLowerCase() === other.instructor.toLowerCase()) {
        lines.push({ source: node, target: other, type: 'instructor' })
        continue
      }
      
      // Same year
      if (node.year && other.year && node.year === other.year) {
        lines.push({ source: node, target: other, type: 'year' })
        continue
      }
      
      // Same department
      if (node.department && other.department && 
          node.department.toLowerCase() === other.department.toLowerCase()) {
        lines.push({ source: node, target: other, type: 'department' })
      }
    }
    
    // Limit connections and prioritize by type
    const priorityOrder = ['instructor', 'year', 'semester'] as const
    return lines
      .sort((a, b) => priorityOrder.indexOf(a.type) - priorityOrder.indexOf(b.type))
      .slice(0, MAX_CONNECTIONS)
  }, [positions])

  const getRelatedNodes = useCallback((node: BubbleNode) => {
    const sameInstructor: BubbleNode[] = []
    const sameYear: BubbleNode[] = []
    const sameDepartment: BubbleNode[] = []

    for (const other of positions) {
      if (other.id === node.id) continue

      if (node.instructor && other.instructor &&
          node.instructor.toLowerCase() === other.instructor.toLowerCase()) {
        sameInstructor.push(other)
      } else if (node.year && other.year && node.year === other.year) {
        sameYear.push(other)
      } else if (node.department && other.department &&
          node.department.toLowerCase() === other.department.toLowerCase()) {
        sameDepartment.push(other)
      }
    }

    return { sameInstructor, sameYear, sameDepartment }
  }, [positions])

  // ============================================================================
  // HOVER HANDLERS
  // ============================================================================

  const debouncedHover = useMemo(
    () => debounce((node: BubbleNode | null, screenX: number, screenY: number) => {
      if (!node) {
        setHoveredNode(null)
        setTooltipData(null)
        setConnectionLines([])
        return
      }

      setHoveredNode(node)
      const connections = getRelatedNodes(node)
      const lines = findConnections(node)
      
      setConnectionLines(lines)
      setTooltipData({
        node,
        x: screenX,
        y: screenY,
        connections,
      })
    }, HOVER_DEBOUNCE_MS),
    [getRelatedNodes, findConnections]
  )

  const handleMouseEnter = useCallback((node: BubbleNode, event: React.MouseEvent) => {
    if (isDragging) return
    const rect = containerRef.current?.getBoundingClientRect()
    const screenX = (node.x || 0) * transform.k + transform.x
    const screenY = (node.y || 0) * transform.k + transform.y
    debouncedHover(node, screenX, screenY)
  }, [debouncedHover, isDragging, transform])

  const handleMouseLeave = useCallback(() => {
    debouncedHover(null, 0, 0)
  }, [debouncedHover])

  // ============================================================================
  // DRAG HANDLERS
  // ============================================================================

  const handleDragStart = useCallback((node: BubbleNode, event: React.MouseEvent) => {
    event.stopPropagation()
    setIsDragging(true)
    
    // Don't restart simulation - just fix node position for manual dragging
    node.fx = node.x
    node.fy = node.y
  }, [])

  const handleDrag = useCallback((node: BubbleNode, event: React.MouseEvent) => {
    if (!isDragging) return
    
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    
    // Calculate position in simulation space
    const x = (event.clientX - rect.left - transform.x) / transform.k
    const y = (event.clientY - rect.top - transform.y) / transform.k
    
    // Update the node's fixed position
    node.fx = x
    node.fy = y
    node.x = x
    node.y = y
    
    // Update position immediately - no simulation needed
    setPositions(prev => prev.map(n => 
      n.id === node.id ? { ...n, x, y, fx: x, fy: y } : n
    ))
  }, [isDragging, transform])

  const handleDragEnd = useCallback((node: BubbleNode) => {
    setIsDragging(false)
    
    // Keep node at new position permanently
    node.x = node.fx ?? node.x
    node.y = node.fy ?? node.y
    node.fx = null
    node.fy = null
    
    // Update final position in state
    setPositions(prev => prev.map(n => 
      n.id === node.id ? { ...n, x: node.x, y: node.y, fx: null, fy: null } : n
    ))
  }, [])

  // ============================================================================
  // NODE STYLING
  // ============================================================================

  const getNodeStyle = useCallback((node: BubbleNode) => {
    // NO SCALE CHANGES - bubbles stay exactly where they are
    if (!hoveredNode) {
      return {
        opacity: 1,
        filter: '',
        strokeColor: 'rgba(255,255,255,0.3)',
        strokeWidth: 2,
      }
    }

    if (node.id === hoveredNode.id) {
      return {
        opacity: 1,
        filter: `drop-shadow(0 0 20px ${node.color}) drop-shadow(0 0 40px ${node.color}80)`,
        strokeColor: '#fff',
        strokeWidth: 4,
      }
    }

    // Check relationship to hovered node
    const connections = getRelatedNodes(hoveredNode)
    
    if (connections.sameInstructor.some(n => n.id === node.id)) {
      return {
        opacity: 1,
        filter: `drop-shadow(0 0 12px ${RELATIONSHIP_STYLES.instructor.glowColor})`,
        strokeColor: RELATIONSHIP_STYLES.instructor.color,
        strokeWidth: 3,
      }
    }
    
    if (connections.sameYear.some(n => n.id === node.id)) {
      return {
        opacity: 1,
        filter: `drop-shadow(0 0 8px ${RELATIONSHIP_STYLES.year.glowColor})`,
        strokeColor: RELATIONSHIP_STYLES.year.color,
        strokeWidth: 3,
      }
    }
    
    if (connections.sameDepartment.some(n => n.id === node.id)) {
      return {
        opacity: 0.95,
        filter: `drop-shadow(0 0 6px ${RELATIONSHIP_STYLES.department.glowColor})`,
        strokeColor: RELATIONSHIP_STYLES.department.color,
        strokeWidth: 2.5,
      }
    }

    // Unrelated - dim (NO SCALE - stays in place)
    return {
      opacity: 0.3,
      filter: 'grayscale(0.5)',
      strokeColor: 'rgba(255,255,255,0.1)',
      strokeWidth: 1,
    }
  }, [hoveredNode, getRelatedNodes])

  // ============================================================================
  // RENDER
  // ============================================================================

  const containerRect = containerRef.current?.getBoundingClientRect() || null

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden ${fullScreen ? 'fixed inset-0' : 'w-full h-full'}`}
      style={{
        ...(fullScreen ? { top: headerHeight } : {}),
        height: fullScreen ? `calc(100vh - ${headerHeight}px)` : '100%',
        minHeight: fullScreen ? undefined : 600,
        background: 'linear-gradient(145deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)',
      }}
    >
      {/* Ambient background effects */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 w-64 h-64 bg-emerald-500/5 rounded-full blur-3xl" />
      </div>

      {/* Grid background */}
      <div 
        className="absolute inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage: `
            linear-gradient(to right, #64748b 1px, transparent 1px),
            linear-gradient(to bottom, #64748b 1px, transparent 1px)
          `,
          backgroundSize: '60px 60px',
        }}
      />

      {/* SVG Canvas */}
      <svg
        ref={svgRef}
        width={dimensions.width}
        height={dimensions.height}
        className="absolute inset-0"
        style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
      >
        <defs>
          {/* Animated dash pattern for instructor connections */}
          <linearGradient id="lineGradientBlue" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.3" />
            <stop offset="50%" stopColor="#3B82F6" stopOpacity="1" />
            <stop offset="100%" stopColor="#3B82F6" stopOpacity="0.3" />
          </linearGradient>
          <linearGradient id="lineGradientPurple" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#8B5CF6" stopOpacity="0.3" />
            <stop offset="50%" stopColor="#8B5CF6" stopOpacity="1" />
            <stop offset="100%" stopColor="#8B5CF6" stopOpacity="0.3" />
          </linearGradient>
          <linearGradient id="lineGradientGreen" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#10B981" stopOpacity="0.3" />
            <stop offset="50%" stopColor="#10B981" stopOpacity="1" />
            <stop offset="100%" stopColor="#10B981" stopOpacity="0.3" />
          </linearGradient>
          
          {/* Glow filters */}
          <filter id="glowBlue" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feFlood floodColor="#3B82F6" floodOpacity="0.5" />
            <feComposite in2="blur" operator="in" />
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <g ref={gRef}>
          {/* Connection Lines Layer */}
          <g className="connection-lines">
            {connectionLines.map((line, i) => {
              const style = RELATIONSHIP_STYLES[line.type]
              const path = generateBezierPath(
                line.source.x || 0,
                line.source.y || 0,
                line.target.x || 0,
                line.target.y || 0
              )
              
              const gradientId = line.type === 'instructor' 
                ? 'lineGradientBlue' 
                : line.type === 'year' 
                  ? 'lineGradientPurple' 
                  : 'lineGradientGreen'
              
              return (
                <g key={`${line.source.id}-${line.target.id}`}>
                  {/* Glow layer */}
                  <path
                    d={path}
                    fill="none"
                  stroke={style.color}
                    strokeWidth={style.width + 4}
                    strokeOpacity={0.2}
                    className="blur-sm"
                    style={{
                      animation: 'line-draw 0.3s ease-out forwards',
                    }}
                  />
                  {/* Main line */}
                  <path
                    d={path}
                    fill="none"
                    stroke={`url(#${gradientId})`}
                  strokeWidth={style.width}
                  strokeDasharray={style.dasharray}
                    strokeLinecap="round"
                    className={line.type === 'instructor' ? 'animate-dash' : ''}
                    style={{
                      animation: 'line-draw 0.3s ease-out forwards',
                    }}
                  />
                </g>
              )
            })}
          </g>

          {/* Bubbles Layer */}
          <g className="bubbles">
          {positions.map((node, i) => {
              const nodeStyle = getNodeStyle(node)
              const r = node.radius || 60
              const isHovered = hoveredNode?.id === node.id

            return (
                <g
                key={node.id}
                  transform={`translate(${node.x}, ${node.y})`}
                  style={{
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => handleMouseEnter(node, e)}
                  onMouseLeave={handleMouseLeave}
                  onMouseDown={(e) => handleDragStart(node, e)}
                  onMouseMove={(e) => handleDrag(node, e)}
                  onMouseUp={() => handleDragEnd(node)}
                  onClick={() => !isDragging && onNodeClick?.(node)}
                >
                  {/* Inner group for opacity/filter animations - NO SCALE, position stays fixed */}
                  <g
                    style={{
                      opacity: nodeStyle.opacity,
                      filter: nodeStyle.filter,
                      transition: `opacity ${ANIMATION_DURATION}ms ease-out, filter ${ANIMATION_DURATION}ms ease-out`,
                    }}
                  >
                  {/* Outer glow */}
                <circle
                    cx={0}
                    cy={0}
                    r={r + 8}
                  fill={node.color}
                    opacity={isHovered ? 0.25 : 0.1}
                    className="blur-md transition-opacity duration-300"
                />
                  
                  {/* Main bubble */}
                <circle
                    cx={0}
                    cy={0}
                    r={r}
                  fill={node.color}
                    stroke={nodeStyle.strokeColor}
                    strokeWidth={nodeStyle.strokeWidth}
                    opacity={0.9}
                    className="transition-all duration-300"
                  />
                  
                  {/* Inner highlight */}
                  <circle
                    cx={-r * 0.25}
                    cy={-r * 0.25}
                    r={r * 0.35}
                    fill="url(#highlightGradient)"
                    opacity={0.3}
                  />
                  
                  {/* Label */}
                  <text
                    x={0}
                    y={0}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill="#fff"
                    fontSize={r > 65 ? 13 : 11}
                    fontWeight={600}
                    className="pointer-events-none select-none"
                    style={{ textShadow: '0 1px 3px rgba(0,0,0,0.5)' }}
                  >
                    {(node.label || node.name || '').length > 14 
                      ? (node.label || node.name || '').slice(0, 12) + '…'
                      : (node.label || node.name)}
                  </text>
                  </g>
                </g>
              )
            })}
          </g>
        </g>

        {/* Highlight gradient definition */}
        <defs>
          <radialGradient id="highlightGradient" cx="30%" cy="30%">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
        </defs>
      </svg>

      {/* Tooltip */}
      <Tooltip data={tooltipData} containerRect={containerRect} />

      {/* Zoom controls */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-2 z-20">
        <button
          className="w-10 h-10 bg-slate-800/80 hover:bg-slate-700 rounded-lg flex items-center justify-center text-white border border-slate-600/50 backdrop-blur-sm transition-colors"
          onClick={() => {
            if (svgRef.current && zoomRef.current) {
              d3.select(svgRef.current)
                .transition()
                .duration(300)
                .call(zoomRef.current.scaleBy, 1.3)
            }
          }}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
        </button>
        <button
          className="w-10 h-10 bg-slate-800/80 hover:bg-slate-700 rounded-lg flex items-center justify-center text-white border border-slate-600/50 backdrop-blur-sm transition-colors"
          onClick={() => {
            if (svgRef.current && zoomRef.current) {
              d3.select(svgRef.current)
                .transition()
                .duration(300)
                .call(zoomRef.current.scaleBy, 0.7)
            }
          }}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 12H6" />
          </svg>
        </button>
        <button
          className="w-10 h-10 bg-slate-800/80 hover:bg-slate-700 rounded-lg flex items-center justify-center text-white border border-slate-600/50 backdrop-blur-sm transition-colors"
          onClick={() => {
            if (svgRef.current && zoomRef.current) {
              d3.select(svgRef.current)
                .transition()
                .duration(300)
                .call(zoomRef.current.transform, d3.zoomIdentity)
            }
          }}
          title="Reset view"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
          </svg>
        </button>
      </div>

      {/* Legend */}
      <div className="absolute bottom-4 left-4 bg-slate-900/80 backdrop-blur-md rounded-xl border border-slate-700/50 p-4 z-20">
        <p className="text-xs text-slate-400 mb-3 font-medium">Connections</p>
        <div className="space-y-2 text-xs">
          <div className="flex items-center gap-3">
            <div className="w-8 h-0.5 bg-blue-500 rounded" style={{ background: 'linear-gradient(90deg, transparent, #3B82F6, transparent)' }} />
            <span className="text-slate-300">Same Instructor</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-8 h-0.5 rounded" style={{ background: 'repeating-linear-gradient(90deg, #8B5CF6, #8B5CF6 3px, transparent 3px, transparent 6px)' }} />
            <span className="text-slate-300">Same Year</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-8 h-0.5 rounded" style={{ background: 'repeating-linear-gradient(90deg, #10B981, #10B981 4px, transparent 4px, transparent 8px)' }} />
            <span className="text-slate-300">Same Semester</span>
          </div>
        </div>
      </div>

      {/* CSS Animations */}
      <style jsx global>{`
        @keyframes line-draw {
          from {
            stroke-dashoffset: 1000;
            opacity: 0;
          }
          to {
            stroke-dashoffset: 0;
            opacity: 1;
          }
        }
        
        @keyframes animate-dash {
          to {
            stroke-dashoffset: -24;
          }
        }
        
        .animate-dash {
          animation: animate-dash 1s linear infinite;
        }
        
        @keyframes fade-in {
          from {
            opacity: 0;
            transform: translateY(4px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        .animate-fade-in {
          animation: fade-in 0.2s ease-out forwards;
        }
      `}</style>
    </div>
  )
}
