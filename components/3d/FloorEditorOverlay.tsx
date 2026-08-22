'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { calculateFloorBounds, getWallTransformResolved, getWallTransform } from '@/lib/wallLayout'
import type { WallConfig, WallTransformOverride } from '@/lib/wallLayout'
import type { FloorTable } from '@/types'
import { X, Plus, Upload, Trash2, RotateCw, LayoutGrid, Compass, Undo2, Redo2, Sparkles, ChevronDown, Layers, Grid, Minus, MousePointer, HelpCircle, Check, Loader2 } from 'lucide-react'
import { WallConfigPreview } from './WallConfigPreview'
import { toast } from '@/lib/toast'
import { maxModelBytesForName } from '@/lib/uploadLimits'
import { useDirectUpload } from '@/lib/useDirectUpload'
import { Button, Dialog } from '@/components/ui'

const TABLE_HEIGHT_INCHES = 18 // 1.5 feet
const DEFAULT_TABLE_WIDTH = 24
const DEFAULT_TABLE_DEPTH = 18
const GRID_INCHES = 12 // 1 ft grid (visual reference only; wall transforms are free-continuous)

/** Bytes → MB with one decimal, for upload progress copy. */
const toMb = (bytes: number): string => (bytes / (1024 * 1024)).toFixed(1)

/**
 * Above this size a bare percentage still reads as stalled on a slow link —
 * the byte counter is the part that visibly moves between percent ticks — so
 * large transfers also get "18.3 / 43.0 MB".
 */
const BYTES_DETAIL_THRESHOLD = 5 * 1024 * 1024

function uploadLabel(pct: number, loaded: number, total: number): string {
  return total > BYTES_DETAIL_THRESHOLD
    ? `Uploading ${pct}% (${toMb(loaded)} / ${toMb(total)} MB)`
    : `Uploading ${pct}%`
}

interface FloorEditorOverlayProps {
  wallConfig: WallConfig
  tables: FloorTable[]
  setTables: (tables: FloorTable[] | ((prev: FloorTable[]) => FloorTable[])) => void
  onSaveAndExit: () => void
  /** 'tables' = place/move tables and models; 'walls' = move and rotate walls */
  mode?: 'tables' | 'walls'
  /**
   * Called when wall positions/rotations change (walls mode). Persists via the
   * parent's debounced autosave unless `persist: false` — that means the caller
   * writes the config itself and the pending autosave must be dropped so it can't
   * later clobber that write with a pre-change config.
   */
  onWallConfigChange?: (config: WallConfig, opts?: { persist?: boolean }) => void
  /**
   * Per-board wall index for every board in the current room, used to decide
   * whether a wall is "occupied" before allowing deletion. We deliberately
   * pass just the indices (not full Board objects) to keep the overlay
   * decoupled from the board shape and avoid retriggering renders on
   * unrelated board updates.
   */
  boardWallIndices?: ReadonlyArray<number | null | undefined>
  /**
   * Decrements `position.wallIndex` for every board with index > deletedIndex
   * (both in DB and in local state) so boards stay pinned to the correct
   * physical wall after the splice. Awaited by `handleRemoveWall`; if `ok`
   * is false the wall delete is aborted before any geometry change so the
   * room stays consistent.
   */
  onWallRemoved?: (
    deletedIndex: number,
    /** Board count shown to the user when confirming; the server re-counts live
     *  and refuses on mismatch so a stale count can't delete unseen boards. */
    expectedBoardCount: number,
  ) => Promise<{ ok: boolean; message?: string; liveBoardCount?: number }>
  /**
   * Persists the post-splice wall config to the per-room blob using the
   * same endpoint Save & Exit uses, and updates the local version counter
   * from the server response. Wall delete is committed atomically by
   * pairing this with `onWallRemoved`; staging the splice in undo history
   * (as before) would let Ctrl+Z restore the wall after the boards had
   * already been re-indexed, putting boards on the wrong walls.
   */
  onPersistWallConfig?: (next: WallConfig) => Promise<{ ok: boolean }>
  /**
   * May this user delete a wall? When false the Remove-wall control is hidden and
   * the delete path is refused (defense in depth). A student member may still
   * add/move walls — only deletion (which also deletes the wall's boards) is
   * withheld. Defaults to false (fail-closed).
   */
  canDeleteWalls?: boolean
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

/**
 * Endpoint snap radius, in scene units. 1 unit = 1 inch (lib/wallLayout.ts), so
 * this is literally 6 inches at room scale — the same space customTransforms
 * x/z live in, no conversion. For calibration: walls are 4–40 ft, the minimum
 * wall is 24 in, and the board smart-guide snap is 2 in.
 */
const ENDPOINT_SNAP_THRESHOLD_IN = 6

/** Rotation snap increment. Matches board rotation (DraggableBoard.tsx). */
const ROTATION_SNAP_RAD = Math.PI / 2

type Point2 = { x: number; z: number }

/**
 * The two ends of a wall's long axis, in world inches.
 *
 * Walls are stored as midpoint + angle + width, never as endpoints, so these
 * are derived. The width axis is (+cosθ, −sinθ) to match Three.js Ry(θ) — the
 * same convention the corner math and the stretch handler already use; getting
 * the z-sign wrong here mirrors the wall.
 */
function wallEndpoints(t: { x: number; z: number; rotationY: number; width: number }): {
  start: Point2
  end: Point2
} {
  const half = t.width / 2
  const axisX = Math.cos(t.rotationY)
  const axisZ = -Math.sin(t.rotationY)
  return {
    start: { x: t.x - half * axisX, z: t.z - half * axisZ },
    end: { x: t.x + half * axisX, z: t.z + half * axisZ },
  }
}

/**
 * Closest endpoint belonging to a DIFFERENT wall, within `threshold`, or null.
 *
 * `excludeIndex` is what keeps a wall from snapping to its own other end (which
 * would collapse it). Strict `<` means an exact-threshold candidate doesn't
 * snap, and ties keep the first found rather than flapping between equals.
 */
function nearestOtherEndpoint(
  wallConfig: WallConfig,
  excludeIndex: number,
  point: Point2,
  threshold: number
): Point2 | null {
  let best: Point2 | null = null
  let bestDistSq = threshold * threshold
  for (let i = 0; i < wallConfig.walls.length; i++) {
    if (i === excludeIndex) continue
    const t = getWallTransformResolved(wallConfig, i)
    const { start, end } = wallEndpoints(t)
    for (const candidate of [start, end]) {
      const dx = candidate.x - point.x
      const dz = candidate.z - point.z
      const distSq = dx * dx + dz * dz
      if (distSq < bestDistSq) {
        bestDistSq = distSq
        best = candidate
      }
    }
  }
  return best
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


function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI
  while (a <= -Math.PI) a += 2 * Math.PI
  return a
}

function normalizeAngle(a: number): number {
  return ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
}

export default function FloorEditorOverlay({
  wallConfig,
  tables,
  setTables,
  onSaveAndExit,
  mode = 'tables',
  onWallConfigChange,
  boardWallIndices,
  onWallRemoved,
  onPersistWallConfig,
  canDeleteWalls = false,
}: FloorEditorOverlayProps) {
  // Snapping is opt-in per gesture via Shift. Read live (not latched at
  // pointer-down) so it can be toggled mid-drag; `lastPointerRef` lets the
  // key-toggle effect replay the gesture at the current cursor position.
  const shiftHeldRef = useRef(false)
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null)
  /** Neighbour endpoint the current gesture is snapped to, for the highlight. */
  const [activeSnapTarget, setActiveSnapTarget] = useState<Point2 | null>(null)

  const [selectedTableId, setSelectedTableId] = useState<string | null>(null)
  const [uploadingTableId, setUploadingTableId] = useState<string | null>(null)
  // Browser → Supabase Storage directly. Model uploads used to POST a FormData
  // to /api/upload-model, which is a Vercel serverless function: its request
  // body is capped at ~4.5 MB, so anything larger died at the platform before
  // the route's own size check ran, no matter what the client cap said.
  const {
    upload: uploadModelFile,
    progress: modelUploadPct,
    loadedBytes: modelUploadLoaded,
    totalBytes: modelUploadTotal,
  } = useDirectUpload()
  const [draggingTableId, setDraggingTableId] = useState<string | null>(null)
  const [dragStart, setDragStart] = useState<{ x: number; z: number; startPx: number; startPy: number } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Walls mode: which wall the user has selected (target of the Remove wall
  // button). null = nothing selected. Set by pointerdown on a wall polygon.
  const [selectedWallIndex, setSelectedWallIndex] = useState<number | null>(null)

  // Walls mode: numeric Width/Height (FEET) inputs for the selected wall. Local
  // string state so typing is smooth; committed to wallConfig on blur / Enter.
  // Stored unit is feet (lib/wallLayout.ts SCALE=12), same as drag-to-stretch.
  const [wallWidthInput, setWallWidthInput] = useState('')
  const [wallHeightInput, setWallHeightInput] = useState('')

  // Walls mode: drag/rotate/stretch state
  const [draggingWallIndex, setDraggingWallIndex] = useState<number | null>(null)
  const [wallDragStart, setWallDragStart] = useState<{ x: number; z: number; startPx: number; startPy: number } | null>(null)

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

  const floorPlanRef = useRef<HTMLDivElement>(null)

  // Undo/redo for walls mode
  const [undoHistory, setUndoHistory] = useState<WallConfig[]>([])
  const [undoIndex, setUndoIndex] = useState(-1)
  const lastAppliedWallConfigRef = useRef<WallConfig | null>(null)
  const undoHistoryRef = useRef<WallConfig[]>([])
  const undoIndexRef = useRef(0)

  useEffect(() => {
    undoHistoryRef.current = undoHistory
    undoIndexRef.current = undoIndex
  }, [undoHistory, undoIndex])

  const bounds = calculateFloorBounds(wallConfig)
  const { minX, maxX, minZ, maxZ } = bounds

  // Uniform scale (px per inch) — same factor for X and Z so grid cells are square
  const { scale: uniformScale, offsetX: floorOffsetX, offsetY: floorOffsetY, usedWidth: floorUsedWidth, usedHeight: floorUsedHeight } = getUniformScale(bounds)
  // World-per-pixel conversion used in drag handlers
  const invScale = 1 / uniformScale

  // When entering walls mode with no custom transforms, freeze current layout.
  //
  // persist:false is load-bearing. This runs on MOUNT, from rendering the editor
  // rather than from any user edit, and it derives the transforms purely from the
  // config already on screen (getWallTransform is what the 3D view renders from) —
  // so it adds no information the server doesn't already hold. Persisting it wrote
  // the blob and bumped the version merely because someone OPENED the editor,
  // which 409'd the real editor's next save as a false "updated by another user".
  // The synthesized transforms are display state; they ride to the server with the
  // first genuine edit, or with Save & Exit, which send the whole config anyway.
  useEffect(() => {
    if (mode !== 'walls' || !onWallConfigChange) return
    const hasCustom = (wallConfig.customTransforms?.length ?? 0) >= wallConfig.walls.length
    if (hasCustom) return
    const customTransforms: WallTransformOverride[] = wallConfig.walls.map((_, i) => {
      const t = getWallTransform(wallConfig, i)
      return { x: t.x, z: t.z, rotationY: t.rotationY }
    })
    const next = { ...wallConfig, customTransforms }
    onWallConfigChange(next, { persist: false })
  }, [mode, onWallConfigChange, wallConfig])

  // Initialize undo history when entering walls mode
  useEffect(() => {
    if (mode !== 'walls') return
    // The history snapshot is intentionally initialized when the editor mode opens.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUndoHistory((prev) => (prev.length === 0 ? [wallConfig] : prev))
    setUndoIndex(0)
    lastAppliedWallConfigRef.current = null
    // wallConfig is the snapshot captured on entry; subsequent config updates are history entries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])
  useEffect(() => {
    if (mode !== 'walls' || undoHistory.length !== 1 || undoIndex !== 0) return
    // Replace the single initial snapshot until the first user-authored history entry exists.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUndoHistory([wallConfig])
  }, [mode, wallConfig, undoHistory.length, undoIndex])

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

  // Keep the numeric Width/Height inputs synced to the selected wall (in feet).
  // Re-runs when selection changes or wallConfig updates (e.g. live drag-stretch
  // of width), so the fields always reflect the current wall.
  useEffect(() => {
    if (selectedWallIndex == null || selectedWallIndex >= wallConfig.walls.length) return
    const w = wallConfig.walls[selectedWallIndex]
    // These controlled fields mirror the externally selected wall.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWallWidthInput(String(Math.round(w.width * 100) / 100))
    setWallHeightInput(String(Math.round(w.height * 100) / 100))
  }, [selectedWallIndex, wallConfig])

  // Write a wall dimension (feet) into wallConfig.walls[index] and commit it to
  // the undo history — same commit shape handlePointerUp uses, so it persists
  // through the existing wall-config blob save (no new save path). Height was
  // previously not editable at all; this is the only way to change it.
  const WALL_FT_MIN = 4
  const WALL_FT_MAX = 40
  const applyWallDimension = useCallback(
    (index: number, dim: 'width' | 'height', feet: number) => {
      if (!onWallConfigChange || !Number.isFinite(feet)) return
      const cur = wallConfig.walls[index]
      if (!cur) return
      // No-op when the entered value already matches the current dimension
      // (e.g. a focus→blur with no edit), so a wall previously dragged outside
      // the numeric range isn't silently snapped to the clamp bound. Tolerance
      // matches the 2-decimal display rounding.
      if (Math.abs((cur[dim] ?? 0) - feet) < 0.01) return
      const clamped = Math.min(WALL_FT_MAX, Math.max(WALL_FT_MIN, feet))
      if (Math.abs((cur[dim] ?? 0) - clamped) < 1e-6) return
      const nextWalls = wallConfig.walls.map((w, i) => (i === index ? { ...w, [dim]: clamped } : w))
      const next = { ...wallConfig, walls: nextWalls }
      onWallConfigChange(next)
      setUndoHistory((prev) => { const t = prev.slice(0, undoIndex + 1); t.push(next); return t })
      setUndoIndex((prev) => prev + 1)
    },
    [onWallConfigChange, wallConfig, undoIndex]
  )

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

  const nudgeWallDimension = useCallback(
    (index: number, dim: 'width' | 'height', deltaFt: number) => {
      const cur = wallConfig.walls[index]
      if (!cur) return
      const currentVal = cur[dim] ?? (dim === 'width' ? 8 : 10)
      const newVal = Math.round((currentVal + deltaFt) * 2) / 2
      applyWallDimension(index, dim, newVal)
    },
    [wallConfig, applyWallDimension]
  )

  // One-click utility: Align all wall angles to exact 90° orthogonal steps
  const handleAlignRightAngles = useCallback(() => {
    if (!onWallConfigChange) return
    const snapRad = Math.PI / 2
    const custom = ensureCustomTransforms(wallConfig, wallConfig.walls.length - 1)
    const updated = custom.map((ct) => {
      const nearest90 = Math.round(ct.rotationY / snapRad) * snapRad
      return { ...ct, rotationY: normalizeAngle(nearest90) }
    })
    const next = { ...wallConfig, customTransforms: updated }
    onWallConfigChange(next)
    setUndoHistory((prev) => [...prev.slice(0, undoIndex + 1), next])
    setUndoIndex((prev) => prev + 1)
    toast.success('Aligned all walls to 90° right angles')
  }, [wallConfig, onWallConfigChange, ensureCustomTransforms, undoIndex])

  // One-click room preset templates
  const handleApplyPreset = useCallback((preset: 'zigzag' | 'square' | 'linear' | 'lshape') => {
    if (!onWallConfigChange) return
    let newWalls = [...wallConfig.walls]
    if (newWalls.length < 4) {
      while (newWalls.length < 4) {
        newWalls.push({ height: 10, width: 8 })
      }
    }
    const dummyConfig: WallConfig = { walls: newWalls, layoutType: preset }
    const customTransforms: WallTransformOverride[] = newWalls.map((_, i) => {
      const t = getWallTransform(dummyConfig, i)
      return { x: t.x, z: t.z, rotationY: t.rotationY }
    })
    const next: WallConfig = { ...wallConfig, walls: newWalls, layoutType: preset, customTransforms }
    onWallConfigChange(next)
    setUndoHistory((prev) => [...prev.slice(0, undoIndex + 1), next])
    setUndoIndex((prev) => prev + 1)
    toast.success(`Applied ${preset.toUpperCase()} layout template`)
  }, [wallConfig, onWallConfigChange, undoIndex])

  // Keyboard Tab selection cycle
  useEffect(() => {
    if (mode !== 'walls') return
    const handleGlobalTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const target = e.target as HTMLElement | null
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'BUTTON') return
      e.preventDefault()
      if (wallConfig.walls.length === 0) return
      setSelectedWallIndex((prev) => {
        if (prev == null) return 0
        return e.shiftKey
          ? (prev - 1 + wallConfig.walls.length) % wallConfig.walls.length
          : (prev + 1) % wallConfig.walls.length
      })
    }
    window.addEventListener('keydown', handleGlobalTab)
    return () => window.removeEventListener('keydown', handleGlobalTab)
  }, [mode, wallConfig.walls.length])

  // Preset dropdown open state
  const [presetMenuOpen, setPresetMenuOpen] = useState(false)

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
    (tableId: string, e: React.SyntheticEvent) => {
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
      const lower = file.name.toLowerCase()
      const isSupportedExt = lower.endsWith('.glb') || lower.endsWith('.gltf') || lower.endsWith('.3dm') || lower.endsWith('.stl')
      if (!isSupportedExt) { toast.error('Please select a .glb, .gltf, .3dm, or .stl file.'); e.target.value = ''; return }
      const maxBytes = maxModelBytesForName(lower)
      if (file.size > maxBytes) {
        const capMb = Math.round(maxBytes / (1024 * 1024))
        toast.error(`Model must be under ${capMb} MB.`); e.target.value = ''; return
      }
      try {
        setUploadingTableId(tableId)
        const { fullUrl } = await uploadModelFile(file)
        setTables((prev) => prev.map((t) => (t.id === tableId ? { ...t, modelUrl: fullUrl } : t)))
        toast.success('3D model uploaded')
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Please try again.'
        toast.error(`Could not upload model. ${message}`)
      } finally {
        setUploadingTableId(null)
        e.target.value = ''
      }
    },
    [selectedTableId, setTables, uploadModelFile]
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

  // ── Unified pointer move ──────────────────────────────────────────────────
  //
  // Walls move/rotate/stretch are free-continuous BY DEFAULT: no grid snap, no
  // angle snap, no neighbor-endpoint snap. Users want fine control over the
  // room layout. Snapping is opt-in for the duration of a gesture by holding
  // Shift, mirroring board rotation (DraggableBoard.tsx) so there is one
  // modifier to learn rather than two interactions. Board placement snap (a
  // separate surface) is unaffected.
  //
  // Shift is read live rather than latched at pointer-down, and the gesture is
  // re-applied on Shift keydown/keyup (see the effect below), so toggling
  // mid-drag snaps and unsnaps without restarting. The RAW (unsnapped) value is
  // what every gesture accumulates; the snap is applied on the way out. That is
  // what makes releasing Shift return to exactly the free position instead of a
  // drifted one.
  const applyPointerAt = useCallback(
    (clientX: number, clientY: number) => {
      // ── Wall drag (move) ──
      if (draggingWallIndex !== null && wallDragStart && onWallConfigChange) {
        const deltaPx = clientX - wallDragStart.startPx
        const deltaPy = clientY - wallDragStart.startPy
        const rawX = wallDragStart.x + deltaPx * invScale
        const rawZ = wallDragStart.z - deltaPy * invScale

        // Translate the whole wall so whichever of ITS endpoints is closest to a
        // neighbour's endpoint lands exactly on it. Both ends are candidates;
        // the smaller correction wins.
        let appliedX = rawX
        let appliedZ = rawZ
        let snapped: Point2 | null = null
        if (shiftHeldRef.current) {
          const t = getWallTransformResolved(wallConfig, draggingWallIndex)
          const ends = wallEndpoints({ ...t, x: rawX, z: rawZ })
          let bestDistSq = Infinity
          for (const own of [ends.start, ends.end]) {
            const target = nearestOtherEndpoint(
              wallConfig, draggingWallIndex, own, ENDPOINT_SNAP_THRESHOLD_IN
            )
            if (!target) continue
            const dx = target.x - own.x
            const dz = target.z - own.z
            const distSq = dx * dx + dz * dz
            if (distSq < bestDistSq) {
              bestDistSq = distSq
              appliedX = rawX + dx
              appliedZ = rawZ + dz
              snapped = target
            }
          }
        }
        setActiveSnapTarget(snapped)

        const custom = ensureCustomTransforms(wallConfig, draggingWallIndex)
        custom[draggingWallIndex] = { ...custom[draggingWallIndex], x: appliedX, z: appliedZ }
        const nextConfig = { ...wallConfig, customTransforms: custom }
        lastAppliedWallConfigRef.current = nextConfig
        onWallConfigChange(nextConfig)
        // Store the RAW position, not the snapped one: this gesture is
        // incremental (the base moves with the cursor each frame), so writing
        // the snapped value back would make the snap sticky and releasing Shift
        // would leave the wall welded to the neighbour.
        setWallDragStart((s) => (s ? { ...s, x: rawX, z: rawZ, startPx: clientX, startPy: clientY } : null))
        return
      }

      // ── Wall rotate ──
      if (rotatingWallIndex !== null && rotateStart && onWallConfigChange) {
        const dx = clientX - rotateStart.centerClientX
        const dy = clientY - rotateStart.centerClientY
        const currentAngle = Math.atan2(dy, dx)
        const delta = wrapAngle(currentAngle - rotateStart.initialAngleFromCenter)
        // +delta (not −delta): under the corrected width-axis convention the
        // visible wall long-axis rotates with screen-angle = +rotationY, so an
        // increasing cursor angle (clockwise drag, screen y-down) must increase
        // rotationY for the wall to follow the cursor.
        const rawRotationY = rotateStart.initialRotationY + delta
        // rotateStart is never mutated mid-gesture, so rawRotationY is always
        // recomputed from the pointer — the accumulator is inherently raw and
        // the snap is a pure read-time transform, exactly as in DraggableBoard.
        const newRotationY = shiftHeldRef.current
          ? Math.round(rawRotationY / ROTATION_SNAP_RAD) * ROTATION_SNAP_RAD
          : rawRotationY
        setActiveSnapTarget(null)

        const custom = ensureCustomTransforms(wallConfig, rotatingWallIndex)
        custom[rotatingWallIndex] = { ...custom[rotatingWallIndex], rotationY: newRotationY }
        const nextConfig = { ...wallConfig, customTransforms: custom }
        lastAppliedWallConfigRef.current = nextConfig
        onWallConfigChange(nextConfig)
        return
      }

      // ── Wall stretch ──
      if (stretchingWallIndex !== null && stretchStart && onWallConfigChange) {
        const deltaPx = clientX - stretchStart.startPx
        const deltaPy = clientY - stretchStart.startPy
        const deltaX = deltaPx * invScale
        const deltaZ = -deltaPy * invScale
        const deltaAlong = deltaX * stretchStart.axisX + deltaZ * stretchStart.axisZ
        const signedDelta = stretchStart.end === 'end' ? deltaAlong : -deltaAlong
        const MIN_WALL_INCHES = 24
        const rawWidthInches = Math.max(MIN_WALL_INCHES, stretchStart.initialWidthInches + signedDelta)

        // Endpoint snap for the stretch gesture adjusts LENGTH only. Stretching
        // must not translate or rotate the wall, so the dragged end is snapped
        // to the target's projection onto the wall axis: any perpendicular
        // offset (at most the threshold) is left in place deliberately rather
        // than silently swinging the wall to close it.
        let nextWidthInches = rawWidthInches
        let snapped: Point2 | null = null
        if (shiftHeldRef.current) {
          const sign = stretchStart.end === 'end' ? 1 : -1
          const halfInit = stretchStart.initialWidthInches / 2
          const fixedX = stretchStart.initialCenterX - sign * halfInit * stretchStart.axisX
          const fixedZ = stretchStart.initialCenterZ - sign * halfInit * stretchStart.axisZ
          const movingX = fixedX + sign * rawWidthInches * stretchStart.axisX
          const movingZ = fixedZ + sign * rawWidthInches * stretchStart.axisZ
          const target = nearestOtherEndpoint(
            wallConfig,
            stretchingWallIndex,
            { x: movingX, z: movingZ },
            ENDPOINT_SNAP_THRESHOLD_IN
          )
          if (target) {
            const along =
              (target.x - fixedX) * stretchStart.axisX + (target.z - fixedZ) * stretchStart.axisZ
            const candidateWidth = along * sign
            if (candidateWidth >= MIN_WALL_INCHES) {
              nextWidthInches = candidateWidth
              snapped = target
            }
          }
        }
        setActiveSnapTarget(snapped)
        const widthDelta = nextWidthInches - stretchStart.initialWidthInches
        const centerShift = widthDelta / 2
        const centerSign = stretchStart.end === 'end' ? 1 : -1
        const nextCenterX = stretchStart.initialCenterX + stretchStart.axisX * centerShift * centerSign
        const nextCenterZ = stretchStart.initialCenterZ + stretchStart.axisZ * centerShift * centerSign

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

      // ── Table drag ── (unsnapped; tables are floor-anchored, not wall-bound)
      if (!draggingTableId || !dragStart) return
      const deltaPx = clientX - dragStart.startPx
      const deltaPy = clientY - dragStart.startPy
      const newX = dragStart.x + deltaPx * invScale
      const newZ = dragStart.z - deltaPy * invScale
      setTables((prev) => prev.map((t) => t.id === draggingTableId ? { ...t, x: newX, z: newZ } : t))
      setDragStart((s) => (s ? { ...s, x: newX, z: newZ, startPx: clientX, startPy: clientY } : null))
    },
    [
      draggingWallIndex, wallDragStart, rotatingWallIndex, rotateStart,
      stretchingWallIndex, stretchStart, draggingTableId, dragStart,
      invScale, setTables, wallConfig, onWallConfigChange,
      ensureCustomTransforms,
    ]
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      shiftHeldRef.current = e.shiftKey
      lastPointerRef.current = { x: e.clientX, y: e.clientY }
      applyPointerAt(e.clientX, e.clientY)
    },
    [applyPointerAt]
  )

  // Re-apply the in-flight gesture when Shift is pressed or released without
  // the pointer moving, so the snap engages/disengages live. Mirrors the
  // keydown/keyup re-apply in DraggableBoard's rotation gesture; here the
  // pointer position has to be replayed from a ref because key events don't
  // carry one. Every gesture recomputes from a raw accumulator, so replaying
  // the same coordinates is idempotent.
  useEffect(() => {
    const gestureActive =
      draggingWallIndex !== null || rotatingWallIndex !== null || stretchingWallIndex !== null
    if (!gestureActive) return
    const onShiftToggle = (ev: KeyboardEvent) => {
      if (ev.key !== 'Shift') return
      const held = ev.type === 'keydown'
      // Holding Shift auto-repeats keydown. Only act on an actual edge:
      // otherwise every repeat re-runs the gesture and pushes an identical
      // config to the parent at the OS repeat rate, which is pure churn.
      if (shiftHeldRef.current === held) return
      shiftHeldRef.current = held
      const last = lastPointerRef.current
      if (last) applyPointerAt(last.x, last.y)
    }
    window.addEventListener('keydown', onShiftToggle)
    window.addEventListener('keyup', onShiftToggle)
    return () => {
      window.removeEventListener('keydown', onShiftToggle)
      window.removeEventListener('keyup', onShiftToggle)
    }
  }, [draggingWallIndex, rotatingWallIndex, stretchingWallIndex, applyPointerAt])

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
    setDraggingTableId(null)
    setDragStart(null)
    setDraggingWallIndex(null)
    setWallDragStart(null)
    setRotatingWallIndex(null)
    setRotateStart(null)
    setStretchingWallIndex(null)
    setStretchStart(null)
    // The committed config above is `lastAppliedWallConfigRef.current`, i.e.
    // the SNAPPED geometry — the snap is not a preview overlay.
    setActiveSnapTarget(null)
    lastPointerRef.current = null
  }, [mode, onWallConfigChange, draggingWallIndex, rotatingWallIndex, stretchingWallIndex, wallConfig, undoIndex])

  // ── Wall interaction starters ─────────────────────────────────────────────

  const handleWallPointerDown = useCallback(
    (index: number, e: React.PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      // Always select on click (even when drag does nothing, e.g. read-only).
      // The Remove wall button reads `selectedWallIndex`; selecting before
      // dragging means a click-without-drag also primes the delete target.
      setSelectedWallIndex(index)
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
      // Width axis matches Three.js Ry(θ): (+cosθ, −sinθ).
      const axisX = Math.cos(transform.rotationY)
      const axisZ = -Math.sin(transform.rotationY)
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

  const handleWallKeyDown = useCallback(
    (index: number, event: React.KeyboardEvent<SVGPolygonElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        setSelectedWallIndex(index)
        return
      }
      if (!onWallConfigChange) return
      const step = event.shiftKey ? GRID_INCHES : 1
      const delta = event.key === 'ArrowLeft' ? [-step, 0]
        : event.key === 'ArrowRight' ? [step, 0]
          : event.key === 'ArrowUp' ? [0, step]
            : event.key === 'ArrowDown' ? [0, -step]
              : null
      const isRotate = event.key.toLowerCase() === 'r'
      if (!delta && !isRotate) return

      event.preventDefault()
      event.stopPropagation()
      setSelectedWallIndex(index)
      const custom = ensureCustomTransforms(wallConfig, index)
      const current = custom[index]
      custom[index] = delta
        ? { ...current, x: current.x + delta[0], z: current.z + delta[1] }
        : { ...current, rotationY: normalizeAngle(current.rotationY + ROTATION_SNAP_RAD) }
      const next = { ...wallConfig, customTransforms: custom }
      onWallConfigChange(next)
      setUndoHistory((history) => [...history.slice(0, undoIndex + 1), next])
      setUndoIndex((currentIndex) => currentIndex + 1)
    },
    [ensureCustomTransforms, onWallConfigChange, undoIndex, wallConfig]
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

  // Guard so a slow re-index PATCH can't be triggered twice by an impatient
  // double-click on Remove wall.
  const removingWallRef = useRef(false)
  const [removingWall, setRemovingWall] = useState(false)
  type DeletionStage = 'idle' | 'reindexing_boards' | 'updating_geometry' | 'finalizing'
  const [deletionStage, setDeletionStage] = useState<DeletionStage>('idle')
  const [deletionProgress, setDeletionProgress] = useState(0)

  // Open when the user clicks Remove wall on a wall that has boards. Holds
  // the index + board count so the modal can render and the confirm handler
  // knows what to delete. Null while no confirmation is pending.
  const [pendingDelete, setPendingDelete] = useState<{ index: number; boardCount: number } | null>(null)

  /**
   * Atomic wall delete. Same path for the empty-wall case (no modal) and
   * the confirm-from-modal case (boards will also be deleted server-side).
   *   (1) await re-index PATCH. Fail → toast, abort, change nothing.
   *   (2) splice walls[i] + customTransforms[i] and call onWallConfigChange
   *       with persist:false — local state only; step (3) owns the write.
   *   (3) await geometry POST through the same path Save & Exit uses. It goes
   *       through the shared wall-config writer, which serializes it against
   *       every other write and adopts the new version from the response, so a
   *       later Save & Exit can't 409 against a stale version.
   *   (4) If only (3) failed, toast "please refresh" — rare both-must-fail.
   *   (5) onBoardUpdate (StudioRoom does this inside onWallRemoved).
   *   (6) Clear selection + close modal.
   * Wall delete is intentionally NOT pushed to undoHistory — undoing it
   * would restore the wall while leaving boards already deleted/re-indexed
   * server-side, the exact desync this atomic commit prevents.
   */
  const commitWallDelete = useCallback(async (targetIndex: number, expectedBoardCount: number) => {
    if (removingWallRef.current) return
    // Defense in depth behind the hidden Remove-wall button: onWallRemoved (the
    // board re-index / delete) runs BEFORE the delete-gated persist, so bailing
    // here for a non-deleter prevents deleting boards for a wall whose geometry
    // write would then be refused, leaving the room inconsistent.
    if (!canDeleteWalls) return
    if (!onWallConfigChange) return
    if (targetIndex < 0 || targetIndex >= wallConfig.walls.length) return
    if (wallConfig.walls.length <= 1) return

    // walls[] and customTransforms[] are index-aligned; dropping the same
    // slot keeps every other wall on its existing transform.
    const newWalls = wallConfig.walls.filter((_, i) => i !== targetIndex)
    const newCustom = wallConfig.customTransforms
      ? wallConfig.customTransforms.filter((_, i) => i !== targetIndex)
      : undefined
    const next: WallConfig = newCustom
      ? { ...wallConfig, walls: newWalls, customTransforms: newCustom }
      : { ...wallConfig, walls: newWalls }

    removingWallRef.current = true
    setRemovingWall(true)
    setDeletionStage('reindexing_boards')
    setDeletionProgress(15)

    try {
      if (onWallRemoved) {
        setDeletionProgress(35)
        const reindexResult = await onWallRemoved(targetIndex, expectedBoardCount)
        if (!reindexResult.ok) {
          // A stale count came back with the live one. Restate the confirmation
          // with the real number so the retry consents to what is actually on
          // the wall — re-sending the stale count would just 409 forever.
          if (typeof reindexResult.liveBoardCount === 'number') {
            setPendingDelete(
              reindexResult.liveBoardCount > 0
                ? { index: targetIndex, boardCount: reindexResult.liveBoardCount }
                : null
            )
          }
          // Prefer the specific reason (stale count, permission, partial
          // failure) over the generic one; the generic line promises nothing
          // was changed, which is only true when the server got nowhere.
          toast.error(reindexResult.message ?? "Couldn't update boards for the wall delete. No changes made.")
          return
        }
      }

      setDeletionStage('updating_geometry')
      setDeletionProgress(65)

      // ONE write for one delete. `persist: false` updates local state only and
      // cancels the pending debounced autosave; onPersistWallConfig then owns the
      // write. Previously both fired: the autosave and this persist read the same
      // base version and, whenever the persist took longer than the 500ms
      // debounce, the loser 409'd — a false "another user" toast for a delete the
      // user performed alone. We keep the persist (not the autosave) because it is
      // awaited and returns ok/fail, which this path needs to sequence against the
      // board re-index already committed server-side and to toast on failure.
      onWallConfigChange(next, { persist: false })
      if (onPersistWallConfig) {
        setDeletionStage('finalizing')
        setDeletionProgress(85)
        const persistResult = await onPersistWallConfig(next)
        if (!persistResult.ok) {
          toast.error('Wall delete failed to save — please refresh.')
        }
      }

      setSelectedWallIndex(null)
      setPendingDelete(null)
    } finally {
      removingWallRef.current = false
      setRemovingWall(false)
    }
  }, [wallConfig, onWallConfigChange, onWallRemoved, onPersistWallConfig, canDeleteWalls])

  const handleRemoveWall = useCallback(() => {
    if (removingWallRef.current) return
    if (!onWallConfigChange) return
    if (wallConfig.walls.length <= 1) return
    if (selectedWallIndex == null) return
    if (selectedWallIndex < 0 || selectedWallIndex >= wallConfig.walls.length) return

    const targetIndex = selectedWallIndex
    const boardsHere = (boardWallIndices ?? []).filter((idx) => idx === targetIndex).length
    if (boardsHere > 0) {
      // Open the confirm modal — destructive op, surface the board count so
      // the user knows what they're agreeing to. We don't toast-block here
      // anymore (Phase 3.1: boards get deleted alongside the wall).
      setPendingDelete({ index: targetIndex, boardCount: boardsHere })
      return
    }

    // Believed-empty wall — commit directly, no modal. `boardsHere` (0) rides
    // along as the consent count: if the server finds boards here after all,
    // this client was stale and the delete is refused rather than silently
    // destroying boards no modal ever mentioned.
    void commitWallDelete(targetIndex, boardsHere)
  }, [wallConfig, onWallConfigChange, selectedWallIndex, boardWallIndices, commitWallDelete])

  // ── Compute wall geometry for rendering ───────────────────────────────────

  const wallGeometry = wallConfig.walls.map((_, index) => {
    const transform = getWallTransformResolved(wallConfig, index)
    const halfW = transform.width / 2
    const halfD = 3 // half-thickness = 3 inches
    const cos = Math.cos(transform.rotationY)
    const sin = Math.sin(transform.rotationY)

    // 4 corners of the wall rectangle in world space.
    // Both axes follow Three.js Ry(θ): width (local +X) → (+cosθ, −sinθ),
    // depth (local +Z) → (+sinθ, +cosθ). The width z-term is −sinθ so the 2D
    // plan matches the 3D mesh exactly (previously +sinθ, which mirrored and
    // skewed rotated walls).
    const worldCorners = [
      [transform.x - halfW * cos - halfD * sin, transform.z + halfW * sin - halfD * cos], // 0: start-back
      [transform.x + halfW * cos - halfD * sin, transform.z - halfW * sin - halfD * cos], // 1: end-back
      [transform.x + halfW * cos + halfD * sin, transform.z - halfW * sin + halfD * cos], // 2: end-front
      [transform.x - halfW * cos + halfD * sin, transform.z + halfW * sin + halfD * cos], // 3: start-front
    ]
    const screenCorners = worldCorners.map(([x, z]) => worldToScreen(x, z, bounds))
    const points = screenCorners.flat()

    // Front edge = corners 2→3 (slate-400, 2px)
    const frontEdge: [number, number, number, number] = [
      screenCorners[2][0], screenCorners[2][1],
      screenCorners[3][0], screenCorners[3][1],
    ]

    // Endpoints (midpoints of short ends): start = midpoint(0,3), end = midpoint(1,2)
    // Width axis matches Three.js: (+cosθ, −sinθ).
    const startX = transform.x - halfW * cos
    const startZ = transform.z + halfW * sin
    const endX = transform.x + halfW * cos
    const endZ = transform.z - halfW * sin
    const [startPx, startPy] = worldToScreen(startX, startZ, bounds)
    const [endPx, endPy] = worldToScreen(endX, endZ, bounds)

    // Rotate handle: midpoint of front edge offset 24px outward in screen space
    // Front edge midpoint in world = center offset by +halfD in local Z: Three.js Ry(θ) → (+sinθ, +cosθ)
    const frontMidWorldX = transform.x + halfD * sin
    const frontMidWorldZ = transform.z + halfD * cos
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
    <Dialog
      open
      onOpenChange={(open) => { if (!open) onSaveAndExit() }}
      title={mode === 'walls' ? 'Floor plan — reconfigure walls' : 'Floor plan — place tables'}
      description={mode === 'walls'
        ? 'Use the plan to select and position walls. Numeric size fields and undo shortcuts provide a keyboard-accessible editing path.'
        : 'Use the plan to select tables. The selected-table controls provide keyboard-accessible model, rotation, and removal actions.'}
      hideCloseButton
      className="max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-1rem)] w-[min(48rem,calc(100vw-1rem))] max-w-none overflow-hidden p-4 motion-reduce:transition-none"
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      <div
        className="flex max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-6rem)] flex-col overflow-hidden rounded-pinspace border border-border bg-background-light"
      >
        {/* Header Action Toolbar */}
        <div className="shrink-0 border-b border-border bg-background-lighter/50">
          <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3.5">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <LayoutGrid className="w-5 h-5 text-accent" />
                <h3 className="font-mono text-base font-bold text-text-primary tracking-tight">
                  {mode === 'walls' ? 'Floor plan — reconfigure walls' : 'Floor plan — place tables'}
                </h3>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <Button type="button" onClick={() => onSaveAndExit()} className="bg-primary text-pinspace-ink hover:bg-primary-light font-bold">
                Save and exit
              </Button>
              <button
                type="button"
                onClick={() => onSaveAndExit()}
                className="flex h-10 w-10 items-center justify-center rounded-pinspace text-text-secondary hover:bg-background-lighter hover:text-text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                aria-label="Save and close floor editor"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {mode === 'walls' && (
            <div className="flex flex-wrap items-center justify-between gap-3 px-6 pb-3.5 pt-1 border-t border-border/50">
              {/* Primary Tools */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleAddWall}
                  className="flex min-h-10 items-center gap-2 rounded-pinspace border border-pinspace-ink bg-primary px-3.5 py-1.5 text-xs font-bold text-pinspace-ink shadow-sm hover:bg-primary-light transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add wall
                </button>

                {canDeleteWalls && (
                  <button
                    type="button"
                    onClick={handleRemoveWall}
                    disabled={selectedWallIndex == null || wallConfig.walls.length <= 1}
                    className="flex min-h-10 items-center gap-2 rounded-pinspace border border-border bg-background-light px-3.5 py-1.5 text-xs font-bold text-text-primary hover:bg-background hover:border-danger/40 hover:text-danger disabled:cursor-not-allowed disabled:opacity-40 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    title={selectedWallIndex == null ? 'Click a wall on the grid to select it first' : `Remove wall ${selectedWallIndex + 1}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Remove wall
                  </button>
                )}

                {/* Wall Property Inspector (Width, Height, Angle) */}
                <div className="ml-1 flex flex-wrap items-center gap-2 border-l border-border/70 pl-3">
                  {selectedWallIndex != null && selectedWallIndex < wallConfig.walls.length ? (
                    <>
                      <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-accent/10 border border-accent/30 text-xs font-bold text-accent">
                        <span>Wall {selectedWallIndex + 1}</span>
                      </div>
                      
                      {/* Width Control */}
                      <div className="flex items-center gap-1 bg-background-light border border-border rounded-pinspace px-2 py-1 text-xs">
                        <span className="font-bold text-text-secondary">W</span>
                        <button
                          type="button"
                          onClick={() => nudgeWallDimension(selectedWallIndex, 'width', -0.5)}
                          className="w-5 h-5 flex items-center justify-center rounded hover:bg-background text-text-secondary hover:text-text-primary"
                          title="Decrease width by 0.5 ft"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <input
                          type="number"
                          min={WALL_FT_MIN}
                          max={WALL_FT_MAX}
                          step={0.5}
                          value={wallWidthInput}
                          onChange={(e) => setWallWidthInput(e.target.value)}
                          onBlur={() => applyWallDimension(selectedWallIndex, 'width', parseFloat(wallWidthInput))}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              applyWallDimension(selectedWallIndex, 'width', parseFloat(wallWidthInput))
                              ;(e.target as HTMLInputElement).blur()
                            }
                          }}
                          className="w-12 text-center bg-transparent text-sm font-semibold text-text-primary focus:outline-none"
                          aria-label={`Wall ${selectedWallIndex + 1} width in feet`}
                        />
                        <button
                          type="button"
                          onClick={() => nudgeWallDimension(selectedWallIndex, 'width', 0.5)}
                          className="w-5 h-5 flex items-center justify-center rounded hover:bg-background text-text-secondary hover:text-text-primary"
                          title="Increase width by 0.5 ft"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                        <span className="text-text-muted text-[11px]">ft</span>
                      </div>

                      {/* Height Control */}
                      <div className="flex items-center gap-1 bg-background-light border border-border rounded-pinspace px-2 py-1 text-xs">
                        <span className="font-bold text-text-secondary">H</span>
                        <button
                          type="button"
                          onClick={() => nudgeWallDimension(selectedWallIndex, 'height', -0.5)}
                          className="w-5 h-5 flex items-center justify-center rounded hover:bg-background text-text-secondary hover:text-text-primary"
                          title="Decrease height by 0.5 ft"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <input
                          type="number"
                          min={WALL_FT_MIN}
                          max={WALL_FT_MAX}
                          step={0.5}
                          value={wallHeightInput}
                          onChange={(e) => setWallHeightInput(e.target.value)}
                          onBlur={() => applyWallDimension(selectedWallIndex, 'height', parseFloat(wallHeightInput))}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              applyWallDimension(selectedWallIndex, 'height', parseFloat(wallHeightInput))
                              ;(e.target as HTMLInputElement).blur()
                            }
                          }}
                          className="w-12 text-center bg-transparent text-sm font-semibold text-text-primary focus:outline-none"
                          aria-label={`Wall ${selectedWallIndex + 1} height in feet`}
                        />
                        <button
                          type="button"
                          onClick={() => nudgeWallDimension(selectedWallIndex, 'height', 0.5)}
                          className="w-5 h-5 flex items-center justify-center rounded hover:bg-background text-text-secondary hover:text-text-primary"
                          title="Increase height by 0.5 ft"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                        <span className="text-text-muted text-[11px]">ft</span>
                      </div>

                      {/* Rotate 90° quick action */}
                      <button
                        type="button"
                        onClick={() => {
                          const custom = ensureCustomTransforms(wallConfig, selectedWallIndex)
                          const cur = custom[selectedWallIndex]
                          custom[selectedWallIndex] = { ...cur, rotationY: normalizeAngle(cur.rotationY + Math.PI / 2) }
                          const next = { ...wallConfig, customTransforms: custom }
                          onWallConfigChange?.(next)
                          setUndoHistory((prev) => [...prev.slice(0, undoIndex + 1), next])
                          setUndoIndex((prev) => prev + 1)
                        }}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-pinspace border border-border bg-background-light text-xs font-semibold text-text-primary hover:bg-background transition-colors"
                        title="Rotate wall 90°"
                      >
                        <RotateCw className="w-3.5 h-3.5 text-accent" />
                        <span>Rotate 90°</span>
                      </button>
                    </>
                  ) : (
                    /* Placeholder state when no wall is selected */
                    <div className="flex items-center gap-2 text-xs text-text-muted italic">
                      <span>No wall selected</span>
                      <span className="text-text-muted/40">|</span>
                      <span className="font-medium text-text-muted">W: -- ft</span>
                      <span className="font-medium text-text-muted">H: -- ft</span>
                      <span className="text-text-muted/60 text-[11px] non-italic ml-1">(Click any wall to edit)</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Utility Quick Actions (Align 90°, Presets, Undo/Redo) */}
              <div className="flex items-center gap-2 border-l border-border/70 pl-3">
                <button
                  type="button"
                  onClick={handleAlignRightAngles}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-pinspace border border-border bg-background-light text-xs font-bold text-text-primary hover:bg-background hover:border-accent transition-colors"
                  title="Straighten all tilted walls to exact 90° perpendicular angles"
                >
                  <Compass className="w-3.5 h-3.5 text-accent" />
                  <span>Align 90°</span>
                </button>

                {/* Presets Dropdown */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setPresetMenuOpen((v) => !v)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-pinspace border border-border bg-background-light text-xs font-bold text-text-primary hover:bg-background transition-colors"
                  >
                    <Layers className="w-3.5 h-3.5 text-accent" />
                    <span>Presets</span>
                    <ChevronDown className="w-3 h-3 text-text-muted" />
                  </button>

                  {presetMenuOpen && (
                    <div className="absolute right-0 top-full mt-1.5 z-50 w-44 rounded-pinspace border border-border bg-background-light p-1.5 shadow-xl backdrop-blur-md">
                      <div className="px-2 py-1 text-[10px] font-bold tracking-wider text-text-muted uppercase">Layout Templates</div>
                      {([
                        { id: 'zigzag' as const, label: 'Zigzag Partition' },
                        { id: 'square' as const, label: 'Square Gallery' },
                        { id: 'lshape' as const, label: 'L-Studio Corner' },
                        { id: 'linear' as const, label: 'Linear Wall Alley' },
                      ]).map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            handleApplyPreset(item.id)
                            setPresetMenuOpen(false)
                          }}
                          className="w-full text-left px-2.5 py-1.5 text-xs font-medium text-text-primary hover:bg-primary/10 hover:text-accent rounded-md transition-colors"
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Undo / Redo */}
                <div className="flex items-center border border-border rounded-pinspace bg-background-light overflow-hidden">
                  <button
                    type="button"
                    onClick={() => {
                      if (undoIndex > 0) {
                        const ni = undoIndex - 1
                        setUndoIndex(ni)
                        onWallConfigChange?.(undoHistory[ni])
                      }
                    }}
                    disabled={undoIndex <= 0}
                    className="p-1.5 hover:bg-background text-text-secondary hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    title="Undo (Ctrl+Z)"
                  >
                    <Undo2 className="w-3.5 h-3.5" />
                  </button>
                  <div className="w-[1px] h-4 bg-border" />
                  <button
                    type="button"
                    onClick={() => {
                      if (undoIndex < undoHistory.length - 1) {
                        const ni = undoIndex + 1
                        setUndoIndex(ni)
                        onWallConfigChange?.(undoHistory[ni])
                      }
                    }}
                    disabled={undoIndex >= undoHistory.length - 1}
                    className="p-1.5 hover:bg-background text-text-secondary hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    title="Redo (Ctrl+Y)"
                  >
                    <Redo2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="p-5 overflow-auto">
          {/* Refined Instruction Badge Bar */}
          <div role="status" className="mb-3.5 flex flex-wrap items-center gap-2 px-3 py-2 rounded-lg border border-border/60 bg-background-lighter/60 text-xs text-text-secondary">
            <span className="flex items-center gap-1.5 font-semibold text-text-primary">
              <MousePointer className="w-3.5 h-3.5 text-accent" />
              Click wall to select
            </span>
            <span className="text-text-muted/40">•</span>
            <span>↔️ Drag ends to resize</span>
            <span className="text-text-muted/40">•</span>
            <span>🔄 Drag circle to rotate</span>
            <span className="text-text-muted/40">•</span>
            <span className="px-1.5 py-0.5 rounded bg-background border border-border font-mono text-[11px] text-text-primary">Shift</span>
            <span>Snap 90° / Corners</span>
            <span className="text-text-muted/40">•</span>
            <span className="px-1.5 py-0.5 rounded bg-background border border-border font-mono text-[11px] text-text-primary">Tab</span>
            <span>Cycle walls</span>
          </div>

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
                fill="rgb(var(--color-paper))"
                stroke="rgb(var(--color-border))"
                strokeWidth={1}
              />

              {/* 12-inch grid */}
              {mode === 'walls' && gridLines.map((l, i) => (
                <line
                  key={i}
                  x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
                  stroke="rgb(var(--color-border-light))"
                  strokeWidth={0.5}
                />
              ))}

              {/* Wall polygons */}
              {wallGeometry.map(({ index, points, frontEdge }) => {
                const isSelected = mode === 'walls' && selectedWallIndex === index
                const isBeingDeleted = removingWall && selectedWallIndex === index
                return (
                <g key={index}>
                  {mode === 'walls' && (
                    <polygon
                      points={points.join(',')}
                      fill="transparent"
                      stroke="transparent"
                      strokeWidth={44}
                      style={{ pointerEvents: 'all', cursor: 'move' }}
                      onPointerDown={(event) => handleWallPointerDown(index, event)}
                      aria-hidden="true"
                    />
                  )}
                  <polygon
                    points={points.join(',')}
                    fill={
                      isBeingDeleted
                        ? 'rgb(var(--color-danger) / 0.35)'
                        : isSelected
                        ? 'rgb(var(--color-primary))'
                        : 'rgb(var(--color-secondary))'
                    }
                    stroke={
                      isBeingDeleted
                        ? 'rgb(var(--color-danger))'
                        : isSelected
                        ? 'rgb(var(--color-ink))'
                        : 'rgb(var(--color-forest))'
                    }
                    strokeWidth={isBeingDeleted ? 3.5 : isSelected ? 2.5 : 0.5}
                    className={
                      isBeingDeleted
                        ? 'animate-pulse'
                        : mode === 'walls'
                        ? 'cursor-move focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent'
                        : ''
                    }
                    style={{ pointerEvents: 'none' }}
                    role={mode === 'walls' ? 'button' : undefined}
                    tabIndex={mode === 'walls' ? 0 : undefined}
                    aria-label={mode === 'walls' ? `Wall ${index + 1}${isSelected ? ', selected' : ''}. Use arrow keys to move, Shift plus arrows for twelve-inch steps, and R to rotate.` : undefined}
                    onKeyDown={mode === 'walls' ? (event) => handleWallKeyDown(index, event) : undefined}
                  />
                  {/* Front-edge indicator: slate-400, 2.5px */}
                  {mode === 'walls' && (
                    <line
                      x1={frontEdge[0]} y1={frontEdge[1]}
                      x2={frontEdge[2]} y2={frontEdge[3]}
                      stroke={isBeingDeleted ? 'rgb(var(--color-danger))' : isSelected ? 'rgb(var(--color-primary))' : 'rgb(var(--color-accent))'}
                      strokeWidth={isBeingDeleted ? 3.5 : 2.5}
                      strokeLinecap="round"
                      style={{ pointerEvents: 'none' }}
                    />
                  )}
                </g>
                )
              })}

              {/* On-canvas Wall Dimension Badges (width in ft) */}
              {mode === 'walls' && wallGeometry.map(({ index, centerPx, centerPy }) => {
                const wall = wallConfig.walls[index]
                if (!wall) return null
                const isSelected = selectedWallIndex === index
                const isBeingDeleted = removingWall && selectedWallIndex === index
                return (
                  <g key={`wbadge-${index}`} style={{ pointerEvents: 'none' }}>
                    <rect
                      x={centerPx - 26}
                      y={centerPy - 9}
                      width={52}
                      height={18}
                      rx={4}
                      fill={isBeingDeleted ? 'rgb(var(--color-danger))' : isSelected ? 'rgb(var(--color-primary))' : 'rgb(var(--color-surface-muted))'}
                      stroke={isBeingDeleted ? 'rgb(var(--color-paper))' : isSelected ? 'rgb(var(--color-ink))' : 'rgb(var(--color-border))'}
                      strokeWidth={1}
                      opacity={0.92}
                    />
                    <text
                      x={centerPx}
                      y={centerPy + 3}
                      textAnchor="middle"
                      className="text-[10px] font-bold font-mono"
                      fill={isBeingDeleted ? 'white' : isSelected ? 'rgb(var(--color-pinspace-ink))' : 'rgb(var(--color-text-primary))'}
                    >
                      {isBeingDeleted ? 'DELETING' : `${wall.width.toFixed(1)} ft`}
                    </text>
                  </g>
                )
              })}

              {/* Snap indicator — the neighbour endpoint the dragged wall is
                  currently welded to. Without this the user can only infer the
                  snap fired from the result, which is indistinguishable from
                  having landed it by hand. Drawn after the walls so it is never
                  occluded, and non-interactive so it can't steal the drag. */}
              {mode === 'walls' && activeSnapTarget && (() => {
                const [cx, cy] = worldToScreen(activeSnapTarget.x, activeSnapTarget.z, bounds)
                return (
                  <g style={{ pointerEvents: 'none' }}>
                    <circle cx={cx} cy={cy} r={10} fill="none" stroke="rgb(var(--color-primary))" strokeWidth={2.5} className="animate-pulse" />
                    <circle cx={cx} cy={cy} r={4} fill="rgb(var(--color-primary))" />
                  </g>
                )
              })()}

              {/* Rotate handle lines (wall center → handle) */}
              {mode === 'walls' && wallGeometry.map(({ index, centerPx, centerPy, handlePx, handlePy }) => (
                <line
                  key={`rline-${index}`}
                  x1={centerPx} y1={centerPy}
                  x2={handlePx} y2={handlePy}
                  stroke="rgb(var(--color-secondary))"
                  strokeWidth={1}
                  strokeDasharray="2,2"
                  style={{ pointerEvents: 'none' }}
                />
              ))}

              {/* Rotate handles: transparent 44px target around the visible control. */}
              {mode === 'walls' && wallGeometry.map(({ index, handlePx, handlePy }) => (
                <g key={`rhandle-${index}`}>
                  <circle cx={handlePx} cy={handlePy} r={22} fill="transparent" style={{ pointerEvents: 'all', cursor: 'crosshair' }} onPointerDown={(event) => handleWallRotatePointerDown(index, event)} />
                  <circle cx={handlePx} cy={handlePy} r={6} fill="rgb(var(--color-paper))" stroke="rgb(var(--color-secondary))" strokeWidth={2} style={{ pointerEvents: 'none' }} />
                  <circle cx={handlePx} cy={handlePy} r={2.5} fill="rgb(var(--color-secondary))" style={{ pointerEvents: 'none' }} />
                </g>
              ))}

              {/* Stretch endpoint circles (visible) */}
              {mode === 'walls' && wallGeometry.map(({ index, startPx, startPy, endPx, endPy }) => (
                <g key={`stretch-vis-${index}`} style={{ pointerEvents: 'none' }}>
                  <circle cx={startPx} cy={startPy} r={4.5} fill="rgb(var(--color-paper))" stroke="rgb(var(--color-secondary))" strokeWidth={2} />
                  <circle cx={endPx} cy={endPy} r={4.5} fill="rgb(var(--color-paper))" stroke="rgb(var(--color-secondary))" strokeWidth={2} />
                </g>
              ))}
            </svg>

            {/* Floating Glass Loader Overlay during wall deletion */}
            {removingWall && (
              <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/45 backdrop-blur-sm transition-all duration-300 pointer-events-auto">
                <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/20 bg-background-dark/95 p-5 shadow-2xl backdrop-blur-md max-w-xs text-center animate-in fade-in zoom-in-95 duration-200">
                  <div className="relative flex items-center justify-center">
                    <div className="w-12 h-12 rounded-full border-2 border-emerald-400/20 border-t-emerald-400 animate-spin" />
                    <span className="absolute text-[11px] font-bold text-white font-mono">{deletionProgress}%</span>
                  </div>
                  <div>
                    <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-white">
                      <Trash2 className="w-3.5 h-3.5 text-rose-400 animate-bounce" />
                      <span>Deleting Wall {selectedWallIndex != null ? selectedWallIndex + 1 : ''}</span>
                    </div>
                    <p className="mt-1.5 text-[11px] text-white/70 font-medium min-h-[32px] flex items-center justify-center leading-snug">
                      {deletionStage === 'reindexing_boards' && 'Re-indexing boards & updating server positions...'}
                      {deletionStage === 'updating_geometry' && 'Updating room geometry & custom transforms...'}
                      {deletionStage === 'finalizing' && 'Finalizing 3D room synchronization...'}
                      {deletionStage === 'idle' && 'Processing wall deletion...'}
                    </p>
                  </div>
                  {/* Progress bar */}
                  <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-emerald-400 to-teal-300 h-full transition-all duration-300 rounded-full"
                      style={{ width: `${deletionProgress}%` }}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* 3D minimap preview — walls mode only */}
            {mode === 'walls' && <WallConfigPreview wallConfig={wallConfig} />}

            {/* Stretch invisible hitbox divs (44×44 touch target). */}
            {mode === 'walls' && wallGeometry.flatMap(({ index, startPx, startPy, endPx, endPy, centerPx, centerPy }) => {
              const dx = endPx - startPx
              const dy = endPy - startPy
              const stretchCursor = Math.abs(dy) > Math.abs(dx) ? 'ns-resize' : 'ew-resize'
              void centerPx; void centerPy
              return [
                <button
                  type="button"
                  key={`sh-start-${index}`}
                  className="absolute rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  style={{ left: startPx - 22, top: startPy - 22, width: 44, height: 44, cursor: stretchCursor }}
                  aria-label={"Select start resize handle for wall " + (index + 1)}
                  onPointerDown={(e) => handleWallStretchPointerDown(index, 'start', e)}
                  onClick={() => setSelectedWallIndex(index)}
                />,
                <button
                  type="button"
                  key={`sh-end-${index}`}
                  className="absolute rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  style={{ left: endPx - 22, top: endPy - 22, width: 44, height: 44, cursor: stretchCursor }}
                  aria-label={"Select end resize handle for wall " + (index + 1)}
                  onPointerDown={(e) => handleWallStretchPointerDown(index, 'end', e)}
                  onClick={() => setSelectedWallIndex(index)}
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
                  aria-label={`${table.modelUrl ? 'Model table' : 'Empty table'} ${isSelected ? 'selected' : ''}. Use arrow keys to move and R to rotate.`}
                  onPointerDown={(e) => handlePointerDownOnTable(table.id, e)}
                  onKeyDown={(e) => {
                    const step = e.shiftKey ? GRID_INCHES : 1
                    const delta = e.key === 'ArrowLeft' ? [-step, 0]
                      : e.key === 'ArrowRight' ? [step, 0]
                        : e.key === 'ArrowUp' ? [0, step]
                          : e.key === 'ArrowDown' ? [0, -step]
                            : null
                    if (delta) {
                      e.preventDefault()
                      setSelectedTableId(table.id)
                      setTables((current) => current.map((item) => item.id === table.id ? { ...item, x: item.x + delta[0], z: item.z + delta[1] } : item))
                    } else if (e.key.toLowerCase() === 'r') {
                      e.preventDefault()
                      e.stopPropagation()
                      setTables((current) => current.map((item) => item.id === table.id ? { ...item, rotation: (item.rotation ?? 0) + Math.PI / 2 } : item))
                    } else if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setSelectedTableId(table.id)
                    }
                  }}
                  className="absolute flex cursor-move flex-col items-center justify-center overflow-visible rounded-lg border-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  style={{
                    left: px - w / 2, top: py - h / 2,
                    width: w, height: h, minWidth: 24, minHeight: 18,
                    transform: `rotate(${rotationDeg}deg)`,
                    transformOrigin: '50% 50%',
                    borderColor: isSelected ? 'rgb(var(--color-secondary))' : 'rgb(var(--color-text-muted))',
                    backgroundColor: isSelected ? 'rgb(var(--color-secondary) / 0.15)' : 'rgb(var(--color-surface-muted) / 0.7)',
                  }}
                >
                  <span className="truncate px-1 text-[10px] font-medium text-text-primary">
                    {table.modelUrl ? 'Model' : 'Table'}
                  </span>
                  {[['0%', '0%'], ['100%', '0%'], ['100%', '100%'], ['0%', '100%']].map(([left, top], i) => (
                    <div
                      key={i}
                      className="absolute h-11 w-11 cursor-pointer rounded-full"
                      style={{ left, top, transform: 'translate(-50%,-50%)' }}
                      aria-hidden="true"
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
            <div className="mt-2.5 flex items-center justify-between text-xs text-text-secondary">
              <div className="flex items-center gap-2">
                <div className="w-3 h-0.5 bg-accent rounded" />
                <span>The thin accent line marks the front surface where presentation boards attach.</span>
              </div>
              <div className="font-mono text-[11px] text-text-muted">
                {wallConfig.walls.length} Wall{wallConfig.walls.length === 1 ? '' : 's'} total
              </div>
            </div>
          )}

          {/* Table inspector */}
          {mode === 'tables' && selectedTableId && (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-pinspace border border-border bg-background-lighter p-4">
              <span className="text-sm font-medium text-text-primary">Selected table</span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".glb,.gltf,.3dm,.stl"
                className="hidden"
                onChange={handleTableFileChange}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingTableId === selectedTableId}
                className="flex min-h-11 items-center gap-2 rounded-pinspace border border-border bg-background-light px-3 py-2 text-sm font-medium text-text-primary hover:bg-background disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <Upload className="w-4 h-4" />
                {uploadingTableId === selectedTableId
                  ? uploadLabel(modelUploadPct, modelUploadLoaded, modelUploadTotal)
                  : 'Add model'}
              </button>
              <button
                type="button"
                onClick={(event) => handleRotateTable(selectedTableId, event)}
                className="min-h-11 rounded-pinspace border border-border bg-background-light px-3 py-2 text-sm font-medium text-text-primary hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Rotate 90°
              </button>
              <button
                type="button"
                onClick={() => { setTables((prev) => prev.filter((t) => t.id !== selectedTableId)); setSelectedTableId(null) }}
                className="min-h-11 rounded-pinspace px-3 py-2 text-sm font-semibold text-[rgb(var(--color-danger))] hover:bg-[rgb(var(--color-danger)/0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Remove table
              </button>
            </div>
          )}
        </div>
      </div>

      {pendingDelete && (
        <Dialog
          open
          onOpenChange={(open) => { if (!open && !removingWall) setPendingDelete(null) }}
          title="Delete this wall?"
          description="This permanently deletes the boards currently attached to the wall."
          closeOnOutsideClick={!removingWall}
          hideCloseButton={removingWall}
          className="max-w-md motion-reduce:transition-none [&>button.absolute]:h-11 [&>button.absolute]:w-11"
        >
            <p className="mb-4 text-sm text-text-secondary">
              This wall has <span className="font-bold text-text-primary">{pendingDelete.boardCount} board{pendingDelete.boardCount === 1 ? '' : 's'}</span> on it.
              Deleting the wall will permanently delete those board{pendingDelete.boardCount === 1 ? '' : 's'}.
              This can&apos;t be undone.
            </p>

            {removingWall && (
              <div className="mb-5 rounded-lg border border-border bg-background-lighter p-3.5 text-xs text-text-secondary space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-text-primary">
                  <span>Deletion Progress</span>
                  <span className="font-mono text-accent">{deletionProgress}%</span>
                </div>
                <div className="w-full bg-border rounded-full h-1.5 overflow-hidden">
                  <div 
                    className="bg-accent h-full transition-all duration-300 rounded-full"
                    style={{ width: `${deletionProgress}%` }}
                  />
                </div>
                <div className="space-y-1 pt-1 text-[11px]">
                  <div className="flex items-center gap-2">
                    {deletionProgress >= 40 ? (
                      <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    ) : (
                      <Loader2 className="w-3.5 h-3.5 text-accent animate-spin shrink-0" />
                    )}
                    <span className={deletionProgress >= 40 ? 'line-through text-text-muted' : 'font-semibold text-text-primary'}>
                      1. Re-indexing boards & server assignments
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {deletionProgress >= 80 ? (
                      <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    ) : deletionProgress >= 40 ? (
                      <Loader2 className="w-3.5 h-3.5 text-accent animate-spin shrink-0" />
                    ) : (
                      <div className="w-3.5 h-3.5 rounded-full border border-border shrink-0" />
                    )}
                    <span className={deletionProgress >= 80 ? 'line-through text-text-muted' : deletionProgress >= 40 ? 'font-semibold text-text-primary' : 'text-text-muted'}>
                      2. Updating room geometry & wall layout
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {deletionProgress >= 100 ? (
                      <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    ) : deletionProgress >= 80 ? (
                      <Loader2 className="w-3.5 h-3.5 text-accent animate-spin shrink-0" />
                    ) : (
                      <div className="w-3.5 h-3.5 rounded-full border border-border shrink-0" />
                    )}
                    <span className={deletionProgress >= 80 ? 'font-semibold text-text-primary' : 'text-text-muted'}>
                      3. Finalizing 3D room sync
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-3">
              <Button type="button" variant="ghost" onClick={() => setPendingDelete(null)} disabled={removingWall}>Cancel</Button>
              {/* Pass the count the user just read in this modal — that is
                  exactly what they consented to, and the server holds us to it. */}
              <Button
                type="button"
                variant="danger"
                onClick={() => { void commitWallDelete(pendingDelete.index, pendingDelete.boardCount) }}
                disabled={removingWall}
                loading={removingWall}
              >
                {removingWall ? 'Deleting wall…' : 'Delete wall'}
              </Button>
            </div>
        </Dialog>
      )}
    </Dialog>
  )
}

export { TABLE_HEIGHT_INCHES }
