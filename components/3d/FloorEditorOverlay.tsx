'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { calculateFloorBounds, getWallTransformResolved, getWallTransform } from '@/lib/wallLayout'
import type { WallConfig, WallTransformOverride } from '@/lib/wallLayout'
import type { FloorTable } from '@/types'
import { X, Plus, Upload, Trash2 } from 'lucide-react'
import { toast } from '@/lib/toast'

const TABLE_HEIGHT_INCHES = 18 // 1.5 feet
const DEFAULT_TABLE_WIDTH = 24
const DEFAULT_TABLE_DEPTH = 18

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
const ROTATE_CURSOR =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%236366f1' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8'/%3E%3Cpath d='M3 3v5h5'/%3E%3C/svg%3E\") 12 12, grab"

function worldToScreen(
  x: number,
  z: number,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
): [number, number] {
  const { minX, maxX, minZ, maxZ } = bounds
  const floorWidth = maxX - minX
  const floorDepth = maxZ - minZ
  const padding = 40
  const w = VIEW_WIDTH - padding * 2
  const h = VIEW_HEIGHT - padding * 2
  const px = padding + ((x - minX) / floorWidth) * w
  const py = padding + ((maxZ - z) / floorDepth) * h // +Z forward = up on screen
  return [px, py]
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

  // Walls mode: drag/rotate state
  const [draggingWallIndex, setDraggingWallIndex] = useState<number | null>(null)
  const [wallDragStart, setWallDragStart] = useState<{ x: number; z: number; startPx: number; startPy: number } | null>(null)
  const [rotatingWallIndex, setRotatingWallIndex] = useState<number | null>(null)
  const [rotateStart, setRotateStart] = useState<{ centerPx: number; centerPy: number; initialAngle: number; initialRotationY: number } | null>(null)
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
  const floorPlanRef = useRef<HTMLDivElement>(null)

  // Undo/redo for walls mode (Ctrl+Z / Ctrl+Y) – refs so keydown always sees latest
  const [undoHistory, setUndoHistory] = useState<WallConfig[]>([])
  const [undoIndex, setUndoIndex] = useState(-1)
  const lastAppliedWallConfigRef = useRef<WallConfig | null>(null)
  const undoHistoryRef = useRef<WallConfig[]>([])
  const undoIndexRef = useRef(0)
  undoHistoryRef.current = undoHistory
  undoIndexRef.current = undoIndex

  const bounds = calculateFloorBounds(wallConfig)
  const { minX, maxX, minZ, maxZ, floorWidth, floorDepth } = bounds

  // When entering walls mode with no custom transforms, freeze current layout so we can edit it
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

  // Initialize undo history when entering walls mode; keep single entry in sync until first user edit
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

  // Undo/redo keyboard shortcuts (walls mode only) – read from refs to avoid stale closure
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
          if (idx < history.length - 1) {
            const nextIndex = idx + 1
            setUndoIndex(nextIndex)
            onWallConfigChange(history[nextIndex])
          }
        } else {
          if (idx > 0) {
            const nextIndex = idx - 1
            setUndoIndex(nextIndex)
            onWallConfigChange(history[nextIndex])
          }
        }
        return
      }
      if (e.key === 'y') {
        e.preventDefault()
        if (idx < history.length - 1) {
          const nextIndex = idx + 1
          setUndoIndex(nextIndex)
          onWallConfigChange(history[nextIndex])
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [mode, onWallConfigChange])

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
        prev.map((t) =>
          t.id === tableId
            ? { ...t, rotation: (t.rotation ?? 0) + Math.PI / 2 }
            : t
        )
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
      if (!isGlb) {
        toast.error('Please select a .glb or .gltf file.')
        e.target.value = ''
        return
      }

      try {
        setUploadingTableId(tableId)
        const formData = new FormData()
        formData.append('model', file)
        formData.append('studioId', studioId)

        const response = await fetch('/api/upload-model', {
          method: 'POST',
          body: formData,
        })
        const data = await response.json().catch(() => ({} as { error?: string; url?: string }))
        if (!response.ok || !data.url) {
          throw new Error(data.error || `Upload failed (${response.status})`)
        }

        setTables((prev) =>
          prev.map((t) => (t.id === tableId ? { ...t, modelUrl: data.url } : t))
        )
        toast.success('3D model uploaded')
      } catch (error) {
        console.error('Model upload failed:', error)
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
      setDragStart({
        x: table.x,
        z: table.z,
        startPx: e.clientX,
        startPy: e.clientY,
      })
    },
    [tables]
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      // Wall drag (walls mode)
      if (draggingWallIndex !== null && wallDragStart && onWallConfigChange) {
        const deltaPx = e.clientX - wallDragStart.startPx
        const deltaPy = e.clientY - wallDragStart.startPy
        const scaleX = floorWidth / (VIEW_WIDTH - 80)
        const scaleZ = floorDepth / (VIEW_HEIGHT - 80)
        const newX = wallDragStart.x + deltaPx * scaleX
        const newZ = wallDragStart.z - deltaPy * scaleZ
        const custom = [...(wallConfig.customTransforms ?? [])]
        while (custom.length <= draggingWallIndex) {
          const t = getWallTransform(wallConfig, custom.length)
          custom.push({ x: t.x, z: t.z, rotationY: t.rotationY })
        }
        custom[draggingWallIndex] = { ...custom[draggingWallIndex], x: newX, z: newZ }
        const nextConfig = { ...wallConfig, customTransforms: custom }
        lastAppliedWallConfigRef.current = nextConfig
        onWallConfigChange(nextConfig)
        setWallDragStart((s) => (s ? { ...s, x: newX, z: newZ, startPx: e.clientX, startPy: e.clientY } : null))
        return
      }
      // Wall rotate (walls mode) – hold Shift to snap to 90°
      if (rotatingWallIndex !== null && rotateStart && onWallConfigChange) {
        const dx = e.clientX - rotateStart.centerPx
        const dy = e.clientY - rotateStart.centerPy
        const currentAngle = Math.atan2(dy, dx)
        let delta = currentAngle - rotateStart.initialAngle
        while (delta > Math.PI) delta -= 2 * Math.PI
        while (delta < -Math.PI) delta += 2 * Math.PI
        let newRotationY = rotateStart.initialRotationY + delta
        if (e.shiftKey) {
          const SNAP_RAD = Math.PI / 2
          newRotationY = Math.round(newRotationY / SNAP_RAD) * SNAP_RAD
          newRotationY = ((newRotationY % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
        }
        const custom = [...(wallConfig.customTransforms ?? [])]
        while (custom.length <= rotatingWallIndex) {
          const t = getWallTransform(wallConfig, custom.length)
          custom.push({ x: t.x, z: t.z, rotationY: t.rotationY })
        }
        custom[rotatingWallIndex] = { ...custom[rotatingWallIndex], rotationY: newRotationY }
        const nextConfig = { ...wallConfig, customTransforms: custom }
        lastAppliedWallConfigRef.current = nextConfig
        onWallConfigChange(nextConfig)
        setRotateStart((s) => s ? { ...s, initialAngle: currentAngle, initialRotationY: newRotationY } : null)
        return
      }
      // Wall stretch (walls mode)
      if (stretchingWallIndex !== null && stretchStart && onWallConfigChange) {
        const deltaPx = e.clientX - stretchStart.startPx
        const deltaPy = e.clientY - stretchStart.startPy
        const scaleX = floorWidth / (VIEW_WIDTH - 80)
        const scaleZ = floorDepth / (VIEW_HEIGHT - 80)
        const deltaX = deltaPx * scaleX
        const deltaZ = -deltaPy * scaleZ
        const deltaAlong = deltaX * stretchStart.axisX + deltaZ * stretchStart.axisZ
        const signedDelta = stretchStart.end === 'end' ? deltaAlong : -deltaAlong
        const MIN_WALL_INCHES = 24
        const nextWidthInches = Math.max(MIN_WALL_INCHES, stretchStart.initialWidthInches + signedDelta)
        const widthDelta = nextWidthInches - stretchStart.initialWidthInches
        const centerShift = widthDelta / 2
        const centerSign = stretchStart.end === 'end' ? 1 : -1
        const nextCenterX = stretchStart.initialCenterX + stretchStart.axisX * centerShift * centerSign
        const nextCenterZ = stretchStart.initialCenterZ + stretchStart.axisZ * centerShift * centerSign

        const nextWalls = wallConfig.walls.map((wall, idx) =>
          idx === stretchingWallIndex ? { ...wall, width: nextWidthInches / 12 } : wall
        )
        const custom = [...(wallConfig.customTransforms ?? [])]
        while (custom.length <= stretchingWallIndex) {
          const t = getWallTransform(wallConfig, custom.length)
          custom.push({ x: t.x, z: t.z, rotationY: t.rotationY })
        }
        custom[stretchingWallIndex] = { ...custom[stretchingWallIndex], x: nextCenterX, z: nextCenterZ }
        const nextConfig = { ...wallConfig, walls: nextWalls, customTransforms: custom }
        lastAppliedWallConfigRef.current = nextConfig
        onWallConfigChange(nextConfig)
        return
      }
      // Table drag (tables mode)
      if (!draggingTableId || !dragStart) return
      const deltaPx = e.clientX - dragStart.startPx
      const deltaPy = e.clientY - dragStart.startPy
      const scaleX = floorWidth / (VIEW_WIDTH - 80)
      const scaleZ = floorDepth / (VIEW_HEIGHT - 80)
      const newX = dragStart.x + deltaPx * scaleX
      const newZ = dragStart.z - deltaPy * scaleZ
      setTables((prev) =>
        prev.map((t) =>
          t.id === draggingTableId ? { ...t, x: newX, z: newZ } : t
        )
      )
      setDragStart((s) => (s ? { ...s, x: newX, z: newZ, startPx: e.clientX, startPy: e.clientY } : null))
    },
    [draggingWallIndex, wallDragStart, rotatingWallIndex, rotateStart, stretchingWallIndex, stretchStart, draggingTableId, dragStart, floorWidth, floorDepth, setTables, wallConfig, onWallConfigChange]
  )

  const handlePointerUp = useCallback(() => {
    // When ending a wall drag/rotate/stretch, push current state to undo history (walls mode)
    if (mode === 'walls' && onWallConfigChange && (draggingWallIndex !== null || rotatingWallIndex !== null || stretchingWallIndex !== null)) {
      const configToPush = lastAppliedWallConfigRef.current ?? wallConfig
      setUndoHistory((prev) => {
        const truncated = prev.slice(0, undoIndex + 1)
        truncated.push(configToPush)
        return truncated
      })
      setUndoIndex((prev) => prev + 1)
      lastAppliedWallConfigRef.current = null
    }
    setDraggingTableId(null)
    setDragStart(null)
    setDraggingWallIndex(null)
    setWallDragStart(null)
    setRotatingWallIndex(null)
    setRotateStart(null)
    setStretchingWallIndex(null)
    setStretchStart(null)
  }, [mode, onWallConfigChange, draggingWallIndex, rotatingWallIndex, stretchingWallIndex, wallConfig, undoIndex])

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

  const handleAddWall = useCallback(() => {
    if (!onWallConfigChange) return
    const newWall = { height: 10, width: 8 }
    const newWalls = [...wallConfig.walls, newWall]
    const newConfigBase = { ...wallConfig, walls: newWalls }
    const t = getWallTransform(newConfigBase, newWalls.length - 1)
    const newCustom = [...(wallConfig.customTransforms ?? [])]
    while (newCustom.length < newWalls.length - 1) {
      const prev = getWallTransform(wallConfig, newCustom.length)
      newCustom.push({ x: prev.x, z: prev.z, rotationY: prev.rotationY })
    }
    newCustom.push({ x: t.x, z: t.z, rotationY: t.rotationY })
    onWallConfigChange({ ...wallConfig, walls: newWalls, customTransforms: newCustom })
    setUndoHistory((prev) => [...prev.slice(0, undoIndex + 1), { ...wallConfig, walls: newWalls, customTransforms: newCustom }])
    setUndoIndex((prev) => prev + 1)
  }, [wallConfig, onWallConfigChange, undoIndex])

  const handleRemoveWall = useCallback(() => {
    if (!onWallConfigChange || wallConfig.walls.length <= 1) return
    const newWalls = wallConfig.walls.slice(0, -1)
    const newCustom = wallConfig.customTransforms?.slice(0, -1) ?? []
    onWallConfigChange({ ...wallConfig, walls: newWalls, customTransforms: newCustom })
    setUndoHistory((prev) => [...prev.slice(0, undoIndex + 1), { ...wallConfig, walls: newWalls, customTransforms: newCustom }])
    setUndoIndex((prev) => prev + 1)
  }, [wallConfig, onWallConfigChange, undoIndex])

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
        centerPx: centerClientX,
        centerPy: centerClientY,
        initialAngle: Math.atan2(dy, dx),
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

  // Wall outlines (top-down) for context; in walls mode include rotate handle and front-edge (side you can add boards to)
  const wallOutlines = wallConfig.walls.map((_, index) => {
    const transform = getWallTransformResolved(wallConfig, index)
    const halfW = transform.width / 2
    const halfD = 3
    const cos = Math.cos(transform.rotationY)
    const sin = Math.sin(transform.rotationY)
    const corners = [
      [transform.x - halfW * cos + halfD * sin, transform.z - halfW * sin - halfD * cos],
      [transform.x + halfW * cos + halfD * sin, transform.z + halfW * sin - halfD * cos],
      [transform.x + halfW * cos - halfD * sin, transform.z + halfW * sin + halfD * cos],
      [transform.x - halfW * cos - halfD * sin, transform.z - halfW * sin + halfD * cos],
    ]
    const points = corners.map(([x, z]) => worldToScreen(x, z, bounds)).flat()
    const endX = transform.x + halfW * cos
    const endZ = transform.z + halfW * sin
    const startX = transform.x - halfW * cos
    const startZ = transform.z - halfW * sin
    const [endPx, endPy] = worldToScreen(endX, endZ, bounds)
    const [startPx, startPy] = worldToScreen(startX, startZ, bounds)
    // Front edge = corners 2–3 (the side where you can add boards in the 3D room)
    const frontEdge = [points[4], points[5], points[6], points[7]] as [number, number, number, number]
    return { points, key: index, startPx, startPy, endPx, endPy, frontEdge }
  })

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
            </div>
          )}
        </div>

        <div className="p-6 overflow-auto">
          <p className="text-sm text-gray-500 mb-4">
            {mode === 'walls'
              ? 'Top-down view. Drag walls to move. Drag from wall endpoints to resize length. Use curved handle to rotate (hold Shift to snap to 90°). Ctrl+Z undo, Ctrl+Y redo. Green edge = front (side you can add boards to); opposite side is back.'
              : 'Top-down view. Drag tables to move. Click a table then "Add model" to place a 3D model on it.'}
          </p>

          <div
            ref={floorPlanRef}
            className="relative rounded-lg border-2 border-gray-300 bg-gray-50"
            style={{ width: VIEW_WIDTH, height: VIEW_HEIGHT }}
          >
            {/* Floor outline */}
            <div
              className="absolute border-2 border-gray-400 rounded"
              style={{
                left: 40,
                top: 40,
                width: VIEW_WIDTH - 80,
                height: VIEW_HEIGHT - 80,
              }}
            />

            {/* Wall outlines (top-down); in walls mode polygons are draggable */}
            <svg
              className="absolute inset-0 w-full h-full"
              style={{ pointerEvents: mode === 'walls' ? 'auto' : 'none' }}
              viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
              preserveAspectRatio="none"
            >
              {wallOutlines.map(({ points, key }) => (
                <polygon
                  key={key}
                  points={points.join(',')}
                  fill="rgba(183, 196, 255, 0.5)"
                  stroke={mode === 'walls' ? '#6366f1' : '#B3B3FF'}
                  strokeWidth={mode === 'walls' ? 2.5 : 2}
                  className={mode === 'walls' ? 'cursor-move' : ''}
                  onPointerDown={mode === 'walls' ? (e) => handleWallPointerDown(key, e) : undefined}
                />
              ))}
              {/* Green = front edge (side you can add boards to); no pointer events so dragging still works */}
              {mode === 'walls' &&
                wallOutlines.map(({ frontEdge, key }) => (
                  <line
                    key={`front-${key}`}
                    x1={frontEdge[0]}
                    y1={frontEdge[1]}
                    x2={frontEdge[2]}
                    y2={frontEdge[3]}
                    stroke="#16a34a"
                    strokeWidth={5}
                    strokeLinecap="round"
                    pointerEvents="none"
                  />
                ))}
            </svg>

            {/* Rotate hotspots at wall corners (walls mode only) */}
            {mode === 'walls' &&
              wallOutlines
                .flatMap(({ key, points }) => ([
                  { id: `${key}-c0`, wallIndex: key, px: points[0], py: points[1] },
                  { id: `${key}-c1`, wallIndex: key, px: points[2], py: points[3] },
                  { id: `${key}-c2`, wallIndex: key, px: points[4], py: points[5] },
                  { id: `${key}-c3`, wallIndex: key, px: points[6], py: points[7] },
                ]))
                .map(({ id, wallIndex, px, py }) => (
                  <div
                    key={`rotate-${id}`}
                    className="absolute"
                    style={{
                      left: px - 10,
                      top: py - 10,
                      width: 20,
                      height: 20,
                      cursor: ROTATE_CURSOR,
                    }}
                    title="Drag to rotate wall"
                    onPointerDown={(e) => handleWallRotatePointerDown(wallIndex, e)}
                  />
                ))}

            {/* Stretch handles (walls mode only) */}
            {mode === 'walls' &&
              wallOutlines
                .flatMap(({ key, startPx, startPy, endPx, endPy }) => {
                  const stretchCursor =
                    Math.abs(endPy - startPy) > Math.abs(endPx - startPx)
                      ? 'ns-resize'
                      : 'ew-resize'
                  return [
                    { id: `${key}-start`, wallIndex: key, end: 'start' as const, px: startPx, py: startPy, stretchCursor },
                    { id: `${key}-end`, wallIndex: key, end: 'end' as const, px: endPx, py: endPy, stretchCursor },
                  ]
                })
                .map(({ id, wallIndex, end, px, py, stretchCursor }) => (
                  <div
                    key={`stretch-${id}`}
                    className="absolute"
                    style={{
                      left: px - 12,
                      top: py - 12,
                      width: 24,
                      height: 24,
                      cursor: stretchCursor,
                    }}
                    title="Drag to stretch wall length"
                    onPointerDown={(e) => handleWallStretchPointerDown(wallIndex, end, e)}
                  />
                ))}

            {/* Tables (tables mode only) */}
            {mode === 'tables' && tables.map((table) => {
              const [px, py] = worldToScreen(table.x, table.z, bounds)
              const scaleX = (VIEW_WIDTH - 80) / floorWidth
              const scaleZ = (VIEW_HEIGHT - 80) / floorDepth
              const w = table.width * scaleX
              const h = table.depth * scaleZ
              const isSelected = selectedTableId === table.id
              const rotationDeg = ((table.rotation ?? 0) * 180) / Math.PI
              return (
                <div
                  key={table.id}
                  role="button"
                  tabIndex={0}
                  onPointerDown={(e) => handlePointerDownOnTable(table.id, e)}
                  className="absolute cursor-move rounded-lg border-2 flex flex-col items-center justify-center overflow-visible group"
                  style={{
                    left: px - w / 2,
                    top: py - h / 2,
                    width: w,
                    height: h,
                    minWidth: 24,
                    minHeight: 18,
                    transform: `rotate(${rotationDeg}deg)`,
                    transformOrigin: '50% 50%',
                    borderColor: isSelected ? '#6366f1' : '#94a3b8',
                    backgroundColor: isSelected ? 'rgba(99, 102, 241, 0.15)' : 'rgba(148, 163, 184, 0.2)',
                  }}
                >
                  {table.modelUrl ? (
                    <span className="text-[10px] font-medium text-indigo-700 truncate px-1">Model</span>
                  ) : (
                    <span className="text-[10px] font-medium text-slate-600 truncate px-1">Table</span>
                  )}
                  {/* Invisible corner hit areas – hover corner and click to rotate 90° */}
                  {[['0%', '0%'], ['100%', '0%'], ['100%', '100%'], ['0%', '100%']].map(([left, top], i) => (
                    <div
                      key={i}
                      className="absolute w-6 h-6 cursor-pointer"
                      style={{ left, top, transform: 'translate(-50%, -50%)', margin: 0 }}
                      title="Rotate 90°"
                      onPointerDown={(e) => handleRotateTable(table.id, e)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ))}
                </div>
              )
            })}
          </div>

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
                {uploadingTableId === selectedTableId ? 'Uploading...' : 'Add model'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setTables((prev) => prev.filter((t) => t.id !== selectedTableId))
                  setSelectedTableId(null)
                }}
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
