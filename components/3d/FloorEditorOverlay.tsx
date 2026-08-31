'use client'

import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { calculateFloorBounds, getWallTransformResolved, getWallTransform } from '@/lib/wallLayout'
import { makePlanProjection } from '@/lib/room/planProjection'
import { ROOM, MONO_STACK, ROOM_GRID_LINE, ROOM_GRID_INCHES } from '@/lib/room/palette'
import type { WallConfig, WallTransformOverride } from '@/lib/wallLayout'
import type { FloorTable } from '@/types'
import { X, Plus, Upload, Trash2, Loader2 } from 'lucide-react'
import { toast } from '@/lib/toast'
import { maxModelBytesForName } from '@/lib/uploadLimits'
import type { Board } from '@/types'
import { useDirectUpload } from '@/lib/useDirectUpload'
import { countWallCrossings } from '@/lib/room/planGeometry'

const TABLE_HEIGHT_INCHES = 18 // 1.5 feet
const DEFAULT_TABLE_WIDTH = 24
const DEFAULT_TABLE_DEPTH = 18
// 1 ft ruling, shared with the 3D room so the plan reads at the same scale as
// the space. Visual reference only — wall transforms stay free-continuous.
const GRID_INCHES = ROOM_GRID_INCHES

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
   * Boards, for the sidebar's per-wall thumbnails. Optional and read-only —
   * the editor never mutates them. boardWallIndices above already carries the
   * COUNT (and is what the delete guard checks); this exists only so the panel
   * can show what is actually on the selected wall.
   */
  boards?: ReadonlyArray<Board>
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
  /**
   * Canvas the plan is drawn into. Defaults to this editor's own modal size.
   * The Plan tab passes its own square viewBox and margin so the editor draws
   * at exactly the scale and position of the plan already on screen — toggling
   * into Edit then adds handles to that drawing rather than swapping it for a
   * differently-scaled one. Both go through the same projection helper, so
   * "same numbers" is structural rather than something to keep in sync by hand.
   */
  viewWidth?: number
  viewHeight?: number
  padding?: number
  /**
   * Render inline instead of as a modal.
   *
   * Plan view IS this editor now — there is no "open the wall editor" button
   * and nothing to dismiss — so the dimmed backdrop, the floating card and the
   * close affordance all come off, and the drawing fills the tab. Pair it with
   * viewWidth/viewHeight/padding matching PlanView so the geometry lands where
   * the read-only plan drew it.
   *
   * `onSaveAndExit` still fires from the Save button; embedded callers should
   * pass a handler that persists WITHOUT closing anything.
   */
  embedded?: boolean
  /**
   * Switch the grabbable layer, embedded only. Supplying it renders the
   * Walls/Models toggle inside the editor's own control panel — the panel has
   * to live bottom-left (every other corner is fixed chrome), and a separate
   * floating toggle stacked against it just made two panels to dodge.
   */
  onModeChange?: (next: 'tables' | 'walls') => void
  /**
   * Open a board in the lightbox, from the selected wall's thumbnail strip.
   *
   * The host owns the lightbox — it carries the compare set, the follow-mode
   * gate and the comment panel — so this hands the board up rather than
   * rendering a second viewer down here that would know none of that. Omit it
   * and the strip stays a read-only inventory.
   */
  onBoardOpen?: (board: Board) => void
}

const VIEW_WIDTH = 700
const VIEW_HEIGHT = 500

const PADDING = 40



/**
 * Endpoint snap radius, in scene units. 1 unit = 1 inch (lib/wallLayout.ts), so
 * this is literally 6 inches at room scale — the same space customTransforms
 * x/z live in, no conversion. For calibration: walls are 4–40 ft, the minimum
 * wall is 24 in, and the board smart-guide snap is 2 in.
 */
const ENDPOINT_SNAP_THRESHOLD_IN = 6

/** Rotation snap increment. Matches board rotation (DraggableBoard.tsx). */
const ROTATION_SNAP_RAD = Math.PI / 2

/**
 * Inches → architectural feet-inches, e.g. 102 → `8'-6"`. Rounded to the nearest
 * inch: the drag is continuous but sub-inch precision is noise at room scale and
 * makes the readout jitter while you move.
 */
function formatFeetInches(totalInches: number): string {
  const rounded = Math.round(totalInches)
  const feet = Math.floor(rounded / 12)
  const inches = rounded % 12
  return `${feet}'-${inches}"`
}

type Point2 = { x: number; z: number }

/**
 * Half a wall's plan thickness, in inches — walls draw and build 6" thick.
 */
const WALL_HALF_THICKNESS_IN = 3

/**
 * Walls are solid: they may meet, they may not pass through each other.
 *
 * Returns true when a candidate layout should be DISCARDED — the wall being
 * dragged, rotated or stretched crosses more walls than it did before the
 * frame. Compared as a count against the current config rather than tested
 * absolutely, because a layout saved before this rule existed can already
 * contain a crossing, and an absolute veto would weld those walls in place:
 * every candidate position crosses, so they could never be dragged apart.
 * "No worse than it was" always leaves a way out.
 *
 * Rejecting means the gesture's accumulator is left untouched too, so the wall
 * stops dead against the obstruction and picks the cursor back up the moment it
 * moves away — the standard way collision reads. Advancing the accumulator
 * anyway would let the wall skip the barrier and reappear on the far side,
 * which is the thing being fixed.
 */
function blocksWallMove(
  current: Parameters<typeof countWallCrossings>[0],
  candidate: Parameters<typeof countWallCrossings>[0],
  index: number,
): boolean {
  return countWallCrossings(candidate, index) > countWallCrossings(current, index)
}

/**
 * The four plan corners of a wall, in world inches, in the order
 * start-back, end-back, end-front, start-front.
 *
 * Walls are stored as midpoint + angle + width, never as corners, so these are
 * derived. Both axes follow Three.js Ry(θ): the long axis (local +X) is
 * (+cosθ, −sinθ) and the thickness axis (local +Z) is (+sinθ, +cosθ). Same
 * convention as the render geometry below, so a handle drawn from these lands
 * exactly on the drawn polygon's corner; get the z-sign wrong and the wall
 * mirrors.
 *
 * Corners, NOT centre-line ends, are what the snap works in. Two walls whose
 * centre-line ends coincide overlap by half a thickness each and read as a
 * crossed joint with a stub poking out the far side — which is what an L-corner
 * used to look like here. Two walls sharing a CORNER meet flush.
 */
function wallCorners(t: { x: number; z: number; rotationY: number; width: number }): Point2[] {
  const halfW = t.width / 2
  const halfD = WALL_HALF_THICKNESS_IN
  const cos = Math.cos(t.rotationY)
  const sin = Math.sin(t.rotationY)
  return [
    { x: t.x - halfW * cos - halfD * sin, z: t.z + halfW * sin - halfD * cos },
    { x: t.x + halfW * cos - halfD * sin, z: t.z - halfW * sin - halfD * cos },
    { x: t.x + halfW * cos + halfD * sin, z: t.z - halfW * sin + halfD * cos },
    { x: t.x - halfW * cos + halfD * sin, z: t.z + halfW * sin + halfD * cos },
  ]
}

/**
 * Which end of the wall each corner from `wallCorners` belongs to — so a corner
 * handle knows which end the stretch gesture should move.
 */
const CORNER_END: ReadonlyArray<'start' | 'end'> = ['start', 'end', 'end', 'start']

/**
 * Closest corner belonging to a DIFFERENT wall, within `threshold`, or null.
 *
 * `excludeIndex` is what keeps a wall from snapping to its own other corners
 * (which would collapse it). Strict `<` means an exact-threshold candidate
 * doesn't snap, and ties keep the first found rather than flapping between
 * equals.
 */
function nearestOtherCorner(
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
    for (const candidate of wallCorners(t)) {
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
  boards,
  onWallRemoved,
  onPersistWallConfig,
  canDeleteWalls = false,
  onBoardOpen,
  viewWidth = VIEW_WIDTH,
  viewHeight = VIEW_HEIGHT,
  padding = PADDING,
  embedded = false,
  onModeChange,
}: FloorEditorOverlayProps) {
  // Snapping is opt-in per gesture via Shift. Read live (not latched at
  // pointer-down) so it can be toggled mid-drag; `lastPointerRef` lets the
  // key-toggle effect replay the gesture at the current cursor position.
  const shiftHeldRef = useRef(false)

  /**
   * Snapping is a persistent mode now, on by default, rather than something you
   * had to hold Shift for on every gesture. Shift INVERTS it rather than
   * enabling it, so the old muscle memory still does something useful: with snap
   * on, holding Shift is how you place a wall freely.
   *
   * The ref shadows the state because every consumer is inside a pointer
   * handler that must read the current value without being re-created — the
   * same reason shiftHeldRef exists.
   */
  const [snapEnabled, setSnapEnabled] = useState(true)
  const snapEnabledRef = useRef(true)
  useEffect(() => { snapEnabledRef.current = snapEnabled }, [snapEnabled])

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
  /**
   * Which table the open file dialog belongs to.
   *
   * A ref, not selectedTableId: the picker is opened from the table's own
   * centre, which selects it in the same gesture — and state has not
   * re-rendered by the time the dialog is launched. Reading the state there
   * would attach the model to whichever table was selected BEFORE this one.
   */
  const uploadTargetRef = useRef<string | null>(null)

  // Walls mode: which wall the user has selected (target of the Remove wall
  // button). null = nothing selected. Set by pointerdown on a wall polygon.
  const [selectedWallIndex, setSelectedWallIndex] = useState<number | null>(null)

  /**
   * What the inspector describes. Both are plain derivations rather than state,
   * so they cannot drift from the selection that produced them.
   *
   * `boards` is optional, so the thumbnail strip simply doesn't render for a
   * caller that doesn't pass it — the panel loses a section rather than
   * throwing. The delete guard keeps reading boardWallIndices, which is a
   * separate prop and the one the server is held to.
   */
  const selectedWallBoards = useMemo(
    () => (selectedWallIndex == null
      ? []
      : (boards ?? []).filter((b) => b.position?.wallIndex === selectedWallIndex)),
    [boards, selectedWallIndex]
  )
  const selectedTable = useMemo(
    () => tables.find((t) => t.id === selectedTableId) ?? null,
    [tables, selectedTableId]
  )

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
  /**
   * Live pixel size of the canvas box, embedded only.
   *
   * The whole plan has to fit the tab with no scrolling, which means the canvas
   * can't be a fixed square any more. It also can't just be stretched with CSS:
   * every pointer handler maps client coords straight through this box's rect
   * (`rect.left + centerPx`), which is only correct while ONE SVG UNIT IS ONE
   * CSS PIXEL. So instead of scaling the drawing, we measure the box and hand
   * its real size to both the viewBox and the projection — the viewBox then
   * always equals the element's pixel size, the mapping stays identity, and
   * preserveAspectRatio="none" has nothing left to distort.
   *
   * makePlanProjection already fits the room into whatever rectangle it's
   * given (scale = min(sx, sz), then centres), so a non-square canvas needs no
   * special-casing — the room just gets more margin on the long axis.
   */
  const [measuredPlan, setMeasuredPlan] = useState<{ w: number; h: number } | null>(null)
  useEffect(() => {
    if (!embedded) return
    const el = floorPlanRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const apply = () => {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) {
        setMeasuredPlan((prev) =>
          // Round before comparing: sub-pixel layout jitter would otherwise
          // re-render the whole editor on every scroll/zoom tick.
          prev && Math.round(prev.w) === Math.round(r.width) && Math.round(prev.h) === Math.round(r.height)
            ? prev
            : { w: r.width, h: r.height }
        )
      }
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [embedded])

  // Undo/redo for walls mode
  const [undoHistory, setUndoHistory] = useState<WallConfig[]>([])
  const [undoIndex, setUndoIndex] = useState(-1)
  const lastAppliedWallConfigRef = useRef<WallConfig | null>(null)
  const undoHistoryRef = useRef<WallConfig[]>([])
  const undoIndexRef = useRef(0)
  undoHistoryRef.current = undoHistory
  undoIndexRef.current = undoIndex

  // Framed on the WALLS alone. The slab used to be drawn and draggable here, so
  // the view had to frame the union of the two; with it gone, including it would
  // silently zoom the plan out to fit something invisible.
  const wallBounds = calculateFloorBounds(wallConfig)
  const hasWalls = wallConfig.walls.length > 0 && Number.isFinite(wallBounds.minX)
  // A room with no walls still needs a finite box or the projection divides by
  // zero and the grid never draws — 20ft square, which is a plausible studio and
  // gives Add wall somewhere to land.
  const EMPTY_ROOM_HALF_IN = 120
  const bounds = hasWalls ? wallBounds : {
    minX: -EMPTY_ROOM_HALF_IN, maxX: EMPTY_ROOM_HALF_IN,
    minZ: -EMPTY_ROOM_HALF_IN, maxZ: EMPTY_ROOM_HALF_IN,
  }
  const { minX, maxX, minZ, maxZ } = bounds

  // Uniform scale (px per inch) — same factor for X and Z so grid cells are square
  // One projection per render, from the canvas size this instance was given —
  // the modal uses its own 700x500, the Plan tab passes its own so the editor
  // draws at exactly the scale and position of the plan already on screen.
  // Embedded fills its box; the modal keeps its fixed canvas. Falls back to the
  // prop until the first measurement lands, so the first paint is never 0-sized.
  const planW = embedded ? measuredPlan?.w ?? viewWidth : viewWidth
  const planH = embedded ? measuredPlan?.h ?? viewHeight : viewHeight

  const proj = makePlanProjection(bounds, planW, planH, padding)
  // Only the scale is needed now. The offset/used-size fields used to position
  // the floor rect, back when the floor WAS this projection's bounds box; the
  // slab is drawn from its own world rect through toPx instead.
  const { scale: uniformScale } = proj
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
      // Same solidity rule the drag gestures enforce — a length typed into the
      // panel must not do what dragging the stretch handle is refused. Only
      // width can: height is vertical and changes no footprint. The field
      // reverts to the current value on the next render, which is the feedback
      // that the length doesn't fit.
      if (dim === 'width' && blocksWallMove(wallConfig, next, index)) return
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
    // SyntheticEvent, not PointerEvent: this only calls preventDefault and
    // stopPropagation, and the sidebar button reaches it via onClick (a
    // MouseEvent). Widening the parameter beats casting at each call site.
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
      const tableId = uploadTargetRef.current ?? selectedTableId
      uploadTargetRef.current = null
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
        // + not −: the shared projection maps world +Z to screen-DOWN, so a
        // downward drag is a positive Z delta. See lib/room/planProjection.ts.
        const rawX = wallDragStart.x + deltaPx * invScale
        const rawZ = wallDragStart.z + deltaPy * invScale

        // Translate the whole wall so whichever of ITS CORNERS is closest to a
        // neighbour's corner lands exactly on it. All four corners are
        // candidates; the smaller correction wins. Corner-to-corner is what
        // makes an L-joint flush — see wallCorners.
        let appliedX = rawX
        let appliedZ = rawZ
        let snapped: Point2 | null = null
        if (snapEnabledRef.current !== shiftHeldRef.current) {
          const t = getWallTransformResolved(wallConfig, draggingWallIndex)
          let bestDistSq = Infinity
          for (const own of wallCorners({ ...t, x: rawX, z: rawZ })) {
            const target = nearestOtherCorner(
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
        if (blocksWallMove(wallConfig, nextConfig, draggingWallIndex)) return
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
        // −delta, and this sign is tied to the projection's handedness: the wall's
        // long axis is world (cos r, −sin r), so under the shared +Z-down
        // projection its SCREEN angle is −rotationY. An increasing cursor angle
        // therefore has to DECREASE rotationY for the wall to track the pointer.
        //
        // This was +delta while the editor mapped +Z up — i.e. while it drew the
        // room as if seen from beneath the floor. Flipping to a true birds-eye
        // view reverses handedness, and reversing handedness reverses angular
        // direction; miss this and the wall spins away from the cursor.
        const rawRotationY = rotateStart.initialRotationY - delta
        // rotateStart is never mutated mid-gesture, so rawRotationY is always
        // recomputed from the pointer — the accumulator is inherently raw and
        // the snap is a pure read-time transform, exactly as in DraggableBoard.
        const newRotationY = (snapEnabledRef.current !== shiftHeldRef.current)
          ? Math.round(rawRotationY / ROTATION_SNAP_RAD) * ROTATION_SNAP_RAD
          : rawRotationY
        setActiveSnapTarget(null)

        const custom = ensureCustomTransforms(wallConfig, rotatingWallIndex)
        custom[rotatingWallIndex] = { ...custom[rotatingWallIndex], rotationY: newRotationY }
        const nextConfig = { ...wallConfig, customTransforms: custom }
        if (blocksWallMove(wallConfig, nextConfig, rotatingWallIndex)) return
        lastAppliedWallConfigRef.current = nextConfig
        onWallConfigChange(nextConfig)
        return
      }

      // ── Wall stretch ──
      if (stretchingWallIndex !== null && stretchStart && onWallConfigChange) {
        const deltaPx = clientX - stretchStart.startPx
        const deltaPy = clientY - stretchStart.startPy
        // See the wall-drag note above on the sign.
        const deltaX = deltaPx * invScale
        const deltaZ = deltaPy * invScale
        const deltaAlong = deltaX * stretchStart.axisX + deltaZ * stretchStart.axisZ
        const signedDelta = stretchStart.end === 'end' ? deltaAlong : -deltaAlong
        const MIN_WALL_INCHES = 24
        const rawWidthInches = Math.max(MIN_WALL_INCHES, stretchStart.initialWidthInches + signedDelta)

        // Corner snap for the stretch gesture adjusts LENGTH only. Stretching
        // must not translate or rotate the wall, so the dragged end is snapped
        // to the target's projection onto the wall axis: any perpendicular
        // offset (at most the threshold) is left in place deliberately rather
        // than silently swinging the wall to close it.
        let nextWidthInches = rawWidthInches
        let snapped: Point2 | null = null
        if (snapEnabledRef.current !== shiftHeldRef.current) {
          const sign = stretchStart.end === 'end' ? 1 : -1
          const halfInit = stretchStart.initialWidthInches / 2
          const fixedX = stretchStart.initialCenterX - sign * halfInit * stretchStart.axisX
          const fixedZ = stretchStart.initialCenterZ - sign * halfInit * stretchStart.axisZ
          const movingX = fixedX + sign * rawWidthInches * stretchStart.axisX
          const movingZ = fixedZ + sign * rawWidthInches * stretchStart.axisZ
          // Both CORNERS of the moving end are candidates, not the centre-line
          // point between them. The thickness axis is (+sinθ, +cosθ); axis =
          // (cosθ, −sinθ) is all stretchStart carries, so recover it as
          // (−axisZ, +axisX) rather than re-deriving θ.
          const perpX = -stretchStart.axisZ
          const perpZ = stretchStart.axisX
          let bestDistSq = Infinity
          for (const s of [-1, 1]) {
            const cornerX = movingX + s * WALL_HALF_THICKNESS_IN * perpX
            const cornerZ = movingZ + s * WALL_HALF_THICKNESS_IN * perpZ
            const target = nearestOtherCorner(
              wallConfig,
              stretchingWallIndex,
              { x: cornerX, z: cornerZ },
              ENDPOINT_SNAP_THRESHOLD_IN
            )
            if (!target) continue
            const dx = target.x - cornerX
            const dz = target.z - cornerZ
            const distSq = dx * dx + dz * dz
            if (distSq >= bestDistSq) continue
            // The two corners of one end share an along-axis coordinate, so the
            // width falls out of the target's projection from the fixed
            // centre-line end whichever corner matched.
            const along =
              (target.x - fixedX) * stretchStart.axisX + (target.z - fixedZ) * stretchStart.axisZ
            const candidateWidth = along * sign
            if (candidateWidth < MIN_WALL_INCHES) continue
            bestDistSq = distSq
            nextWidthInches = candidateWidth
            snapped = target
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
        if (blocksWallMove(wallConfig, nextConfig, stretchingWallIndex)) return
        lastAppliedWallConfigRef.current = nextConfig
        onWallConfigChange(nextConfig)
        return
      }

      // ── Table drag ── (unsnapped; tables are floor-anchored, not wall-bound)
      if (!draggingTableId || !dragStart) return
      const deltaPx = clientX - dragStart.startPx
      const deltaPy = clientY - dragStart.startPy
      // See the wall-drag note above on the sign. Tables share the projection.
      const newX = dragStart.x + deltaPx * invScale
      const newZ = dragStart.z + deltaPy * invScale
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
      draggingWallIndex !== null || rotatingWallIndex !== null ||
      stretchingWallIndex !== null
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
      const [centerPx, centerPy] = proj.toPx(transform.x, transform.z)
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
    // `proj` is listed because this closes over it. Today it's redundant —
    // `bounds` is a fresh object each render so the callback rebuilds anyway —
    // but that's incidental, and the moment `bounds` is memoized, or the canvas
    // size props change without the config changing, an omitted `proj` would
    // capture a stale projection and start the rotate gesture from the wrong
    // screen centre.
    [wallConfig, bounds, proj, onWallConfigChange]
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
    const halfD = WALL_HALF_THICKNESS_IN
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
    const screenCorners = worldCorners.map(([x, z]) => proj.toPx(x, z))
    const points = screenCorners.flat()

    // Front edge = corners 2→3 (ROOM.ink2, 2px)
    const frontEdge: [number, number, number, number] = [
      screenCorners[2][0], screenCorners[2][1],
      screenCorners[3][0], screenCorners[3][1],
    ]

    // Centre-line ends (midpoints of the short ends). No longer where the
    // stretch handles are drawn — those sit on the corners now — but still the
    // wall's long axis in screen space, which is what picks the resize cursor.
    // Width axis matches Three.js: (+cosθ, −sinθ).
    const startX = transform.x - halfW * cos
    const startZ = transform.z + halfW * sin
    const endX = transform.x + halfW * cos
    const endZ = transform.z - halfW * sin
    const [startPx, startPy] = proj.toPx(startX, startZ)
    const [endPx, endPy] = proj.toPx(endX, endZ)

    // Rotate handle: midpoint of front edge offset 24px outward in screen space
    // Front edge midpoint in world = center offset by +halfD in local Z: Three.js Ry(θ) → (+sinθ, +cosθ)
    const frontMidWorldX = transform.x + halfD * sin
    const frontMidWorldZ = transform.z + halfD * cos
    const [frontMidPx, frontMidPy] = proj.toPx(frontMidWorldX, frontMidWorldZ)

    // Offset 24px outward from wall center direction
    const [centerPx, centerPy] = proj.toPx(transform.x, transform.z)
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
      /** Live width, for the dimension readout while stretching. */
      widthInches: transform.width,
      /** Unit vector pointing out of the wall's front, for placing that readout. */
      outUx: outDx / outLen,
      outUy: outDy / outLen,
    }
  })

  /**
   * Geometry of the one wall that carries handles.
   *
   * Rotate and corner handles used to be drawn on EVERY wall at once, so a
   * four-wall room showed twelve grab points and four spokes over the linework
   * before you had touched anything — the drawing read as a diagram of handles
   * rather than a plan. They belong to the selection now: click a wall, get its
   * handles. Indexed rather than found, and guarded, because the selection
   * survives a wall delete that shortens the array.
   */
  const selectedGeom =
    mode === 'walls' && selectedWallIndex != null
      ? wallGeometry[selectedWallIndex] ?? null
      : null

  // ── Grid pattern coords ───────────────────────────────────────────────────
  // World-aligned 12-inch grid, across the WHOLE canvas rather than clipped to
  // the floor. It used to stop at the floor rect, which quietly made the grid a
  // drawing OF the floor — so the floor looked like the extent of the world and
  // there was nowhere to put a wall that wasn't on it. As drafting paper the
  // grid is the ground everything sits on, and the floor is just one object
  // drawn on it.
  //
  // Extents come from the canvas corners through toWorld, not from `bounds`, so
  // the ruling reaches the edges at any zoom instead of stopping where the
  // geometry happens to end.
  // The grid is the ground now — the floor slab that used to sit on it is gone,
  // so this ruling IS the surface the walls stand on and it runs edge to edge.
  // One weight, matching the 3D room exactly: see ROOM_GRID_LINE.
  //
  // Built in BOTH modes. This was wrapped in `if (mode === 'walls')`, which is
  // the second half of the same mistake as the render gate below it: the JSX
  // stopped asking for the grid in Models mode AND the array it would have
  // drawn was empty, so removing only one of the two changed nothing. A table
  // is placed against the same 12-inch ruling a wall is, and with the wall
  // handles gone the grid is the only thing left to judge a position by.
  const gridLines: Array<{ x1: number; y1: number; x2: number; y2: number }> = []
  {
    const [worldLeft, worldTop] = proj.toWorld(0, 0)
    const [worldRight, worldBottom] = proj.toWorld(planW, planH)
    const startGridX = Math.ceil(worldLeft / GRID_INCHES) * GRID_INCHES
    const endGridX = Math.floor(worldRight / GRID_INCHES) * GRID_INCHES
    const startGridZ = Math.ceil(worldTop / GRID_INCHES) * GRID_INCHES
    const endGridZ = Math.floor(worldBottom / GRID_INCHES) * GRID_INCHES

    // Guard against a degenerate projection producing an unbounded loop.
    const maxLines = 400
    if ((endGridX - startGridX) / GRID_INCHES < maxLines) {
      for (let gx = startGridX; gx <= endGridX; gx += GRID_INCHES) {
        const [px] = proj.toPx(gx, 0)
        gridLines.push({ x1: px, y1: 0, x2: px, y2: planH })
      }
    }
    if ((endGridZ - startGridZ) / GRID_INCHES < maxLines) {
      for (let gz = startGridZ; gz <= endGridZ; gz += GRID_INCHES) {
        const [, py] = proj.toPx(0, gz)
        gridLines.push({ x1: 0, y1: py, x2: planW, y2: py })
      }
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className={
        embedded
          ? 'absolute inset-0 overflow-hidden'
          : 'fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm'
      }
      style={embedded ? { background: ROOM.background } : undefined}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      <div
        className={
          embedded
            ? 'relative flex h-full w-full'
            : 'bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden flex flex-col'
        }
        style={embedded ? undefined : { width: VIEW_WIDTH + 48, maxHeight: '90vh' }}
      >
        {/* The MODAL toolbar. Embedded now uses the right-hand sidebar further
            down instead, so every embedded-conditional inside this block always
            takes its else branch — left in place rather than unpicked so the
            modal keeps byte-for-byte the markup it already shipped with. */}
        {!embedded && (
        <div
          className={
            embedded
              ? 'absolute bottom-4 left-4 z-10 w-[252px] rounded-xl bg-white border border-gray-200 shadow-[0_4px_16px_rgba(22,24,29,0.10)] overflow-hidden'
              : 'shrink-0 border-b border-gray-200'
          }
        >
          {embedded && (
            <div className="px-3 pt-2.5 pb-1.5 text-[9.5px] font-semibold uppercase tracking-[0.18em] text-gray-400 border-b border-gray-100">
              Edit room
            </div>
          )}
          {embedded && onModeChange && (
            <div className="flex gap-1 p-1.5 border-b border-gray-100">
              {([
                { key: 'walls' as const, label: 'Walls' },
                { key: 'tables' as const, label: 'Models' },
              ]).map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => onModeChange(key)}
                  aria-pressed={mode === key}
                  className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors ${
                    mode === key
                      ? 'bg-[#3B6EF6] text-white'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <div
            className={
              embedded
                ? 'flex flex-col gap-1.5 p-1.5'
                : 'flex items-center justify-between px-6 py-4'
            }
          >
            {/* Inline, the tab itself says where you are and the Walls/Models
                toggle says which layer you're on, so a second title would just
                repeat the chrome around it. */}
            {embedded ? <span /> : (
              <h2 className="text-lg font-semibold text-gray-900">
                {mode === 'walls' ? 'Floor plan – reconfigure walls' : 'Floor plan – place tables'}
              </h2>
            )}
            <div className={embedded ? 'flex flex-col gap-1.5' : 'flex items-center gap-2'}>
              {mode === 'tables' && (
                <button
                  type="button"
                  onClick={handleAddTable}
                  className={`flex items-center justify-center gap-2 bg-[#3B6EF6] hover:bg-[#16181D] text-white transition-colors shadow-sm ${
                    embedded ? 'rounded-lg px-3 py-1.5 text-xs font-semibold' : 'px-4 py-2 rounded-xl text-sm font-medium'
                  }`}
                >
                  <Plus className="w-4 h-4" />
                  Add table
                </button>
              )}
              {/* Walls autosave through onWallConfigChange; tables do not, so
                  inline this stays an explicit Save rather than becoming a new
                  debounced writer on the versioned wall-config blob. */}
              <button
                type="button"
                onClick={() => onSaveAndExit()}
                className={`bg-[#3B6EF6] hover:bg-[#16181D] text-white transition-colors shadow-sm ${
                  embedded ? 'rounded-lg px-3 py-1.5 text-xs font-semibold' : 'px-4 py-2 rounded-xl text-sm font-medium'
                }`}
              >
                {embedded ? 'Save' : 'Save & exit'}
              </button>
              {!embedded && (
                <button
                  type="button"
                  onClick={() => onSaveAndExit()}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                  aria-label="Close"
                >
                  <X className="w-5 h-5 text-gray-600" />
                </button>
              )}
            </div>
          </div>

          {mode === 'walls' && (
            <div className={embedded ? 'flex flex-wrap items-center gap-1.5 p-1.5 pt-0' : 'flex flex-wrap items-center gap-2 px-6 pb-4'}>
              <button
                type="button"
                onClick={handleAddWall}
                className={`flex items-center gap-2 bg-[#3B6EF6] hover:bg-[#16181D] text-white transition-colors shadow-sm ${
                  embedded ? 'rounded-lg px-2.5 py-1.5 text-xs font-semibold' : 'px-4 py-2 rounded-xl text-sm font-medium'
                }`}
              >
                <Plus className={embedded ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
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
                  className={`flex items-center gap-2 bg-slate-200 hover:bg-slate-300 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 transition-colors shadow-sm ${
                    embedded ? 'rounded-lg px-2.5 py-1.5 text-xs font-semibold' : 'px-4 py-2 rounded-xl text-sm font-medium'
                  }`}
                  title={selectedWallIndex == null ? 'Click a wall to select it first' : `Remove wall ${selectedWallIndex + 1}`}
                >
                  <Trash2 className={embedded ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
                  {embedded ? 'Remove' : 'Remove wall'}
                </button>
              )}

              {/* Numeric size for the selected wall — Width + Height in FEET.
                  Type an exact value (decimal feet, e.g. 9.5); commits on blur /
                  Enter, clamped to 4–40 ft. Drag-to-stretch-width still works. */}
              {selectedWallIndex != null && selectedWallIndex < wallConfig.walls.length && (
                <div className={embedded ? 'flex items-center gap-1.5 w-full pt-1' : 'flex items-center gap-2 ml-1 pl-3 border-l border-gray-200'}>
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
                        className="w-16 px-1.5 py-1 border border-gray-300 rounded text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#3B6EF6]"
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
        )}

        <div className={embedded ? 'relative flex min-w-0 flex-1 flex-col' : 'p-6 overflow-auto'}>
          {/* Embedded hides the prose: the plan has to fit the tab, and this
              paragraph is the one thing here that costs it height for nothing.
              The toolbar above already carries the controls. */}
          <p className={embedded ? 'hidden' : 'text-sm text-gray-500 mb-4'}>
            {mode === 'walls'
              ? 'Top-down view. Click a wall to select it. Drag walls to move, endpoint handles to resize, the circle handle on the front edge to rotate. Snapping is on by default — 90° on rotate, to a neighbouring wall corner on move and resize; hold Shift while dragging to turn it off. Ctrl+Z undo, Ctrl+Y redo.'
              : 'Top-down view. Drag a table to move it, click its middle to add a 3D model, its corners to rotate.'}
          </p>

          {/* Floor plan canvas. Embedded it fills the tab and is MEASURED
              rather than CSS-scaled, so one SVG unit stays one CSS pixel and
              every pointer handler's rect math keeps working — see
              measuredPlan. The modal keeps its fixed square. */}
          <div
            ref={floorPlanRef}
            className={
              embedded
                ? 'absolute inset-0 overflow-hidden'
                : 'relative rounded-lg overflow-hidden'
            }
            style={embedded ? undefined : { width: viewWidth, height: viewHeight }}
          >
            <svg
              className="absolute inset-0 w-full h-full"
              viewBox={`0 0 ${planW} ${planH}`}
              preserveAspectRatio="none"
              // The SVG itself never takes pointer events; the individual walls,
              // handles and tables opt back in. (This was a ternary with the
              // same value in both branches.)
              style={{ pointerEvents: 'none' }}
            >
              {/* 12-inch grid, drawn OVER the slab and running to the canvas
                  edges — it's the drafting ruling the whole room sits on, so it
                  must not stop where the floor does.
                  In BOTH modes. It used to be walls-only, which meant switching
                  to Models dropped the ground out from under the room and left
                  the walls floating on blank paper — but a table is placed
                  against the same 12-inch ruling a wall is, and it is the only
                  thing to judge a position by once the wall handles are gone. */}
              {gridLines.map((l, i) => (
                <line
                  key={i}
                  x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
                  stroke={ROOM_GRID_LINE}
                  strokeWidth={1}
                  style={{ pointerEvents: 'none' }}
                />
              ))}

              {/* Wall polygons */}
              {wallGeometry.map(({ index, points, frontEdge }) => {
                const isSelected = mode === 'walls' && selectedWallIndex === index
                return (
                <g key={index}>
                  <polygon
                    points={points.join(',')}
                    // Drawn as a light panel with a hairline, not a solid ink
                    // bar. At 6" thick a filled-black wall is the heaviest mark
                    // on the sheet, so a plan of four walls read as four black
                    // bars floating on nothing — the walls out-weighted the room
                    // they describe. Selection is a blue outline and a blue
                    // wash, which also frees the front-edge indicator below to
                    // be legible against the wall instead of on top of black.
                    fill={isSelected ? '#EDF3FE' : '#FFFFFF'}
                    stroke={isSelected ? ROOM.accent : '#B9C4D8'}
                    strokeWidth={isSelected ? 1.5 : 1}
                    strokeLinejoin="round"
                    className={mode === 'walls' ? 'cursor-move' : ''}
                    style={{ pointerEvents: mode === 'walls' ? 'all' : 'none' }}
                    onPointerDown={mode === 'walls' ? (e) => handleWallPointerDown(index, e) : undefined}
                  />
                  {/* A 2px #8A99B5 stroke ran along one long side of every
                      wall here, marking which face boards hang on. It went with
                      the legend that explained it: an unlabelled dark line down
                      one edge of a white panel does not read as "this is the
                      front", it reads as a wall drawn wrong on one side. The
                      face is still known — frontEdge is what the label's
                      rotation and the rotate handle are derived from — it is
                      just no longer drawn. Walls are plain white panels with a
                      hairline outline. */}
                  {/* Wall name, set ON the wall and running along it.
                      Drawn in Models mode too. The walls are still on screen
                      there and are the room's only landmarks — an unlabelled
                      set of white bars is a worse map to place a table against
                      than a labelled one, and the label costs nothing when it
                      is not the thing you are dragging.
                      It used to sit 14px off the front face, which put every
                      label in the space BETWEEN walls — so a label belonged to
                      whichever wall you guessed, and in a tight corner it read
                      as belonging to the wrong one. On the wall there is no
                      guessing.
                      The rotation is what makes that possible: horizontal text
                      on a vertical wall would run straight off it. Set along
                      the wall it stays within the panel for its whole length
                      and reads like a drafting label. */}
                  {(() => {
                    const cx = (points[0] + points[2] + points[4] + points[6]) / 4
                    const cy = (points[1] + points[3] + points[5] + points[7]) / 4
                    // The front edge IS the wall's long axis in screen space,
                    // so no need to re-derive it from rotationY (which would
                    // also have to re-apply the projection's handedness).
                    let angle =
                      (Math.atan2(frontEdge[3] - frontEdge[1], frontEdge[2] - frontEdge[0]) * 180) /
                      Math.PI
                    // Fold into (−90, 90] so the label is never upside down or
                    // mirrored — a wall and the same wall turned 180° carry the
                    // same name, so the reading direction shouldn't flip.
                    if (angle > 90) angle -= 180
                    else if (angle < -90) angle += 180
                    return (
                      <text
                        // translate-then-rotate: x/y below are in the label's
                        // own frame, so the 3.5 baseline nudge stays a vertical
                        // centring of the glyphs and doesn't become a sideways
                        // shift once the wall is turned. The anchor is the
                        // polygon's own centroid — the middle of the wall.
                        transform={`translate(${cx}, ${cy}) rotate(${angle})`}
                        x={0}
                        y={3.5}
                        textAnchor="middle"
                        fill={isSelected ? ROOM.accent : '#8A8FA0'}
                        fontSize={10}
                        fontWeight={700}
                        letterSpacing={0.9}
                        style={{ pointerEvents: 'none' }}
                      >
                        {`WALL ${String(index + 1).padStart(2, '0')}`}
                      </text>
                    )
                  })()}
                </g>
                )
              })}

              {/* Snap indicator — the neighbour endpoint the dragged wall is
                  currently welded to. Without this the user can only infer the
                  snap fired from the result, which is indistinguishable from
                  having landed it by hand. Drawn after the walls so it is never
                  occluded, and non-interactive so it can't steal the drag. */}
              {mode === 'walls' && activeSnapTarget && (() => {
                const [cx, cy] = proj.toPx(activeSnapTarget.x, activeSnapTarget.z)
                return (
                  <g style={{ pointerEvents: 'none' }}>
                    <circle cx={cx} cy={cy} r={9} fill="none" stroke={ROOM.accent} strokeWidth={2} />
                    <circle cx={cx} cy={cy} r={3.5} fill={ROOM.accent} />
                  </g>
                )
              })()}

              {/* Handles — the SELECTED wall only. Rotate spoke and circle,
                  then a corner grip at each of the four corners.
                  The grips used to sit on the two centre-line ends, which put
                  the connection point half a wall-thickness inside the drawing:
                  you welded two walls by their centre-lines and got a crossed
                  joint with a stub through the corner instead of a flush L.
                  The snap works corner-to-corner now (see wallCorners), so the
                  grips are drawn where the snap actually lands. */}
              {selectedGeom && (
                <g>
                  <line
                    x1={selectedGeom.centerPx} y1={selectedGeom.centerPy}
                    x2={selectedGeom.handlePx} y2={selectedGeom.handlePy}
                    stroke={ROOM.accent}
                    strokeWidth={1}
                    style={{ pointerEvents: 'none' }}
                  />
                  <circle
                    cx={selectedGeom.handlePx} cy={selectedGeom.handlePy} r={5}
                    fill={ROOM.accent}
                    style={{ pointerEvents: 'all', cursor: 'crosshair' }}
                    onPointerDown={(e) => handleWallRotatePointerDown(selectedGeom.index, e)}
                  />
                  {selectedGeom.screenCorners.map(([cx, cy], i) => (
                    <circle
                      key={`corner-${i}`}
                      cx={cx} cy={cy} r={5.5}
                      fill="#ffffff" stroke={ROOM.accent} strokeWidth={2}
                      style={{ pointerEvents: 'none' }}
                    />
                  ))}
                </g>
              )}

              {/* Live dimension while stretching. The W/H fields below already
                  show the number, but they're off to the side of the canvas —
                  you can't drag a handle and read a value 300px away at the same
                  time. This puts it on the wall being resized. Shown only during
                  the gesture so it isn't permanent clutter. */}
              {mode === 'walls' && stretchingWallIndex !== null && (() => {
                const g = wallGeometry[stretchingWallIndex]
                if (!g) return null
                const label = formatFeetInches(g.widthInches)
                // Placed on the BACK of the wall (−outU): the rotate handle sits
                // ~31px off the front along the same axis, so a front-side badge
                // paints over it for the whole gesture.
                const lx = g.centerPx - g.outUx * 26
                const ly = g.centerPy - g.outUy * 26
                // Rough box so the text stays readable over walls and grid.
                const boxW = label.length * 7.2 + 12
                return (
                  <g style={{ pointerEvents: 'none' }}>
                    <rect
                      x={lx - boxW / 2} y={ly - 11}
                      width={boxW} height={20} rx={5}
                      fill={ROOM.ink}
                    />
                    <text
                      x={lx} y={ly + 3}
                      textAnchor="middle"
                      style={{ fontFamily: MONO_STACK, fontSize: 12, fontWeight: 600 }}
                      fill="#ffffff"
                    >
                      {label}
                    </text>
                  </g>
                )
              })()}
            </svg>

            {/* Stretch invisible hitbox divs (20×20, easier grab), on the
                selected wall's four corner grips. Both corners of an end drive
                the same end — the pair is one connection point drawn at its two
                real positions, not two independent handles. */}
            {selectedGeom && (() => {
              const dx = selectedGeom.endPx - selectedGeom.startPx
              const dy = selectedGeom.endPy - selectedGeom.startPy
              const stretchCursor = Math.abs(dy) > Math.abs(dx) ? 'ns-resize' : 'ew-resize'
              return selectedGeom.screenCorners.map(([cx, cy], i) => (
                <div
                  key={`sh-${i}`}
                  className="absolute"
                  style={{ left: cx - 10, top: cy - 10, width: 20, height: 20, cursor: stretchCursor }}
                  onPointerDown={(e) =>
                    handleWallStretchPointerDown(selectedGeom.index, CORNER_END[i], e)
                  }
                />
              ))
            })()}

            {/* Tables (tables mode only) */}
            {mode === 'tables' && tables.map((table) => {
              const [px, py] = proj.toPx(table.x, table.z)
              const w = table.width * uniformScale
              const h = table.depth * uniformScale
              const isSelected = selectedTableId === table.id
              // Negated for the same reason wall rotation is (see the rotate
              // handler): a world Y-rotation reads as the opposite screen angle
              // under a +Z-down plan. Currently invisible — the UI only emits
              // quarter turns and the plan glyph is a plain rectangle — but it
              // would silently mirror the moment either of those changes.
              const rotationDeg = -((table.rotation ?? 0) * 180) / Math.PI
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
                    borderColor: isSelected ? ROOM.accent : ROOM.ink2,
                    // Tinted from the same two tokens as the border above —
                    // these were still indigo-500/slate-400 rgba, so a selected
                    // table drew an accent border over an indigo fill.
                    backgroundColor: isSelected ? 'rgba(59,110,246,0.15)' : 'rgba(138,143,160,0.2)',
                  }}
                >
                  {/* The MIDDLE is the model target: click it and the file
                      dialog opens for this table. It used to be a button in an
                      inspector below the canvas, which you had to find after
                      selecting the table — and selecting was itself unreliable,
                      because the four rotate hotspots below were 24px each and
                      on a table this size they covered the whole glyph. They
                      are 14px now and pinned to the corners, so the centre is
                      always clear. */}
                  <button
                    type="button"
                    title={table.modelUrl ? 'Replace this model' : 'Add a 3D model'}
                    aria-label={table.modelUrl ? 'Replace model' : 'Add model'}
                    // pointerdown is what starts the table drag; swallow it here
                    // so pressing the centre never drags the table out from
                    // under the click that was meant to open the picker.
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelectedTableId(table.id)
                      uploadTargetRef.current = table.id
                      fileInputRef.current?.click()
                    }}
                    disabled={uploadingTableId === table.id}
                    className="flex flex-col items-center justify-center gap-0.5 px-1 rounded-md hover:bg-white/60 disabled:opacity-70"
                    style={{ color: isSelected ? ROOM.accent : ROOM.ink2 }}
                  >
                    {uploadingTableId === table.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : table.modelUrl ? (
                      <span className="text-[10px] font-medium truncate">Model</span>
                    ) : (
                      <>
                        <Upload className="w-3.5 h-3.5" />
                        <span className="text-[9px] font-medium leading-none">Add model</span>
                      </>
                    )}
                  </button>

                  {[['0%', '0%'], ['100%', '0%'], ['100%', '100%'], ['0%', '100%']].map(([left, top], i) => (
                    <div
                      key={i}
                      className="absolute w-3.5 h-3.5 cursor-pointer rounded-sm"
                      style={{
                        left,
                        top,
                        transform: 'translate(-50%,-50%)',
                        background: isSelected ? ROOM.accent : 'transparent',
                      }}
                      title="Rotate 90°"
                      onPointerDown={(e) => handleRotateTable(table.id, e)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ))}

                  {/* Delete. Centred ABOVE the table and rendered after the
                      rotate handles, both deliberately: it used to sit on the
                      top-right corner, where the 14px rotate target landed
                      entirely inside its 20px box and — being later in the DOM
                      — took every click. The button was there and looked right;
                      it just never received the press. Mid-edge is the one
                      place none of the four corner targets can reach. */}
                  {isSelected && (
                    <button
                      type="button"
                      title="Remove this table"
                      aria-label="Remove table"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation()
                        setTables((prev) => prev.filter((t) => t.id !== table.id))
                        setSelectedTableId(null)
                      }}
                      className="absolute z-10 w-5 h-5 rounded-full bg-white border shadow-sm flex items-center justify-center hover:bg-[#D64545]/[0.08]"
                      style={{
                        left: '50%',
                        top: 0,
                        transform: 'translate(-50%, -150%)',
                        borderColor: ROOM.hairline,
                        color: '#D64545',
                      }}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              )
            })}
          </div>

          {/* Always mounted, never inside a conditional panel: the picker is
              opened from a table's centre, and an input that only exists while
              something is selected is not there yet at the moment of the click
              that selects it. */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".glb,.gltf,.3dm,.stl"
            className="hidden"
            onChange={handleTableFileChange}
          />

          {/* Upload progress. The only part of the old inspector worth keeping:
              a large model takes long enough that silence reads as failure. */}
          {mode === 'tables' && uploadingTableId && (
            <p className="mt-2 text-xs" style={{ color: ROOM.ink2 }}>
              {uploadLabel(modelUploadPct, modelUploadLoaded, modelUploadTotal)}
            </p>
          )}

          {/* ---- Floating canvas chrome (embedded only) ----
              The Snap pill sits over the plan rather than in the sidebar: it
              describes the CANVAS gesture you are about to make, and reading
              "hold Shift" from a column on the far right while your hand is on a
              wall is the wrong place for it. pointer-events are off on the
              wrapper so it cannot swallow a drag that starts under it.

              WALLS ONLY. Snapping is wall-to-wall corner welding; tables are
              floor-anchored and their drag path never consults it (see the
              table branch in applyPointerAt). In Models mode it was a live
              switch for something that could not happen. */}
          {embedded && mode === 'walls' && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-wrap items-end justify-between gap-3 p-4">
              {/* A hint pill sat here reading "Drag a wall to move · ends snap
                  together". It described the two most discoverable gestures on
                  the surface — things you learn by touching a wall once — and
                  paid for them with a permanent label across the plan. The
                  spacer keeps the Snap pill pinned right. */}
              <span aria-hidden="true" />
              {/* The same switch as the sidebar's, deliberately duplicated: it
                  is the one setting you reach for mid-gesture, and it reads the
                  same state, so the two can never disagree. */}
              <button
                type="button"
                role="switch"
                aria-checked={snapEnabled}
                onClick={() => setSnapEnabled((v) => !v)}
                className="pointer-events-auto flex items-center gap-2.5 rounded-full border border-[#16181D]/[0.08] bg-white/90 px-4 py-2 text-xs font-semibold text-[#16181D] shadow-[0_4px_16px_rgba(22,24,29,0.08)] backdrop-blur-sm transition-colors hover:bg-white"
              >
                <span
                  aria-hidden="true"
                  className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                    snapEnabled ? 'bg-[#3B6EF6]' : 'bg-[#16181D]/[0.15]'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
                      snapEnabled ? 'left-[18px]' : 'left-0.5'
                    }`}
                  />
                </span>
                {/* Just "Snap". The switch beside it already says on or off —
                    saying it again in words means the pill changes width as you
                    toggle it, and the one control that must not move under the
                    cursor mid-drag is this one. `role="switch"` +
                    `aria-checked` still announce the state. */}
                Snap
              </button>
            </div>
          )}
        </div>

        {/* ---- Right-hand inspector (embedded plan tab only) ----
            Replaces the old bottom-left card. A sidebar rather than a floating
            panel because the wall inspector has to hold a name, three numeric
            fields, a thumbnail strip and two destructive-ish actions — that is a
            column of content, and a 252px card over the canvas could only ever
            show a slice of it while covering the plan it describes.

            pt-16 clears the room's own fixed chrome, which owns the top strip on
            both sides — the breadcrumb at top-left, Share and the menu at
            top-right, all at a higher z than this panel. Without it the
            Walls/Models toggle sits underneath the Share button. */}
        {embedded && (
          <aside className="relative z-10 flex w-[272px] shrink-0 flex-col border-l border-[#16181D]/[0.08] bg-white pt-16">
            <div className="flex-1 space-y-5 overflow-y-auto p-4 pt-0">
              {mode === 'walls' ? (
                selectedWallIndex != null && selectedWallIndex < wallConfig.walls.length ? (
                  <>
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#A8ADBA]">
                          Selected
                        </span>
                        {selectedWallBoards.length > 0 && (
                          <span className="rounded-full bg-[#3B6EF6]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[#3B6EF6]">
                            {selectedWallBoards.length} board{selectedWallBoards.length === 1 ? '' : 's'}
                          </span>
                        )}
                      </div>
                      <h3 className="mt-0.5 text-[22px] font-extrabold tracking-[-0.02em] text-[#16181D]">
                        Wall {String(selectedWallIndex + 1).padStart(2, '0')}
                      </h3>
                    </div>

                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#A8ADBA]">
                        Transform
                      </span>
                      <div className="mt-2 space-y-2">
                        {/* The read-only 6" WIDTH row is gone.
                            It showed the wall THICKNESS, which is the same for
                            every wall in the room and cannot be changed from
                            here — a field you can neither edit nor act on, taking
                            the top slot of the one panel where the two numbers
                            that DO matter live. It was kept on the argument that
                            "length and height" leaves you hunting for a third
                            dimension; nobody was hunting, and a wall's thickness
                            is not a question this panel is asked.

                            LENGTH is wall.width in the data model — the span
                            along the floor. Renamed in the UI only, and now the
                            only thing here wearing the word. */}
                        {([
                          { key: 'width' as const, label: 'Length', value: wallWidthInput, set: setWallWidthInput },
                          { key: 'height' as const, label: 'Height', value: wallHeightInput, set: setWallHeightInput },
                        ]).map(({ key, label, value, set }) => (
                          <label
                            key={key}
                            className="flex items-center justify-between gap-2 rounded-xl border border-[#16181D]/[0.08] px-3 py-1.5 focus-within:border-[#3B6EF6] focus-within:ring-1 focus-within:ring-[#3B6EF6]"
                          >
                            <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#A8ADBA]">{label}</span>
                            <span className="flex items-center gap-1">
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
                                className="w-14 bg-transparent py-1 text-right text-sm font-semibold text-[#16181D] focus:outline-none"
                                aria-label={`Wall ${selectedWallIndex + 1} ${label.toLowerCase()} in feet`}
                              />
                              <span className="text-xs text-[#A8ADBA]">ft</span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {selectedWallBoards.length > 0 && (
                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#A8ADBA]">
                          Boards on this wall
                        </span>
                        {/* Two per row at the panel's width rather than four,
                            because these are now the way INTO a board and not
                            just a count of them — at 48px a drawing was a
                            coloured smudge you could not recognise, let alone
                            choose between. */}
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          {selectedWallBoards.slice(0, 8).map((b) => {
                            const inner = b.thumbnailUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={b.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                            ) : null
                            // A button only when the host gave us somewhere to
                            // go. Rendering one that does nothing would be worse
                            // than the plain tile it replaces.
                            return onBoardOpen ? (
                              <button
                                key={b.id}
                                type="button"
                                title={b.title}
                                onClick={() => onBoardOpen(b)}
                                className="block aspect-[3/4] w-full overflow-hidden rounded-lg border border-[#16181D]/[0.08] bg-[#F4F6FB] transition-shadow hover:border-[#3B6EF6] hover:shadow-[0_6px_18px_rgba(59,110,246,0.18)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3B6EF6]/40"
                              >
                                {inner}
                              </button>
                            ) : (
                              <span
                                key={b.id}
                                title={b.title}
                                className="block aspect-[3/4] w-full overflow-hidden rounded-lg border border-[#16181D]/[0.08] bg-[#F4F6FB]"
                              >
                                {inner}
                              </span>
                            )
                          })}
                          {selectedWallBoards.length > 8 && (
                            <span className="flex aspect-[3/4] w-full items-center justify-center rounded-lg border border-dashed border-[#16181D]/[0.12] text-[13px] font-semibold text-[#A8ADBA]">
                              +{selectedWallBoards.length - 8}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-[#8A8FA0]">Click a wall in the plan to select it.</p>
                )
              ) : (
                <>
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#A8ADBA]">
                      Selected
                    </span>
                    <h3 className="mt-0.5 text-[22px] font-extrabold tracking-[-0.02em] text-[#16181D]">
                      {selectedTable ? 'Table' : 'Nothing'}
                    </h3>
                    <p className="mt-1 text-sm text-[#8A8FA0]">
                      {selectedTable
                        ? 'Drag it in the plan to move it. Rotate it or attach a 3D model below.'
                        : 'Add a table, or click one in the plan.'}
                    </p>
                  </div>

                  {selectedTable && (
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={(e) => handleRotateTable(selectedTable.id, e)}
                        className="w-full rounded-xl border border-[#16181D]/[0.12] px-4 py-2.5 text-sm font-semibold text-[#16181D] transition-colors hover:bg-[#16181D]/5"
                      >
                        Rotate 90°
                      </button>
                      {/* Opens the same picker the table's own in-plan button
                          opens, through the same ref handshake — uploadTargetRef
                          is what tells the change handler which table the file
                          belongs to, and it must be set before the click. */}
                      <button
                        type="button"
                        disabled={uploadingTableId === selectedTable.id}
                        onClick={() => {
                          uploadTargetRef.current = selectedTable.id
                          fileInputRef.current?.click()
                        }}
                        className="w-full rounded-xl bg-[#3B6EF6] px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#16181D] disabled:opacity-50"
                      >
                        {uploadingTableId === selectedTable.id
                          ? 'Uploading…'
                          : selectedTable.modelUrl ? 'Replace 3D model' : 'Add 3D model'}
                      </button>
                      {selectedTable.modelUrl && (
                        <button
                          type="button"
                          onClick={() => setTables((prev) => prev.map((t) => (
                            t.id === selectedTable.id ? { ...t, modelUrl: undefined } : t
                          )))}
                          className="w-full rounded-xl px-4 py-2 text-sm font-semibold text-[#C2452D] transition-colors hover:bg-[#C2452D]/[0.06]"
                        >
                          Remove 3D model
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* Snap lives ONLY on the canvas pill now (bottom-right). It was
                  in both places deliberately — same state, two reads — but the
                  sidebar copy carried a paragraph of explanation nobody needs
                  after the first drag, and it was the tallest block in a column
                  that has real work to hold. The pill is the one you reach for
                  mid-gesture; this was the one you read once. */}
            </div>

            {/* Which layer you are grabbing.
                Moved from the top of the panel down here, with the actions. It
                is not a header — it does not describe what is above it, it
                CHANGES what Add/Remove and the whole inspector operate on — so
                it belongs in the same block as the buttons it re-aims. Sized
                like them too: it was a 12px pair of tabs sitting above a
                heading, which read as a caption rather than the mode switch for
                the entire panel. */}
            {onModeChange && (
              <div className="flex shrink-0 gap-1.5 border-t border-[#16181D]/[0.06] p-3 pb-0">
                {([
                  { key: 'walls' as const, label: 'Walls' },
                  { key: 'tables' as const, label: 'Models' },
                ]).map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => onModeChange(key)}
                    aria-pressed={mode === key}
                    className={`flex-1 rounded-xl px-3 py-2.5 text-sm font-bold transition-colors ${
                      mode === key
                        ? 'bg-[#3B6EF6] text-white'
                        : 'border border-[#16181D]/[0.10] text-[#5A5E6B] hover:bg-[#16181D]/5'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            <div className="shrink-0 space-y-2 p-3">
              {mode === 'walls' ? (
                <>
                  <button
                    type="button"
                    onClick={handleAddWall}
                    className="w-full rounded-xl border border-[#16181D]/[0.12] px-4 py-2.5 text-sm font-semibold text-[#16181D] transition-colors hover:bg-[#16181D]/5"
                  >
                    Add Wall
                  </button>
                  {/* Delete-gated as before: removing a wall removes its boards,
                      so it is withheld rather than shown disabled. */}
                  {canDeleteWalls && (
                    <button
                      type="button"
                      onClick={handleRemoveWall}
                      disabled={selectedWallIndex == null || wallConfig.walls.length <= 1}
                      className="w-full rounded-xl border border-[#C2452D]/30 px-4 py-2.5 text-sm font-semibold text-[#C2452D] transition-colors hover:bg-[#C2452D]/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
                      title={selectedWallIndex == null ? 'Click a wall to select it first' : `Remove wall ${selectedWallIndex + 1}`}
                    >
                      Remove Wall
                    </button>
                  )}
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleAddTable}
                    className="w-full rounded-xl border border-[#16181D]/[0.12] px-4 py-2.5 text-sm font-semibold text-[#16181D] transition-colors hover:bg-[#16181D]/5"
                  >
                    Add Table
                  </button>
                  {selectedTable && (
                    <button
                      type="button"
                      onClick={() => {
                        setTables((prev) => prev.filter((t) => t.id !== selectedTable.id))
                        setSelectedTableId(null)
                      }}
                      className="w-full rounded-xl border border-[#C2452D]/30 px-4 py-2.5 text-sm font-semibold text-[#C2452D] transition-colors hover:bg-[#C2452D]/[0.06]"
                    >
                      Remove Table
                    </button>
                  )}
                </>
              )}
              {/* Walls autosave through onWallConfigChange; tables do not, so
                  this stays an explicit Save rather than becoming a second
                  debounced writer on the versioned wall-config blob. */}
              <button
                type="button"
                onClick={() => onSaveAndExit()}
                className="w-full rounded-xl bg-[#16181D] px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#3B6EF6]"
              >
                Save
              </button>
            </div>
          </aside>
        )}
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
