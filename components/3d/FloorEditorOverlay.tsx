'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { calculateFloorBounds, getWallTransformResolved, getWallTransform } from '@/lib/wallLayout'
import type { WallConfig, WallTransformOverride } from '@/lib/wallLayout'
import type { FloorTable } from '@/types'
import { X, Plus, Upload, Trash2 } from 'lucide-react'
import { WallConfigPreview } from './WallConfigPreview'
import { toast } from '@/lib/toast'
import { maxModelBytesForName } from '@/lib/uploadLimits'
import { useDirectUpload } from '@/lib/useDirectUpload'

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
  undoHistoryRef.current = undoHistory
  undoIndexRef.current = undoIndex

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

  // Keep the numeric Width/Height inputs synced to the selected wall (in feet).
  // Re-runs when selection changes or wallConfig updates (e.g. live drag-stretch
  // of width), so the fields always reflect the current wall.
  useEffect(() => {
    if (selectedWallIndex == null || selectedWallIndex >= wallConfig.walls.length) return
    const w = wallConfig.walls[selectedWallIndex]
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
    try {
      if (onWallRemoved) {
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
        const persistResult = await onPersistWallConfig(next)
        if (!persistResult.ok) {
          toast.error('Wall delete failed to save — please refresh.')
        }
      }

      setSelectedWallIndex(null)
      setPendingDelete(null)
    } finally {
      removingWallRef.current = false
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
            <div className="flex flex-wrap items-center gap-2 px-6 pb-4">
              <button
                type="button"
                onClick={handleAddWall}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-medium transition-colors shadow-sm"
              >
                <Plus className="w-4 h-4" />
                Add wall
              </button>
              {/* Remove-wall is delete-gated: hidden entirely for users who may
                  edit but not delete (e.g. a student member). Deleting a wall also
                  deletes the boards on it, so it is withheld rather than shown as a
                  disabled/no-op button. */}
              {canDeleteWalls && (
                <button
                  type="button"
                  onClick={handleRemoveWall}
                  disabled={selectedWallIndex == null || wallConfig.walls.length <= 1}
                  className="flex items-center gap-2 px-4 py-2 bg-slate-200 hover:bg-slate-300 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 rounded-xl text-sm font-medium transition-colors shadow-sm"
                  title={selectedWallIndex == null ? 'Click a wall to select it first' : `Remove wall ${selectedWallIndex + 1}`}
                >
                  <Trash2 className="w-4 h-4" />
                  Remove wall
                </button>
              )}

              {/* Numeric size for the selected wall — Width + Height in FEET.
                  Type an exact value (decimal feet, e.g. 9.5); commits on blur /
                  Enter, clamped to 4–40 ft. Drag-to-stretch-width still works. */}
              {selectedWallIndex != null && selectedWallIndex < wallConfig.walls.length && (
                <div className="flex items-center gap-2 ml-1 pl-3 border-l border-gray-200">
                  <span className="text-xs font-medium text-gray-500">Wall {selectedWallIndex + 1}</span>
                  {([
                    { key: 'width' as const, label: 'W', value: wallWidthInput, set: setWallWidthInput },
                    { key: 'height' as const, label: 'H', value: wallHeightInput, set: setWallHeightInput },
                  ]).map(({ key, label, value, set }) => (
                    <label key={key} className="flex items-center gap-1 text-xs text-gray-600">
                      <span className="font-semibold text-gray-500">{label}</span>
                      <input
                        type="number"
                        min={WALL_FT_MIN}
                        max={WALL_FT_MAX}
                        step={0.5}
                        value={value}
                        onChange={(e) => set(e.target.value)}
                        onBlur={() => applyWallDimension(selectedWallIndex, key, parseFloat(value))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            applyWallDimension(selectedWallIndex, key, parseFloat(value))
                            ;(e.target as HTMLInputElement).blur()
                          }
                        }}
                        className="w-16 px-1.5 py-1 border border-gray-300 rounded text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                        aria-label={`Wall ${selectedWallIndex + 1} ${key} in feet`}
                      />
                      <span className="text-gray-400">ft</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="p-6 overflow-auto">
          <p className="text-sm text-gray-500 mb-4">
            {mode === 'walls'
              ? 'Top-down view. Click a wall to select it. Drag walls to move, endpoint handles to resize, the circle handle on the front edge to rotate. Hold Shift while dragging to snap — 90° on rotate, to a neighbouring wall corner on move and resize. Ctrl+Z undo, Ctrl+Y redo.'
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
              {wallGeometry.map(({ index, points, frontEdge }) => {
                const isSelected = mode === 'walls' && selectedWallIndex === index
                return (
                <g key={index}>
                  <polygon
                    points={points.join(',')}
                    fill={isSelected ? '#6366f1' : '#4f46e5'}
                    stroke={isSelected ? '#facc15' : '#3730a3'}
                    strokeWidth={isSelected ? 2.5 : 0.5}
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
                    <circle cx={cx} cy={cy} r={9} fill="none" stroke="#facc15" strokeWidth={2} />
                    <circle cx={cx} cy={cy} r={3.5} fill="#facc15" />
                  </g>
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
            </svg>

            {/* 3D minimap preview — walls mode only */}
            {mode === 'walls' && <WallConfigPreview wallConfig={wallConfig} />}

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
                accept=".glb,.gltf,.3dm,.stl"
                className="hidden"
                onChange={handleTableFileChange}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingTableId === selectedTableId}
                className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed rounded-lg text-sm font-medium text-gray-700 transition-colors"
              >
                <Upload className="w-4 h-4" />
                {uploadingTableId === selectedTableId
                  ? uploadLabel(modelUploadPct, modelUploadLoaded, modelUploadTotal)
                  : 'Add model'}
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

      {pendingDelete && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => { if (!removingWallRef.current) setPendingDelete(null) }}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="wall-delete-title"
          >
            <h3 id="wall-delete-title" className="text-lg font-semibold text-gray-900 mb-2">
              Delete this wall?
            </h3>
            <p className="text-sm text-gray-600 mb-6">
              This wall has {pendingDelete.boardCount} board{pendingDelete.boardCount === 1 ? '' : 's'} on it.
              Deleting the wall will permanently delete those board{pendingDelete.boardCount === 1 ? '' : 's'}.
              This can&apos;t be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                disabled={removingWallRef.current}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              {/* Pass the count the user just read in this modal — that is
                  exactly what they consented to, and the server holds us to it. */}
              <button
                type="button"
                onClick={() => { void commitWallDelete(pendingDelete.index, pendingDelete.boardCount) }}
                disabled={removingWallRef.current}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-sm font-medium transition-colors shadow-sm"
              >
                Delete wall
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export { TABLE_HEIGHT_INCHES }
