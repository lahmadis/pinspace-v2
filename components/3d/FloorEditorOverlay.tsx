'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { calculateFloorBounds, getWallTransformResolved, getWallTransform } from '@/lib/wallLayout'
import type { WallConfig, WallTransformOverride } from '@/lib/wallLayout'
import type { FloorTable } from '@/types'
import { X, Plus, Upload, Trash2, Magnet } from 'lucide-react'
import { toast } from '@/lib/toast'

const TABLE_HEIGHT_INCHES = 18 // 1.5 feet
const DEFAULT_TABLE_WIDTH = 24
const DEFAULT_TABLE_DEPTH = 18
const GRID_INCHES = 12 // 1 ft grid
const SNAP_ENDPOINT_THRESHOLD = 12 // inches — endpoint snap radius
const SNAP_ANGLE_DEG = 15 // degrees — rotation snap increment when snap ON

interface FloorEditorOverlayProps {
  studioId: string
  wallConfig: WallConfig
  tables: FloorTable[]
  setTables: (tables: FloorTable[] | ((prev: FloorTable[]) => FloorTable[])) => void
  onSaveAndExit: () => void
  /** 'tables' = place/move tables and models; 'walls' = move and rotate walls */
  mode?: 'tables' | 'walls'
  /** Called when wall positions/rotations change (walls mode). */
  onWallConfigChange?: (config: WallConfig) => void
}

const VIEW_WIDTH = 700
const VIEW_HEIGHT = 500

const PADDING = 40

function getUniformScale(bounds: { minX: number; maxX: number; minZ: number; maxZ: number }): {
  scale: number; offsetX: number; offsetY: number; usedWidth: number; usedHeight: number
} {
  const floorWidth = bounds.maxX - bounds.minX
  const floorDepth = bounds.maxZ - bounds.minZ
  const sx = (VIEW_WIDTH - 2 * PADDING) / floorWidth
  const sz = (VIEW_HEIGHT - 2 * PADDING) / floorDepth
  const scale = Math.min(sx, sz)
  const usedWidth = floorWidth * scale
  const usedHeight = floorDepth * scale
  const offsetX = (VIEW_WIDTH - usedWidth) / 2
  const offsetY = (VIEW_HEIGHT - usedHeight) / 2
  return { scale, offsetX, offsetY, usedWidth, usedHeight }
}

function worldToScreen(
  x: number,
  z: number,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
): [number, number] {
  const { minX, maxZ } = bounds
  const { scale, offsetX, offsetY } = getUniformScale(bounds)
  const px = offsetX + (x - minX) * scale
  const py = offsetY + (maxZ - z) * scale
  return [px, py]
}


function snapToGrid(v: number, grid: number): number {
  return Math.round(v / grid) * grid
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI
  while (a <= -Math.PI) a += 2 * Math.PI
  return a
}

function normalizeAngle(a: number): number {
  return ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
}

export default function FloorEditorOverlay({
  studioId,
  wallConfig,
  tables,
  setTables,
  onSaveAndExit,
  mode = 'tables',
  onWallConfigChange,
}: FloorEditorOverlayProps) {
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null)
  const [uploadingTableId, setUploadingTableId] = useState<string | null>(null)
  const [draggingTableId, setDraggingTableId] = useState<string | null>(null)
  const [dragStart, setDragStart] = useState<{ x: number; z: number; startPx: number; startPy: number } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Snap toggle
  const [snapOn, setSnapOn] = useState(true)

  // Walls mode: drag/rotate/stretch state
  const [draggingWallIndex, setDraggingWallIndex] = useState<number | null>(null)
  const [wallDragStart, setWallDragStart] = useState<{ x: number; z: number; startPx: number; startPy: number } | null>(null)
  // Ghost position for move snap preview (world coords)
  const [ghostWallPos, setGhostWallPos] = useState<{ index: number; x: number; z: number } | null>(null)

  const [rotatingWallIndex, setRotatingWallIndex] = useState<number | null>(null)
  const [rotateStart, setRotateStart] = useState<{
    centerClientX: number
    centerClientY: number
    initialAngleFromCenter: number
    initialRotationY: number
  } | null>(null)

  const [stretchingWallIndex, setStretchingWallIndex] = useState<number | null>(null)
  const [stretchStart, setStretchStart] = useState<{
    end: 'start' | 'end'
    startPx: number
    startPy: number
    initialWidthInches: number
    initialCenterX: number
    initialCenterZ: number
    axisX: number
    axisZ: number
  } | null>(null)
  // Endpoint snap target for stretch (world coords of the snapping endpoint on another wall)
  const [stretchSnapTarget, setStretchSnapTarget] = useState<{ px: number; py: number } | null>(null)

  const floorPlanRef = useRef<HTMLDivElement>(null)

  // Undo/redo for walls mode
  const [undoHistory, setUndoHistory] = useState<WallConfig[]>([])
  const [undoIndex, setUndoIndex] = useState(-1)
  const lastAppliedWallConfigRef = useRef<WallConfig | null>(null)
  const undoHistoryRef = useRef<WallConfig[]>([])
  const undoIndexRef = useRef(0)
  undoHistoryRef.current = undoHistory
  undoIndexRef.current = undoIndex

  const bounds = calculateFloorBounds(wallConfig)
  const { minX, maxX, minZ, maxZ, floorWidth, floorDepth } = bounds

  // Uniform scale (px per inch) — same factor for X and Z so grid cells are square
  const { scale: uniformScale, offsetX: floorOffsetX, offsetY: floorOffsetY, usedWidth: floorUsedWidth, usedHeight: floorUsedHeight } = getUniformScale(bounds)
  // World-per-pixel conversion used in drag handlers
  const invScale = 1 / uniformScale

  // When entering walls mode with no custom transforms, freeze current layout
  useEffect(() => {
    if (mode !== 'walls' || !onWallConfigChange) return
    const hasCustom = (wallConfig.customTransforms?.length ?? 0) >= wallConfig.walls.length
    if (hasCustom) return
    const customTransforms: WallTransformOverride[] = wallConfig.walls.map((_, i) => {
      const t = getWallTransform(wallConfig, i)
      return { x: t.x, z: t.z, rotationY: t.rotationY }
    })
    const next = { ...wallConfig, customTransforms }
    onWallConfigChange(next)
  }, [mode])

  // Initialize undo history when entering walls mode
  useEffect(() => {
    if (mode !== 'walls') return
    setUndoHistory((prev) => (prev.length === 0 ? [wallConfig] : prev))
    setUndoIndex(0)
    lastAppliedWallConfigRef.current = null
  }, [mode])
  useEffect(() => {
    if (mode !== 'walls' || undoHistory.length !== 1 || undoIndex !== 0) return
    setUndoHistory([wallConfig])
  }, [mode, wallConfig])

  // Undo/redo keyboard shortcuts
  useEffect(() => {
    if (mode !== 'walls' || !onWallConfigChange) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const history = undoHistoryRef.current
      const idx = undoIndexRef.current
      if (history.length === 0) return
      if (e.key === 'z') {
        e.preventDefault()
        if (e.shiftKey) {
          if (idx < history.length - 1) { const ni = idx + 1; setUndoIndex(ni); onWallConfigChange(history[ni]) }
        } else {
          if (idx > 0) { const ni = idx - 1; setUndoIndex(ni); onWallConfigChange(history[ni]) }
        }
        return
      }
      if (e.key === 'y') {
        e.preventDefault()
        if (idx < history.length - 1) { const ni = idx + 1; setUndoIndex(ni); onWallConfigChange(history[ni]) }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [mode, onWallConfigChange])

  // ── Tables mode handlers ──────────────────────────────────────────────────

  const handleAddTable = useCallback(() => {
    const id = `table-${Date.now()}`
    const newTable: FloorTable = {
      id,
      x: (minX + maxX) / 2 - DEFAULT_TABLE_WIDTH / 2,
      z: (minZ + maxZ) / 2 - DEFAULT_TABLE_DEPTH / 2,
      width: DEFAULT_TABLE_WIDTH,
      depth: DEFAULT_TABLE_DEPTH,
      rotation: 0,
    }
    setTables((prev) => [...prev, newTable])
    setSelectedTableId(id)
  }, [minX, maxX, minZ, maxZ, setTables])

  const handleRotateTable = useCallback(
    (tableId: string, e: React.PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setTables((prev) =>
        prev.map((t) => t.id === tableId ? { ...t, rotation: (t.rotation ?? 0) + Math.PI / 2 } : t)
      )
    },
    [setTables]
  )

  const handleTableFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      const tableId = selectedTableId
      if (!file || !tableId) return
      const isGlb = file.name.toLowerCase().endsWith('.glb') || file.name.toLowerCase().endsWith('.gltf')
      if (!isGlb) { toast.error('Please select a .glb or .gltf file.'); e.target.value = ''; return }
      try {
        setUploadingTableId(tableId)
        const formData = new FormData()
        formData.append('model', file)
        formData.append('studioId', studioId)
        const response = await fetch('/api/upload-model', { method: 'POST', body: formData })
        const data = await response.json().catch(() => ({} as { error?: string; url?: string }))
        if (!response.ok || !data.url) throw new Error(data.error || `Upload failed (${response.status})`)
        setTables((prev) => prev.map((t) => (t.id === tableId ? { ...t, modelUrl: data.url } : t)))
        toast.success('3D model uploaded')
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Please try again.'
        toast.error(`Could not upload model. ${message}`)
      } finally {
        setUploadingTableId(null)
        e.target.value = ''
      }
    },
    [selectedTableId, setTables, studioId]
  )

  const handlePointerDownOnTable = useCallback(
    (tableId: string, e: React.PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setSelectedTableId(tableId)
      const table = tables.find((t) => t.id === tableId)
      if (!table) return
      setDraggingTableId(tableId)
      setDragStart({ x: table.x, z: table.z, startPx: e.clientX, startPy: e.clientY })
    },
    [tables]
  )

  // ── Walls mode helpers ────────────────────────────────────────────────────

  const ensureCustomTransforms = useCallback(
    (cfg: WallConfig, upToIndex: number): WallTransformOverride[] => {
      const custom = [...(cfg.customTransforms ?? [])]
      while (custom.length <= upToIndex) {
        const t = getWallTransform(cfg, custom.length)
        custom.push({ x: t.x, z: t.z, rotationY: t.rotationY })
      }
      return custom
    },
    []
  )

  // ── Wall endpoints for snap reference ────────────────────────────────────
  const getWallEndpoints = useCallback(
    (cfg: WallConfig): Array<{ wallIndex: number; end: 'start' | 'end'; x: number; z: number }> => {
      return cfg.walls.flatMap((_, i) => {
        const t = getWallTransformResolved(cfg, i)
        const cos = Math.cos(t.rotationY)
        const sin = Math.sin(t.rotationY)
        const halfW = t.width / 2
        return [
          { wallIndex: i, end: 'start' as const, x: t.x - halfW * cos, z: t.z - halfW * sin },
          { wallIndex: i, end: 'end' as const, x: t.x + halfW * cos, z: t.z + halfW * sin },
        ]
      })
    },
    []
  )

  // ── Unified pointer move ──────────────────────────────────────────────────

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      // ── Wall drag (move) ──
      if (draggingWallIndex !== null && wallDragStart && onWallConfigChange) {
        const deltaPx = e.clientX - wallDragStart.startPx
        const deltaPy = e.clientY - wallDragStart.startPy
        let newX = wallDragStart.x + deltaPx * invScale
        let newZ = wallDragStart.z - deltaPy * invScale

        if (snapOn) {
          newX = snapToGrid(newX, GRID_INCHES)
          newZ = snapToGrid(newZ, GRID_INCHES)
        }

        setGhostWallPos({ index: draggingWallIndex, x: newX, z: newZ })

        const custom = ensureCustomTransforms(wallConfig, draggingWallIndex)
        custom[draggingWallIndex] = { ...custom[draggingWallIndex], x: newX, z: newZ }
        const nextConfig = { ...wallConfig, customTransforms: custom }
        lastAppliedWallConfigRef.current = nextConfig
        onWallConfigChange(nextConfig)
        setWallDragStart((s) => (s ? { ...s, x: newX, z: newZ, startPx: e.clientX, startPy: e.clientY } : null))
        return
      }

      // ── Wall rotate ──
      if (rotatingWallIndex !== null && rotateStart && onWallConfigChange) {
        const dx = e.clientX - rotateStart.centerClientX
        const dy = e.clientY - rotateStart.centerClientY
        const currentAngle = Math.atan2(dy, dx)
        const delta = wrapAngle(currentAngle - rotateStart.initialAngleFromCenter)
        let newRotationY = rotateStart.initialRotationY - delta

        if (e.shiftKey) {
          // Shift: 90° snap regardless of snapOn
          const SNAP_RAD = Math.PI / 2
          newRotationY = Math.round(newRotationY / SNAP_RAD) * SNAP_RAD
        } else if (snapOn) {
          const SNAP_RAD = (SNAP_ANGLE_DEG * Math.PI) / 180
          newRotationY = Math.round(newRotationY / SNAP_RAD) * SNAP_RAD
        }

        const custom = ensureCustomTransforms(wallConfig, rotatingWallIndex)
        custom[rotatingWallIndex] = { ...custom[rotatingWallIndex], rotationY: newRotationY }
        const nextConfig = { ...wallConfig, customTransforms: custom }
        lastAppliedWallConfigRef.current = nextConfig
        onWallConfigChange(nextConfig)
        return
      }

      // ── Wall stretch ──
      if (stretchingWallIndex !== null && stretchStart && onWallConfigChange) {
        const deltaPx = e.clientX - stretchStart.startPx
        const deltaPy = e.clientY - stretchStart.startPy
        const deltaX = deltaPx * invScale
        const deltaZ = -deltaPy * invScale
        const deltaAlong = deltaX * stretchStart.axisX + deltaZ * stretchStart.axisZ
        const signedDelta = stretchStart.end === 'end' ? deltaAlong : -deltaAlong
        const MIN_WALL_INCHES = 24
        let nextWidthInches = Math.max(MIN_WALL_INCHES, stretchStart.initialWidthInches + signedDelta)
        let widthDelta = nextWidthInches - stretchStart.initialWidthInches
        let centerShift = widthDelta / 2
        const centerSign = stretchStart.end === 'end' ? 1 : -1
        let nextCenterX = stretchStart.initialCenterX + stretchStart.axisX * centerShift * centerSign
        let nextCenterZ = stretchStart.initialCenterZ + stretchStart.axisZ * centerShift * centerSign

        // Endpoint snap: find nearest other wall's endpoint
        let snapTarget: { px: number; py: number } | null = null
        if (snapOn) {
          const allEndpoints = getWallEndpoints(wallConfig)
          // Current moved endpoint world coords
          const movedEndX = nextCenterX + stretchStart.axisX * (nextWidthInches / 2) * (stretchStart.end === 'end' ? 1 : -1)
          const movedEndZ = nextCenterZ + stretchStart.axisZ * (nextWidthInches / 2) * (stretchStart.end === 'end' ? 1 : -1)

          let bestDist = SNAP_ENDPOINT_THRESHOLD
          let bestEp: { x: number; z: number } | null = null
          for (const ep of allEndpoints) {
            if (ep.wallIndex === stretchingWallIndex) continue
            const d = Math.sqrt((ep.x - movedEndX) ** 2 + (ep.z - movedEndZ) ** 2)
            if (d < bestDist) { bestDist = d; bestEp = ep }
          }
          if (bestEp) {
            // Snap: recompute width and center so moved endpoint lands on bestEp
            const snapDist = Math.sqrt(
              (bestEp.x - stretchStart.initialCenterX) ** 2 + (bestEp.z - stretchStart.initialCenterZ) ** 2
            )
            const dotSign = stretchStart.end === 'end' ? 1 : -1
            const projAlongAxis =
              (bestEp.x - stretchStart.initialCenterX) * stretchStart.axisX * dotSign +
              (bestEp.z - stretchStart.initialCenterZ) * stretchStart.axisZ * dotSign
            nextWidthInches = Math.max(MIN_WALL_INCHES, projAlongAxis * 2)
            widthDelta = nextWidthInches - stretchStart.initialWidthInches
            centerShift = widthDelta / 2
            nextCenterX = stretchStart.initialCenterX + stretchStart.axisX * centerShift * centerSign
            nextCenterZ = stretchStart.initialCenterZ + stretchStart.axisZ * centerShift * centerSign
            snapTarget = { px: worldToScreen(bestEp.x, bestEp.z, bounds)[0], py: worldToScreen(bestEp.x, bestEp.z, bounds)[1] }
            void snapDist
          }
        }
        setStretchSnapTarget(snapTarget)

        const nextWalls = wallConfig.walls.map((wall, idx) =>
          idx === stretchingWallIndex ? { ...wall, width: nextWidthInches / 12 } : wall
        )
        const custom = ensureCustomTransforms(wallConfig, stretchingWallIndex)
        custom[stretchingWallIndex] = { ...custom[stretchingWallIndex], x: nextCenterX, z: nextCenterZ }
        const nextConfig = { ...wallConfig, walls: nextWalls, customTransforms: custom }
        lastAppliedWallConfigRef.current = nextConfig
        onWallConfigChange(nextConfig)
        return
      }

      // ── Table drag ──
      if (!draggingTableId || !dragStart) return
      const deltaPx = e.clientX - dragStart.startPx
      const deltaPy = e.clientY - dragStart.startPy
      const newX = dragStart.x + deltaPx * invScale
      const newZ = dragStart.z - deltaPy * invScale
      setTables((prev) => prev.map((t) => t.id === draggingTableId ? { ...t, x: newX, z: newZ } : t))
      setDragStart((s) => (s ? { ...s, x: newX, z: newZ, startPx: e.clientX, startPy: e.clientY } : null))
    },
    [
      draggingWallIndex, wallDragStart, rotatingWallIndex, rotateStart,
      stretchingWallIndex, stretchStart, draggingTableId, dragStart,
      invScale, setTables, wallConfig, onWallConfigChange, snapOn,
      ensureCustomTransforms, getWallEndpoints, bounds,
    ]
  )

  const handlePointerUp = useCallback(() => {
    if (mode === 'walls' && onWallConfigChange &&
      (draggingWallIndex !== null || rotatingWallIndex !== null || stretchingWallIndex !== null)) {
      const configToPush = lastAppliedWallConfigRef.current ?? wallConfig
      // Normalize rotation on commit
      if (rotatingWallIndex !== null && configToPush.customTransforms?.[rotatingWallIndex]) {
        const ct = [...configToPush.customTransforms!]
        ct[rotatingWallIndex] = {
          ...ct[rotatingWallIndex],
          rotationY: normalizeAngle(ct[rotatingWallIndex].rotationY),
        }
        const normalized = { ...configToPush, customTransforms: ct }
        onWallConfigChange(normalized)
        setUndoHistory((prev) => { const t = prev.slice(0, undoIndex + 1); t.push(normalized); return t })
      } else {
        setUndoHistory((prev) => { const t = prev.slice(0, undoIndex + 1); t.push(configToPush); return t })
      }
      setUndoIndex((prev) => prev + 1)
      lastAppliedWallConfigRef.current = null
    }
    setGhostWallPos(null)
    setStretchSnapTarget(null)
    setDraggingTableId(null)
    setDragStart(null)
    setDraggingWallIndex(null)
    setWallDragStart(null)
    setRotatingWallIndex(null)
    setRotateStart(null)
    setStretchingWallIndex(null)
    setStretchStart(null)
  }, [mode, onWallConfigChange, draggingWallIndex, rotatingWallIndex, stretchingWallIndex, wallConfig, undoIndex])

  // ── Wall interaction starters ─────────────────────────────────────────────

  const handleWallPointerDown = useCallback(
    (index: number, e: React.PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (!onWallConfigChange) return
      const transform = getWallTransformResolved(wallConfig, index)
      setDraggingWallIndex(index)
      setWallDragStart({ x: transform.x, z: transform.z, startPx: e.clientX, startPy: e.clientY })
    },
    [wallConfig, onWallConfigChange]
  )

  const handleWallRotatePointerDown = useCallback(
    (index: number, e: React.PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (!onWallConfigChange) return
      const transform = getWallTransformResolved(wallConfig, index)
      const [centerPx, centerPy] = worldToScreen(transform.x, transform.z, bounds)
      const rect = floorPlanRef.current?.getBoundingClientRect()
      if (!rect) return
      const centerClientX = rect.left + centerPx
      const centerClientY = rect.top + centerPy
      const dx = e.clientX - centerClientX
      const dy = e.clientY - centerClientY
      setRotatingWallIndex(index)
      setRotateStart({
        centerClientX,
        centerClientY,
        initialAngleFromCenter: Math.atan2(dy, dx),
        initialRotationY: transform.rotationY,
      })
    },
    [wallConfig, bounds, onWallConfigChange]
  )

  const handleWallStretchPointerDown = useCallback(
    (index: number, end: 'start' | 'end', e: React.PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (!onWallConfigChange) return
      const transform = getWallTransformResolved(wallConfig, index)
      const axisX = Math.cos(transform.rotationY)
      const axisZ = Math.sin(transform.rotationY)
      setStretchingWallIndex(index)
      setStretchStart({
        end,
        startPx: e.clientX,
        startPy: e.clientY,
        initialWidthInches: transform.width,
        initialCenterX: transform.x,
        initialCenterZ: transform.z,
        axisX,
        axisZ,
      })
    },
    [wallConfig, onWallConfigChange]
  )

  const handleAddWall = useCallback(() => {
    if (!onWallConfigChange) return
    const newWall = { height: 10, width: 8 }
    const newWalls = [...wallConfig.walls, newWall]
    const newConfigBase = { ...wallConfig, walls: newWalls }
    const t = getWallTransform(newConfigBase, newWalls.length - 1)
    const newCustom = ensureCustomTransforms(wallConfig, newWalls.length - 2)
    newCustom.push({ x: t.x, z: t.z, rotationY: t.rotationY })
    const next = { ...wallConfig, walls: newWalls, customTransforms: newCustom }
    onWallConfigChange(next)
    setUndoHistory((prev) => [...prev.slice(0, undoIndex + 1), next])
    setUndoIndex((prev) => prev + 1)
  }, [wallConfig, onWallConfigChange, undoIndex, ensureCustomTransforms])

  const handleRemoveWall = useCallback(() => {
    if (!onWallConfigChange || wallConfig.walls.length <= 1) return
    const newWalls = wallConfig.walls.slice(0, -1)
    const newCustom = wallConfig.customTransforms?.slice(0, -1) ?? []
    const next = { ...wallConfig, walls: newWalls, customTransforms: newCustom }
    onWallConfigChange(next)
    setUndoHistory((prev) => [...prev.slice(0, undoIndex + 1), next])
    setUndoIndex((prev) => prev + 1)
  }, [wallConfig, onWallConfigChange, undoIndex])

  // ── Compute wall geometry for rendering ───────────────────────────────────

  const wallGeometry = wallConfig.walls.map((_, index) => {
    const transform = getWallTransformResolved(wallConfig, index)
    const halfW = transform.width / 2
    const halfD = 3 // half-thickness = 3 inches
    const cos = Math.cos(transform.rotationY)
    const sin = Math.sin(transform.rotationY)

    // 4 corners of the wall rectangle in world space
    const worldCorners = [
      [transform.x - halfW * cos + halfD * sin, transform.z - halfW * sin - halfD * cos], // 0: start-back
      [transform.x + halfW * cos + halfD * sin, transform.z + halfW * sin - halfD * cos], // 1: end-back
      [transform.x + halfW * cos - halfD * sin, transform.z + halfW * sin + halfD * cos], // 2: end-front
      [transform.x - halfW * cos - halfD * sin, transform.z - halfW * sin + halfD * cos], // 3: start-front
    ]
    const screenCorners = worldCorners.map(([x, z]) => worldToScreen(x, z, bounds))
    const points = screenCorners.flat()

    // Front edge = corners 2→3 (slate-400, 2px)
    const frontEdge: [number, number, number, number] = [
      screenCorners[2][0], screenCorners[2][1],
      screenCorners[3][0], screenCorners[3][1],
    ]

    // Endpoints (midpoints of short ends): start = midpoint(0,3), end = midpoint(1,2)
    const startX = transform.x - halfW * cos
    const startZ = transform.z - halfW * sin
    const endX = transform.x + halfW * cos
    const endZ = transform.z + halfW * sin
    const [startPx, startPy] = worldToScreen(startX, startZ, bounds)
    const [endPx, endPy] = worldToScreen(endX, endZ, bounds)

    // Rotate handle: midpoint of front edge offset 24px outward in screen space
    // Front edge midpoint in world = center offset by +halfD in local Z (the +sin/-cos direction)
    const frontMidWorldX = transform.x + halfD * sin  // local +Z = (sin, -cos) in world XZ
    const frontMidWorldZ = transform.z - halfD * cos
    const [frontMidPx, frontMidPy] = worldToScreen(frontMidWorldX, frontMidWorldZ, bounds)

    // Offset 24px outward from wall center direction
    const [centerPx, centerPy] = worldToScreen(transform.x, transform.z, bounds)
    const outDx = frontMidPx - centerPx
    const outDy = frontMidPy - centerPy
    const outLen = Math.sqrt(outDx * outDx + outDy * outDy) || 1
    const handlePx = frontMidPx + (outDx / outLen) * 24
    const handlePy = frontMidPy + (outDy / outLen) * 24

    return {
      index,
      points,
      screenCorners,
      frontEdge,
      startPx, startPy,
      endPx, endPy,
      centerPx, centerPy,
      frontMidPx, frontMidPy,
      handlePx, handlePy,
    }
  })

  // ── Grid pattern coords ───────────────────────────────────────────────────
  // World-aligned 12-inch grid lines, clipped to the actual floor rect.
  const gridLines: Array<{ x1: number; y1: number; x2: number; y2: number }> = []
  if (mode === 'walls') {
    const startGridX = Math.ceil(minX / GRID_INCHES) * GRID_INCHES
    const endGridX = Math.floor(maxX / GRID_INCHES) * GRID_INCHES
    const startGridZ = Math.ceil(minZ / GRID_INCHES) * GRID_INCHES
    const endGridZ = Math.floor(maxZ / GRID_INCHES) * GRID_INCHES

    for (let gx = startGridX; gx <= endGridX; gx += GRID_INCHES) {
      const [px] = worldToScreen(gx, 0, bounds)
      gridLines.push({ x1: px, y1: floorOffsetY, x2: px, y2: floorOffsetY + floorUsedHeight })
    }
    for (let gz = startGridZ; gz <= endGridZ; gz += GRID_INCHES) {
      const [, py] = worldToScreen(0, gz, bounds)
      gridLines.push({ x1: floorOffsetX, y1: py, x2: floorOffsetX + floorUsedWidth, y2: py })
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden flex flex-col"
        style={{ width: VIEW_WIDTH + 48, maxHeight: '90vh' }}
      >
        {/* Header */}
        <div className="shrink-0 border-b border-gray-200">
          <div className="flex items-center justify-between px-6 py-4">
            <h2 className="text-lg font-semibold text-gray-900">
              {mode === 'walls' ? 'Floor plan – reconfigure walls' : 'Floor plan – place tables'}
            </h2>
            <div className="flex items-center gap-2">
              {mode === 'tables' && (
                <button
                  type="button"
                  onClick={handleAddTable}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-medium transition-colors shadow-sm"
                >
                  <Plus className="w-4 h-4" />
                  Add table
                </button>
              )}
              <button
                type="button"
                onClick={() => onSaveAndExit()}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-medium transition-colors shadow-sm"
              >
                Save & exit
              </button>
              <button
                type="button"
                onClick={() => onSaveAndExit()}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                aria-label="Close"
              >
                <X className="w-5 h-5 text-gray-600" />
              </button>
            </div>
          </div>

          {mode === 'walls' && (
            <div className="flex items-center gap-2 px-6 pb-4">
              <button
                type="button"
                onClick={handleAddWall}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-medium transition-colors shadow-sm"
              >
                <Plus className="w-4 h-4" />
                Add wall
              </button>
              <button
                type="button"
                onClick={handleRemoveWall}
                disabled={wallConfig.walls.length <= 1}
                className="flex items-center gap-2 px-4 py-2 bg-slate-200 hover:bg-slate-300 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 rounded-xl text-sm font-medium transition-colors shadow-sm"
              >
                <Trash2 className="w-4 h-4" />
                Remove wall
              </button>
              <button
                type="button"
                onClick={() => setSnapOn((v) => !v)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors shadow-sm ${
                  snapOn
                    ? 'bg-indigo-100 text-indigo-700 border border-indigo-300 hover:bg-indigo-200'
                    : 'bg-slate-100 text-slate-500 border border-slate-200 hover:bg-slate-200'
                }`}
                title={snapOn ? 'Snap on — click to turn off' : 'Snap off — click to turn on'}
              >
                <Magnet className="w-4 h-4" />
                Snap {snapOn ? 'on' : 'off'}
              </button>
            </div>
          )}
        </div>

        <div className="p-6 overflow-auto">
          <p className="text-sm text-gray-500 mb-4">
            {mode === 'walls'
              ? 'Top-down view. Drag walls to move. Drag endpoint handles to resize. Use the circle handle on the front edge to rotate (Shift = 90°, Snap = 15°). Ctrl+Z undo, Ctrl+Y redo.'
              : 'Top-down view. Drag tables to move. Click a table then "Add model" to place a 3D model on it.'}
          </p>

          {/* Floor plan canvas */}
          <div
            ref={floorPlanRef}
            className="relative rounded-lg overflow-hidden"
            style={{ width: VIEW_WIDTH, height: VIEW_HEIGHT }}
          >
            <svg
              className="absolute inset-0 w-full h-full"
              viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
              preserveAspectRatio="none"
              style={{ pointerEvents: mode === 'walls' ? 'none' : 'none' }}
            >
              {/* Floor background */}
              <rect
                x={floorOffsetX} y={floorOffsetY}
                width={floorUsedWidth}
                height={floorUsedHeight}
                fill="#faf9f6"
                stroke="#cbd5e1"
                strokeWidth={1}
              />

              {/* 12-inch grid */}
              {mode === 'walls' && gridLines.map((l, i) => (
                <line
                  key={i}
                  x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
                  stroke="#e2e8f0"
                  strokeWidth={0.5}
                />
              ))}

              {/* Wall polygons */}
              {wallGeometry.map(({ index, points, frontEdge }) => (
                <g key={index}>
                  <polygon
                    points={points.join(',')}
                    fill="#4f46e5"
                    stroke="#3730a3"
                    strokeWidth={0.5}
                    className={mode === 'walls' ? 'cursor-move' : ''}
                    style={{ pointerEvents: mode === 'walls' ? 'all' : 'none' }}
                    onPointerDown={mode === 'walls' ? (e) => handleWallPointerDown(index, e) : undefined}
                  />
                  {/* Front-edge indicator: slate-400, 2px */}
                  {mode === 'walls' && (
                    <line
                      x1={frontEdge[0]} y1={frontEdge[1]}
                      x2={frontEdge[2]} y2={frontEdge[3]}
                      stroke="#94a3b8"
                      strokeWidth={2}
                      strokeLinecap="round"
                      style={{ pointerEvents: 'none' }}
                    />
                  )}
                </g>
              ))}

              {/* Ghost overlay for move-snap preview */}
              {mode === 'walls' && ghostWallPos && snapOn && (() => {
                const idx = ghostWallPos.index
                const transform = getWallTransformResolved(wallConfig, idx)
                const halfW = transform.width / 2
                const halfD = 3
                const cos = Math.cos(transform.rotationY)
                const sin = Math.sin(transform.rotationY)
                const snappedCorners = [
                  [ghostWallPos.x - halfW * cos + halfD * sin, ghostWallPos.z - halfW * sin - halfD * cos],
                  [ghostWallPos.x + halfW * cos + halfD * sin, ghostWallPos.z + halfW * sin - halfD * cos],
                  [ghostWallPos.x + halfW * cos - halfD * sin, ghostWallPos.z + halfW * sin + halfD * cos],
                  [ghostWallPos.x - halfW * cos - halfD * sin, ghostWallPos.z - halfW * sin + halfD * cos],
                ]
                const ghostPoints = snappedCorners.map(([x, z]) => worldToScreen(x, z, bounds)).flat()
                return (
                  <polygon
                    points={ghostPoints.join(',')}
                    fill="none"
                    stroke="#4f46e5"
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                    opacity={0.5}
                    style={{ pointerEvents: 'none' }}
                  />
                )
              })()}

              {/* Rotate handle lines (wall center → handle) */}
              {mode === 'walls' && wallGeometry.map(({ index, centerPx, centerPy, handlePx, handlePy }) => (
                <line
                  key={`rline-${index}`}
                  x1={centerPx} y1={centerPy}
                  x2={handlePx} y2={handlePy}
                  stroke="#4f46e5"
                  strokeWidth={1}
                  style={{ pointerEvents: 'none' }}
                />
              ))}

              {/* Rotate handle circles */}
              {mode === 'walls' && wallGeometry.map(({ index, handlePx, handlePy }) => (
                <circle
                  key={`rhandle-${index}`}
                  cx={handlePx} cy={handlePy} r={5}
                  fill="#4f46e5"
                  style={{ pointerEvents: 'all', cursor: 'crosshair' }}
                  onPointerDown={(e) => handleWallRotatePointerDown(index, e)}
                />
              ))}

              {/* Stretch endpoint circles (visible) */}
              {mode === 'walls' && wallGeometry.map(({ index, startPx, startPy, endPx, endPy }) => (
                <g key={`stretch-vis-${index}`} style={{ pointerEvents: 'none' }}>
                  <circle cx={startPx} cy={startPy} r={4} fill="#ffffff" stroke="#4f46e5" strokeWidth={1.5} />
                  <circle cx={endPx} cy={endPy} r={4} fill="#ffffff" stroke="#4f46e5" strokeWidth={1.5} />
                </g>
              ))}

              {/* Stretch snap target marker */}
              {stretchSnapTarget && (
                <circle
                  cx={stretchSnapTarget.px} cy={stretchSnapTarget.py} r={6}
                  fill="none"
                  stroke="#4f46e5"
                  strokeWidth={1.5}
                  style={{ pointerEvents: 'none' }}
                />
              )}
            </svg>

            {/* Stretch invisible hitbox divs (20×20, easier grab) */}
            {mode === 'walls' && wallGeometry.flatMap(({ index, startPx, startPy, endPx, endPy, centerPx, centerPy }) => {
              const dx = endPx - startPx
              const dy = endPy - startPy
              const stretchCursor = Math.abs(dy) > Math.abs(dx) ? 'ns-resize' : 'ew-resize'
              void centerPx; void centerPy
              return [
                <div
                  key={`sh-start-${index}`}
                  className="absolute"
                  style={{ left: startPx - 10, top: startPy - 10, width: 20, height: 20, cursor: stretchCursor }}
                  onPointerDown={(e) => handleWallStretchPointerDown(index, 'start', e)}
                />,
                <div
                  key={`sh-end-${index}`}
                  className="absolute"
                  style={{ left: endPx - 10, top: endPy - 10, width: 20, height: 20, cursor: stretchCursor }}
                  onPointerDown={(e) => handleWallStretchPointerDown(index, 'end', e)}
                />,
              ]
            })}

            {/* Tables (tables mode only) */}
            {mode === 'tables' && tables.map((table) => {
              const [px, py] = worldToScreen(table.x, table.z, bounds)
              const w = table.width * uniformScale
              const h = table.depth * uniformScale
              const isSelected = selectedTableId === table.id
              const rotationDeg = ((table.rotation ?? 0) * 180) / Math.PI
              return (
                <div
                  key={table.id}
                  role="button"
                  tabIndex={0}
                  onPointerDown={(e) => handlePointerDownOnTable(table.id, e)}
                  className="absolute cursor-move rounded-lg border-2 flex flex-col items-center justify-center overflow-visible"
                  style={{
                    left: px - w / 2, top: py - h / 2,
                    width: w, height: h, minWidth: 24, minHeight: 18,
                    transform: `rotate(${rotationDeg}deg)`,
                    transformOrigin: '50% 50%',
                    borderColor: isSelected ? '#6366f1' : '#94a3b8',
                    backgroundColor: isSelected ? 'rgba(99,102,241,0.15)' : 'rgba(148,163,184,0.2)',
                  }}
                >
                  <span className="text-[10px] font-medium truncate px-1" style={{ color: isSelected ? '#4f46e5' : '#64748b' }}>
                    {table.modelUrl ? 'Model' : 'Table'}
                  </span>
                  {[['0%', '0%'], ['100%', '0%'], ['100%', '100%'], ['0%', '100%']].map(([left, top], i) => (
                    <div
                      key={i}
                      className="absolute w-6 h-6 cursor-pointer"
                      style={{ left, top, transform: 'translate(-50%,-50%)' }}
                      title="Rotate 90°"
                      onPointerDown={(e) => handleRotateTable(table.id, e)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ))}
                </div>
              )
            })}
          </div>

          {/* Legend */}
          {mode === 'walls' && (
            <p className="mt-2 text-xs text-slate-400">
              — thin slate edge = front (side boards attach to)
            </p>
          )}

          {/* Table inspector */}
          {mode === 'tables' && selectedTableId && (
            <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200 flex items-center gap-3 flex-wrap">
              <span className="text-sm font-medium text-gray-700">Selected table</span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".glb,.gltf"
                className="hidden"
                onChange={handleTableFileChange}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingTableId === selectedTableId}
                className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg text-sm font-medium text-gray-700 transition-colors"
              >
                <Upload className="w-4 h-4" />
                {uploadingTableId === selectedTableId ? 'Uploading…' : 'Add model'}
              </button>
              <button
                type="button"
                onClick={() => { setTables((prev) => prev.filter((t) => t.id !== selectedTableId)); setSelectedTableId(null) }}
                className="px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              >
                Remove table
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export { TABLE_HEIGHT_INCHES }
