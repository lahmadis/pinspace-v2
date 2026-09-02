'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import * as d3 from 'd3'
import { throttle, debounce } from '@/lib/throttleDebounce'
import { gradeLabel } from '@/lib/constants/departments'

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
  /**
   * Which studio this is a section of — 'Studio 01' … 'Thesis Studio', from
   * lib/constants/studios. Undefined for anything published before sections
   * existed; /explore buckets those rather than hiding them.
   */
  studio?: string
  /**
   * The term this ran in — '2025-2026'. Returned per node by
   * /api/explore/studios, which has always sent it; it was simply never in this
   * interface, because /explore treated the academic year as a filter chip
   * rather than as something you could drill into.
   */
  academicYear?: string
  /**
   * How many sections a STUDIO BUCKET holds. Set only on the bucket bubbles
   * /explore synthesises at the studio level, never on a real workspace.
   *
   * Its own field rather than reusing memberCount, which the tooltip labels
   * "Members": a bucket has no members, and "Members 10" on Studio 01 would be
   * a plausible-looking wrong number rather than an obviously missing one.
   */
  sectionCount?: number
  memberCount?: number
  color?: string
  /**
   * Names of everyone with work pinned in this studio, from
   * /api/explore/studios. A search index, not a label — nothing renders the
   * list, the network search box matches against it so a person can be found
   * by name and not only by the space or the professor. Absent in demo mode.
   */
  contributors?: string[]
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
  /**
   * Floor for the canvas box. 600 suits a page that IS the network; a preview
   * embedded in a dashboard band is ~190px and would otherwise overflow its
   * container by 400px and be cropped to whatever the top third happens to hold.
   */
  minHeight?: number
  /**
   * Whether the viewer can pan and zoom the graph. Off for a preview: the whole
   * band is a link, and a graph you can drag is a graph that eats the click that
   * was meant to open it. Hovering a bubble still works either way — that is a
   * different gesture, and the point of showing a live graph rather than a
   * picture of one.
   */
  interactive?: boolean
  /**
   * Paint no ground and no ruling — just the bubbles and the edges between
   * them. For a preview layered over a surface that already has its own colour:
   * the network's own #E6ECFC ground is opaque, so full-bleed it would cover
   * the band it is sitting in and the band would stop being itself.
   */
  transparent?: boolean
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

/**
 * The three edge styles — and the source the legend swatches read from.
 *
 * The legend used to hardcode its own colours (`bg-primary`, `border-accent`,
 * `border-white`) and all three had drifted off the lines they describe: an
 * indigo swatch for a #3B6EF6 line, a blue swatch for a teal one, and a white
 * swatch for a line that is no longer white. A legend that disagrees with the
 * graph is worse than none, so it is wired to these values directly.
 */
const RELATIONSHIP_STYLES = {
  instructor: {
    color: '#3B6EF6',
    width: 3,
    dasharray: '', // Solid line
    glowColor: 'rgba(59, 110, 246, 0.55)',
  },
  year: {
    // Was white — fine over near-black, invisible over the light ground this
    // surface now uses.
    color: '#8A8FA0',
    width: 2.5,
    dasharray: '8,4',
    glowColor: 'rgba(138, 143, 160, 0.45)',
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
 * Every bubble is this one blue. The graph used to spread nodes across six
 * hues from an ordinal scale, which read as categorical — six colours imply six
 * kinds of thing — when the only real distinction between nodes is what the
 * EDGES say. Colour was carrying no information, so it is now constant and the
 * relationship lines do the explaining.
 *
 * It is #3B6EF6, the accent the rest of the app uses, NOT Tailwind's `primary`
 * (the indigo #6366f1) which this surface alone used to reach for.
 */
/**
 * The network's own ground, and the ruling on it.
 *
 * This surface was near-black, which put it alone against every other field in
 * the app and meant a blue grid had to fight the ground to be seen at all. It
 * is now the same faint tint of the palette accent the 3D room's horizon uses
 * (ROOM_SKY), stated locally rather than imported so the graph does not take a
 * dependency on the room's palette for one colour.
 */
const NETWORK_BG = '#E6ECFC'
/**
 * The ruling. Now that the ground is light, this is the accent itself at low
 * alpha rather than the accent-mixed-to-white it had to be on a dark field —
 * on a light ground a pale line disappears, so the tint has to go the other
 * way. Composites to about #CBD8FB over NETWORK_BG: clearly a blue ruling,
 * nowhere near the strength of a bubble.
 */
const NETWORK_GRID = 'rgba(59, 110, 246, 0.16)'
/** Grid cell at zoom 1, in px. Scales with the zoom — see the grid div. */
const NETWORK_GRID_CELL = 55

// The app's one blue. Was rgb(var(--color-primary)) — the indigo #6366f1 —
// which made the network the only surface using a second accent.
const NETWORK_NODE_COLOR = '#3B6EF6'
/** Same hue at half alpha, for the outer hover glow. */
const NETWORK_NODE_GLOW = 'rgba(59, 110, 246, 0.5)'

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
      <div className="overflow-hidden rounded-pinspace-lg border border-[#16181D]/10 bg-white/95 shadow-[var(--shadow-raised)] backdrop-blur-md">
        {/* Header */}
        <div 
          className="border-b border-[#16181D]/[0.08] bg-[#16181D]/[0.04] px-4 py-3"
        >
          <h3 className="truncate text-sm font-bold text-[#16181D]">{stripYearFromLabel(node.name || node.label)}</h3>
          {node.instructor && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-[#5A5E6B]">
              <span aria-hidden="true">◦</span> {node.instructor}
            </p>
          )}
        </div>
        
        {/* Details */}
        <div className="px-4 py-3 space-y-2 text-xs">
          <div className="flex justify-between gap-3 text-[#16181D]">
            <span className="text-[#8A8FA0]">Department</span>
            <span className="font-medium">{node.department || '—'}</span>
          </div>
          <div className="flex justify-between gap-3 text-[#16181D]">
            <span className="text-[#8A8FA0]">Grade</span>
            <span className="font-medium">
              {node.year ? gradeLabel(node.year) : '—'}
            </span>
          </div>
          {node.studio && (
            <div className="flex justify-between gap-3 text-[#16181D]">
              <span className="text-[#8A8FA0]">Class</span>
              <span className="font-medium">{node.studio}</span>
            </div>
          )}
          <div className="flex justify-between gap-3 text-[#16181D]">
            <span className="text-[#8A8FA0]">{node.sectionCount === undefined ? 'Members' : 'Sections'}</span>
            <span className="font-medium">{node.sectionCount ?? node.memberCount ?? node.count ?? 0}</span>
          </div>
        </div>

        {/* Connections */}
        {totalConnections > 0 && (
          <div className="border-t border-[#16181D]/[0.08] bg-[#16181D]/[0.04] px-4 py-3">
            <p className="mb-2 flex items-center gap-1 text-xs text-[#8A8FA0]">
              Connected to:
            </p>
            <div className="space-y-1 text-xs">
              {connections.sameInstructor.length > 0 && node.instructor && (
                <div className="flex items-center gap-2 text-primary">
                  <span className="h-0.5 w-3 rounded" style={{ background: RELATIONSHIP_STYLES.instructor.color }} />
                  <span>{connections.sameInstructor.length} classes ({node.instructor})</span>
                </div>
              )}
              {connections.sameYear.length > 0 && node.year && (
                <div className="flex items-center gap-2 text-[#16181D]">
                  <span className="w-3 border-t-2 border-dashed" style={{ borderColor: RELATIONSHIP_STYLES.year.color }} />
                  <span>{connections.sameYear.length} classes ({gradeLabel(node.year)})</span>
                </div>
              )}
              {connections.sameDepartment.length > 0 && node.department && (
                <div className="flex items-center gap-2 text-[#5A5E6B]">
                  <span className="w-3 border-t-2 border-dotted" style={{ borderColor: RELATIONSHIP_STYLES.department.color }} />
                  <span>{connections.sameDepartment.length} classes ({node.department})</span>
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
  minHeight = 600,
  interactive = true,
  transparent = false,
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
          // Full viewport even in fullScreen. headerHeight no longer insets the
          // canvas — the chrome floats over the grid now — it only biases the
          // simulation below, see the center force.
          height: window.innerHeight,
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
    // isFullscreen, not headerHeight: this effect stopped reading headerHeight
    // when the canvas went full-viewport, and it branches on isFullscreen — so
    // as written it would not re-measure on entering browser fullscreen.
  }, [fullScreen, isFullscreen])

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
      // Centre pushed down by half the chrome height so the cloud settles
      // clear of the floating controls rather than under them.
      .force('center', d3.forceCenter(width / 2, (height + headerHeight) / 2).strength(0.01))
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
    // headerHeight belongs here now that the centre force reads it — the header
    // is measured by a ResizeObserver, so it changes when the controls wrap on
    // a narrow viewport, and the cloud has to re-settle clear of the new height.
  }, [nodes, dimensions, headerHeight])

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

    // A preview attaches no zoom behaviour at all, rather than attaching it and
    // filtering events: d3.zoom binds wheel, drag and touch on the svg, and any
    // of those firing inside a link is a gesture the reader did not ask for.
    if (interactive) {
      svg.call(zoom)
      zoomRef.current = zoom
    }

    // Disable double-click zoom
    svg.on('dblclick.zoom', null)

    return () => {
      svg.on('.zoom', null)
    }
    // `interactive` is constant per mount today, but the effect reads it, so it
    // belongs here rather than relying on that staying true.
  }, [interactive])

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
      /**
       * z-0 when the graph merely fills the page, z-50 only in real browser
       * fullscreen.
       *
       * Both used to be z-50, which was harmless while the canvas was inset by
       * the header height and so never reached the chrome. Now that it fills
       * the viewport so the grid can run behind the controls, a blanket z-50
       * paints the whole canvas OVER the page's z-40 header and z-30 panels —
       * the buttons are still mounted and still there, just buried. Real
       * fullscreen keeps z-50 on purpose: covering that chrome is the point.
       */
      className={`relative overflow-hidden ${
        isFullscreen
          ? 'fixed inset-0 z-50 h-screen w-screen'
          : fullScreen
            ? 'fixed inset-0 z-0 h-screen w-screen'
            : 'h-full w-full'
      }`}
      style={{
        // Set here rather than through bg-white: that class is not
        // defined in tailwind.config.js, so it emitted nothing and the surface
        // was taking whatever the page behind it happened to be.
        backgroundColor: transparent ? undefined : NETWORK_BG,
        height: isEffectiveFullscreen ? '100vh' : '100%',
        minHeight: isEffectiveFullscreen ? undefined : minHeight,
      }}
    >
      {/* Grid background.
          Four-stop gradients rather than the usual 1px hairline: the line is
          drawn as a band between two transparent stops, which lets it stay a
          crisp hairline at any zoom without the shimmer a fractional 1px
          border gets.

          PANS AND ZOOMS WITH THE GRAPH. It used to be pinned to the viewport
          while the bubbles moved over it, which reads as the bubbles sliding
          across a pane of glass rather than as a camera moving over a field —
          there is no parallax cue, so the ground looks stuck. A repeating
          background is periodic, so the same translate+scale the SVG group gets
          is exactly backgroundPosition plus a scaled backgroundSize. That also
          means it tiles forever: no edge to pan off, at any zoom.

          The zoom-transform state driving it is already updated by the zoom
          handler and already read during render (the hover callout positions
          off it), so this costs no extra re-renders. */}
      {!transparent && <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `
            linear-gradient(0deg, transparent 24%, ${NETWORK_GRID} 25%, ${NETWORK_GRID} 26%, transparent 27%, transparent 74%, ${NETWORK_GRID} 75%, ${NETWORK_GRID} 76%, transparent 77%, transparent),
            linear-gradient(90deg, transparent 24%, ${NETWORK_GRID} 25%, ${NETWORK_GRID} 26%, transparent 27%, transparent 74%, ${NETWORK_GRID} 75%, ${NETWORK_GRID} 76%, transparent 77%, transparent)
          `,
          backgroundSize: `${NETWORK_GRID_CELL * transform.k}px ${NETWORK_GRID_CELL * transform.k}px`,
          backgroundPosition: `${transform.x}px ${transform.y}px`,
        }}
      />}

      {/* SVG Canvas */}
      <svg
        ref={svgRef}
        width={dimensions.width}
        height={dimensions.height}
        className="absolute inset-0"
        style={{ cursor: interactive ? (isDragging ? 'grabbing' : 'grab') : 'pointer' }}
        role="img"
        aria-label={`Network map with ${nodes.length} ${nodes.length === 1 ? 'class' : 'classes'}. Use the network directory to select an item with the keyboard.`}
      >
        <defs>
          {/* Animated dash pattern for instructor connections */}
          <linearGradient id="lineGradientBlue" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={RELATIONSHIP_STYLES.instructor.color} stopOpacity="0.3" />
            <stop offset="50%" stopColor={RELATIONSHIP_STYLES.instructor.color} stopOpacity="1" />
            <stop offset="100%" stopColor={RELATIONSHIP_STYLES.instructor.color} stopOpacity="0.3" />
          </linearGradient>
          {/* Same Year. Must track RELATIONSHIP_STYLES.year.color — the edges
              paint with THIS gradient, not with that constant, so recolouring
              one without the other draws an invisible line under a legend that
              says otherwise. It was white here while the constant said grey. */}
          <linearGradient id="lineGradientPurple" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={RELATIONSHIP_STYLES.year.color} stopOpacity="0.3" />
            <stop offset="50%" stopColor={RELATIONSHIP_STYLES.year.color} stopOpacity="1" />
            <stop offset="100%" stopColor={RELATIONSHIP_STYLES.year.color} stopOpacity="0.3" />
          </linearGradient>
          <linearGradient id="lineGradientGreen" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={RELATIONSHIP_STYLES.department.color} stopOpacity="0.3" />
            <stop offset="50%" stopColor={RELATIONSHIP_STYLES.department.color} stopOpacity="1" />
            <stop offset="100%" stopColor={RELATIONSHIP_STYLES.department.color} stopOpacity="0.3" />
          </linearGradient>
          
          {/* Glow filters */}
          <filter id="glowBlue" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feFlood floodColor="#3B6EF6" floodOpacity="0.5" />
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
                  // Drag is gated with the rest of the gestures. Left live in a
                  // preview it is worse than merely useless: the band wraps the
                  // graph in a Link, a drag ends with a native click, and that
                  // click bubbles — so dragging a bubble navigated away.
                  onMouseDown={interactive ? (e) => handleDragStart(node, e) : undefined}
                  onMouseMove={interactive ? (e) => handleDrag(node, e) : undefined}
                  onMouseUp={interactive ? () => handleDragEnd(node) : undefined}
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
                        fill="#FFFFFF"
                        fontSize={r > 65 ? 13 : 11}
                        fontWeight={600}
                        className="pointer-events-none select-none"
                        // No paint-order halo. The label used to be dark ink
                        // behind a 3px white stroke, which read as a highlight
                        // box around every name; white on the accent carries
                        // the same contrast with nothing drawn behind it.
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


      {/* Zoom controls. Gated with the rest of the chrome — see the legend
          below for why `interactive` carries this too. */}
      {interactive && <div className="absolute bottom-4 right-4 z-20 flex flex-col gap-2">
        <button
          className="flex h-11 w-11 items-center justify-center rounded-pinspace border border-[#16181D]/[0.12] bg-white/90 text-[#16181D] backdrop-blur-sm transition-colors hover:border-primary hover:bg-[#16181D]/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
          className="flex h-11 w-11 items-center justify-center rounded-pinspace border border-[#16181D]/[0.12] bg-white/90 text-[#16181D] backdrop-blur-sm transition-colors hover:border-primary hover:bg-[#16181D]/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
          className="flex h-11 w-11 items-center justify-center rounded-pinspace border border-[#16181D]/[0.12] bg-white/90 text-[#16181D] backdrop-blur-sm transition-colors hover:border-primary hover:bg-[#16181D]/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
      </div>}

      {/* Legend.
          `interactive` gates every piece of chrome, not just the gestures. A
          preview shows the SHAPE of the network; the controls for driving it
          and the key for reading its edge styles both belong to the page that
          is the network, and in a band they sit over the copy as leftovers from
          somewhere else. */}
      {interactive && <div className="absolute bottom-4 left-4 z-20 hidden rounded-pinspace-lg border border-[#16181D]/10 bg-white/90 p-4 backdrop-blur-md sm:block">
        <p className="mb-3 text-xs font-medium text-[#8A8FA0]">Connections</p>
        <div className="space-y-2 text-xs">
          <div className="flex items-center gap-3">
            <div className="h-0.5 w-8 rounded" style={{ background: RELATIONSHIP_STYLES.instructor.color }} />
            <span className="text-[#5A5E6B]">Same Instructor</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-8 border-t-2 border-dashed" style={{ borderColor: RELATIONSHIP_STYLES.year.color }} />
            <span className="text-[#5A5E6B]">Same Grade Level</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-8 border-t-2 border-dotted" style={{ borderColor: RELATIONSHIP_STYLES.department.color }} />
            <span className="text-[#5A5E6B]">Same Department</span>
          </div>
        </div>
      </div>}

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
