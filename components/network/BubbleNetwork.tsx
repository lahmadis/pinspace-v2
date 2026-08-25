'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import * as d3 from 'd3'
import { throttle, debounce } from '@/lib/throttleDebounce'

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
  workspaceId?: string
  radius?: number
  publishedRooms?: { id: string; name: string; boardCount?: number }[]
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
  /** Called when a node is hovered; use to prefetch studio data for instant open on click */
  onNodeHover?: (node: BubbleNode) => void
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

// Remove " - Year N" or " - Masters" from end of label so bubble shows studio name only
function stripYearFromLabel(text: string): string {
  const raw = (text || '').trim()
  return raw.replace(/\s*-\s*(Year\s+\d+|Masters)\s*$/i, '').trim() || raw
}

// Wrap label into multiple lines so full name fits in bubble (max chars per line scales with radius)
function wrapLabel(text: string, radius: number): string[] {
  const raw = stripYearFromLabel(text).trim()
  if (!raw) return ['']
  const words = raw.split(/\s+/)
  const maxCharsPerLine = Math.max(10, Math.floor(radius / 4))
  const lines: string[] = []
  let current = ''
  for (const w of words) {
    const next = current ? `${current} ${w}` : w
    if (next.length <= maxCharsPerLine) {
      current = next
    } else {
      if (current) lines.push(current)
      current = w
    }
  }
  if (current) lines.push(current)
  return lines.length ? lines : [raw]
}

const RELATIONSHIP_STYLES = {
  instructor: {
    color: 'rgb(var(--color-primary))',
    width: 3,
    dasharray: '', // Solid line
    glowColor: 'rgb(var(--color-primary) / 0.55)',
  },
  year: {
    color: 'rgb(var(--color-paper))',
    width: 2.5,
    dasharray: '8,4',
    glowColor: 'rgb(var(--color-paper) / 0.45)',
  },
  department: {
    color: 'rgb(var(--color-secondary))',
    width: 2,
    dasharray: '3,3',
    glowColor: 'rgb(var(--color-secondary) / 0.45)',
  },
}

const MAX_CONNECTIONS = 15
const HOVER_DEBOUNCE_MS = 100
const BUBBLE_SIZE_MIN = 55
const BUBBLE_SIZE_MAX = 75
const ANIMATION_DURATION = 300
/**
 * Every bubble is this one indigo. The graph used to spread nodes across six
 * hues from an ordinal scale, which read as categorical — six colours imply six
 * kinds of thing — when the only real distinction between nodes is what the
 * EDGES say. Colour was carrying no information, so it is now constant and the
 * relationship lines do the explaining.
 *
 * Matches Tailwind's `primary`, which the legend swatch beside the graph
 * already renders via `bg-primary`.
 */
const NETWORK_NODE_COLOR = 'rgb(var(--color-primary))'
/** Same hue at half alpha, for the outer hover glow. */
const NETWORK_NODE_GLOW = 'rgb(var(--color-primary) / 0.5)'

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================


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
      <div className="overflow-hidden rounded-pinspace-lg border border-white/20 bg-pinspace-forest/95 shadow-[var(--shadow-raised)] backdrop-blur-md">
        {/* Header */}
        <div 
          className="border-b border-white/15 bg-white/5 px-4 py-3"
        >
          <h3 className="truncate text-sm font-bold text-white">{stripYearFromLabel(node.name || node.label)}</h3>
          {node.instructor && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-white/80">
              <span aria-hidden="true">◦</span> {node.instructor}
            </p>
          )}
        </div>
        
        {/* Details */}
        <div className="px-4 py-3 space-y-2 text-xs">
          <div className="flex justify-between gap-3 text-white">
            <span className="text-white/65">Department</span>
            <span className="font-medium">{node.department || '—'}</span>
          </div>
          <div className="flex justify-between gap-3 text-white">
            <span className="text-white/65">Year</span>
            <span className="font-medium">
              {node.year ? (node.year === 'Masters' ? 'Masters' : `Year ${node.year}`) : '—'}
            </span>
          </div>
          <div className="flex justify-between gap-3 text-white">
            <span className="text-white/65">Members</span>
            <span className="font-medium">{node.memberCount ?? node.count ?? 0}</span>
          </div>
        </div>

        {/* Connections */}
        {totalConnections > 0 && (
          <div className="border-t border-white/15 bg-white/5 px-4 py-3">
            <p className="mb-2 flex items-center gap-1 text-xs text-white/65">
              Connected to:
            </p>
            <div className="space-y-1 text-xs">
              {connections.sameInstructor.length > 0 && node.instructor && (
                <div className="flex items-center gap-2 text-primary">
                  <span className="h-0.5 w-3 rounded bg-primary"></span>
                  <span>{connections.sameInstructor.length} studios ({node.instructor})</span>
                </div>
              )}
              {connections.sameYear.length > 0 && node.year && (
                <div className="flex items-center gap-2 text-white">
                  <span className="w-3 border-t-2 border-dashed border-white"></span>
                  <span>{connections.sameYear.length} studios ({node.year === 'Masters' ? 'Masters' : `Year ${node.year}`})</span>
                </div>
              )}
              {connections.sameDepartment.length > 0 && node.department && (
                <div className="flex items-center gap-2 text-white/80">
                  <span className="w-3 border-t-2 border-dotted border-accent"></span>
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
  onNodeHover,
  fullScreen = false,
  headerHeight = 64,
}: BubbleNetworkProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const gRef = useRef<SVGGElement>(null)
  
  const [dimensions, setDimensions] = useState({ width: 900, height: 600 })
  const [containerRect, setContainerRect] = useState<DOMRect | null>(null)
  const [positions, setPositions] = useState<BubbleNode[]>([])
  const [hoveredNode, setHoveredNode] = useState<BubbleNode | null>(null)
  const [tooltipData, setTooltipData] = useState<TooltipData | null>(null)
  const [connectionLines, setConnectionLines] = useState<ConnectionLine[]>([])
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 })
  const [isDragging, setIsDragging] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const toggleFullscreen = useCallback(async () => {
    if (!containerRef.current) return
    try {
      if (!document.fullscreenElement) {
        if (containerRef.current.requestFullscreen) {
          await containerRef.current.requestFullscreen().catch(() => {
            setIsFullscreen((prev) => !prev)
          })
        } else {
          setIsFullscreen((prev) => !prev)
        }
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen().catch(() => {
            setIsFullscreen((prev) => !prev)
          })
        } else {
          setIsFullscreen((prev) => !prev)
        }
      }
    } catch {
      setIsFullscreen((prev) => !prev)
    }
  }, [])

  useEffect(() => {
    const handleFullscreenChange = () => {
      const isNativeFs = Boolean(document.fullscreenElement && containerRef.current && document.fullscreenElement === containerRef.current)
      if (document.fullscreenElement) {
        setIsFullscreen(isNativeFs)
      }
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])
  
  const simulationRef = useRef<d3.Simulation<BubbleNode, undefined> | null>(null)
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null)

  // ============================================================================
  // DIMENSIONS
  // ============================================================================

  useEffect(() => {
    const updateDimensions = () => {
      if (fullScreen || isFullscreen) {
        setDimensions({
          width: window.innerWidth,
          height: fullScreen ? window.innerHeight - headerHeight : window.innerHeight,
        })
        if (containerRef.current) setContainerRect(containerRef.current.getBoundingClientRect())
      } else if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        setContainerRect(rect)
        setDimensions({
          width: rect.width || 900,
          height: rect.height || 600,
        })
      }
    }

    updateDimensions()
    
    // PERF: Debounce resize handler to 100ms to avoid excessive dimension updates
    // Resize events fire very frequently, so we wait until user stops resizing
    // before recalculating dimensions. UI responsiveness improvement.
    const debouncedUpdateDimensions = debounce(updateDimensions, 100)
    
    window.addEventListener('resize', debouncedUpdateDimensions)
    return () => window.removeEventListener('resize', debouncedUpdateDimensions)
  }, [fullScreen, headerHeight])

  // ============================================================================
  // FORCE SIMULATION
  // ============================================================================

  useEffect(() => {
    if (!nodes || nodes.length === 0) {
      queueMicrotask(() => setPositions([]))
      return
    }

    const { width, height } = dimensions
    
    // Reset stabilization state when nodes change (simulation will re-run)

    // Create simulation nodes with initial positions spread across canvas
    const simNodes: BubbleNode[] = nodes.map((n, i) => {
      // Spread nodes across a much larger area using golden angle distribution
      const goldenAngle = Math.PI * (3 - Math.sqrt(5))
      const angle = i * goldenAngle
      // Increased spread radius to 0.8 (was 0.4) to give bubbles more room
      const radius = Math.sqrt(i / nodes.length) * Math.min(width, height) * 0.8
      
      return {
      ...n,
        radius: n.radius ?? Math.max(BUBBLE_SIZE_MIN, Math.min(BUBBLE_SIZE_MAX, (n.count || 10) * 1.5 + 45)),
      // n.color is deliberately ignored. It used to be honoured only when it
      // appeared in an allowlist of the six scale colours — so the three
      // network pages, which all pass the literal '#6366f1', failed that test
      // and silently fell through to an ordinal scale that coloured each node
      // differently. They were already asking for one indigo; now they get it.
      color: NETWORK_NODE_COLOR,
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
        .strength(-400) // Increased repulsion to spread bubbles further apart
      )
      .force('center', d3.forceCenter(width / 2, height / 2).strength(0.01)) // Reduced center pull
      .force('collision', d3.forceCollide<BubbleNode>()
        .radius(d => (d.radius || 60) + 30) // Increased spacing between bubbles
        .strength(0.9)
      )
      // Removed x and y forces - let bubbles spread naturally
      // Removed bounds force - let bubbles breathe and spread beyond container edges
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
      // Completely stop the simulation
      simulation.stop()
    })

    // Run simulation
    simulation.alpha(1).restart()

    return () => {
      simulation.stop()
    }
  }, [nodes, dimensions])

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
    const priorityOrder = ['instructor', 'year', 'semester', 'department'] as const
    return lines
      .sort((a, b) => {
        const aIndex = priorityOrder.indexOf(a.type as typeof priorityOrder[number])
        const bIndex = priorityOrder.indexOf(b.type as typeof priorityOrder[number])
        return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex)
      })
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

  const handleMouseEnter = useCallback((node: BubbleNode, _event: React.MouseEvent) => {
    if (isDragging) return
    onNodeHover?.(node)
    const screenX = (node.x || 0) * transform.k + transform.x
    const screenY = (node.y || 0) * transform.k + transform.y
    debouncedHover(node, screenX, screenY)
  }, [debouncedHover, isDragging, transform, onNodeHover])

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

  // PERF: Throttle drag handler to 50ms for smooth but efficient UI updates
  // This limits position updates to ~20fps during drag, reducing React re-renders
  // while maintaining smooth visual feedback. UI responsiveness improvement.
  /* eslint-disable react-hooks/refs -- the throttled callback reads the SVG ref only after pointer events. */
  const handleDragThrottled = useMemo(
    () => throttle((node: BubbleNode, event: React.MouseEvent) => {
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
    
      // Update position - no simulation needed
    setPositions(prev => prev.map(n => 
      n.id === node.id ? { ...n, x, y, fx: x, fy: y } : n
    ))
    }, 50),
    [transform]
  )
  /* eslint-enable react-hooks/refs */
  
  const handleDrag = useCallback((node: BubbleNode, event: React.MouseEvent) => {
    if (!isDragging) return
    handleDragThrottled(node, event)
  }, [isDragging, handleDragThrottled])

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
        strokeColor: 'rgb(var(--color-paper) / 0.45)',
        strokeWidth: 2,
      }
    }

    if (node.id === hoveredNode.id) {
      return {
        opacity: 1,
        // NOT `${node.color}80`: appending hex alpha to `rgb(var(--x))` yields
        // a malformed colour and the whole drop-shadow is dropped.
        filter: `drop-shadow(0 0 20px ${NETWORK_NODE_COLOR}) drop-shadow(0 0 40px ${NETWORK_NODE_GLOW})`,
        strokeColor: 'rgb(var(--color-paper))',
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
      strokeColor: 'rgb(var(--color-paper) / 0.18)',
      strokeWidth: 1,
    }
  }, [hoveredNode, getRelatedNodes])

  // ============================================================================
  // RENDER
  // ============================================================================

  const isEffectiveFullscreen = fullScreen || isFullscreen

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden bg-pinspace-forest ${isEffectiveFullscreen ? 'fixed inset-0 z-50 h-screen w-screen' : 'h-full w-full'}`}
      style={{
        ...(fullScreen && !isFullscreen ? { top: headerHeight } : {}),
        height: isEffectiveFullscreen ? (fullScreen && !isFullscreen ? `calc(100vh - ${headerHeight}px)` : '100vh') : '100%',
        minHeight: isEffectiveFullscreen ? undefined : 600,
      }}
    >
      {/* Grid background */}
      <div 
        className="absolute inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage: `
            linear-gradient(to right, rgb(var(--color-paper) / 0.45) 1px, transparent 1px),
            linear-gradient(to bottom, rgb(var(--color-paper) / 0.45) 1px, transparent 1px)
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
        role="img"
        aria-label={`Network map with ${nodes.length} ${nodes.length === 1 ? 'studio' : 'studios'}. Use the network directory to select an item with the keyboard.`}
      >
        <defs>
          {/* Animated dash pattern for instructor connections */}
          <linearGradient id="lineGradientBlue" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgb(var(--color-primary))" stopOpacity="0.3" />
            <stop offset="50%" stopColor="rgb(var(--color-primary))" stopOpacity="1" />
            <stop offset="100%" stopColor="rgb(var(--color-primary))" stopOpacity="0.3" />
          </linearGradient>
          <linearGradient id="lineGradientPurple" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgb(var(--color-paper))" stopOpacity="0.3" />
            <stop offset="50%" stopColor="rgb(var(--color-paper))" stopOpacity="1" />
            <stop offset="100%" stopColor="rgb(var(--color-paper))" stopOpacity="0.3" />
          </linearGradient>
          <linearGradient id="lineGradientGreen" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgb(var(--color-secondary))" stopOpacity="0.3" />
            <stop offset="50%" stopColor="rgb(var(--color-secondary))" stopOpacity="1" />
            <stop offset="100%" stopColor="rgb(var(--color-secondary))" stopOpacity="0.3" />
          </linearGradient>
          
          {/* Glow filters */}
          <filter id="glowBlue" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feFlood floodColor="rgb(var(--color-primary))" floodOpacity="0.5" />
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
            {connectionLines.map((line) => {
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
          {positions.map((node) => {
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
                  
                  {/* Label – wrap to multiple lines so full name fits (year stripped) */}
                  {(() => {
                    const lines = wrapLabel(stripYearFromLabel(node.label || node.name || ''), r)
                    return (
                      <text
                        x={0}
                        y={0}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fill="rgb(var(--color-ink))"
                        fontSize={r > 65 ? 13 : 11}
                        fontWeight={600}
                        className="pointer-events-none select-none"
                        style={{ paintOrder: 'stroke', stroke: 'rgb(var(--color-paper) / 0.85)', strokeWidth: 3 }}
                      >
                        {lines.map((line, i) => (
                          <tspan key={i} x={0} dy={i === 0 ? `${-0.6 * (lines.length - 1)}em` : '1.2em'}>
                            {line}
                          </tspan>
                        ))}
                      </text>
                    )
                  })()}
                  </g>
                </g>
              )
            })}
          </g>
        </g>

        {/* Highlight gradient definition */}
        <defs>
          <radialGradient id="highlightGradient" cx="30%" cy="30%">
            <stop offset="0%" stopColor="rgb(var(--color-paper))" stopOpacity="0.8" />
            <stop offset="100%" stopColor="rgb(var(--color-paper))" stopOpacity="0" />
          </radialGradient>
        </defs>
      </svg>

      {/* Tooltip */}
      <Tooltip data={tooltipData} containerRect={containerRect} />


      {/* Zoom controls */}
      <div className="absolute bottom-4 right-4 z-20 flex flex-col gap-2">
        <button
          className="flex h-11 w-11 items-center justify-center rounded-pinspace border border-white/25 bg-pinspace-forest/90 text-white backdrop-blur-sm transition-colors hover:border-primary hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label="Zoom in"
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
          className="flex h-11 w-11 items-center justify-center rounded-pinspace border border-white/25 bg-pinspace-forest/90 text-white backdrop-blur-sm transition-colors hover:border-primary hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label="Zoom out"
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
          className="flex h-11 w-11 items-center justify-center rounded-pinspace border border-white/25 bg-pinspace-forest/90 text-white backdrop-blur-sm transition-colors hover:border-primary hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label={isFullscreen ? 'Exit full screen' : 'Toggle full screen'}
          onClick={() => void toggleFullscreen()}
          title={isFullscreen ? 'Exit full screen' : 'Full screen'}
        >
          {isFullscreen ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9L4 4m0 0h4m-4 0v4m16 5l-5-5m5 5v-4m0 4h-4M9 15l-5 5m0 0h4m-4 0v-4m16-5l-5 5m5 0v-4m0 4h-4" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
          )}
        </button>
      </div>

      {/* Legend */}
      <div className="absolute bottom-4 left-4 z-20 hidden rounded-pinspace-lg border border-white/20 bg-pinspace-forest/90 p-4 backdrop-blur-md sm:block">
        <p className="mb-3 text-xs font-medium text-white/65">Connections</p>
        <div className="space-y-2 text-xs">
          <div className="flex items-center gap-3">
            <div className="h-0.5 w-8 rounded bg-primary" />
            <span className="text-white/80">Same Instructor</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-8 border-t-2 border-dashed border-white" />
            <span className="text-white/80">Same Year</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-8 border-t-2 border-dotted border-accent" />
            <span className="text-white/80">Same Department</span>
          </div>
        </div>
      </div>

      {/* CSS Animations */}
      <style>{`
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
