'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ROOM, SANS_STACK } from '@/lib/room/palette'
import {
  IDENTITY_VIEWPORT,
  canvasToScreenLength,
  fitBounds,
  panBy,
  screenToCanvasLength,
  toCanvas,
  toScreen,
  wheelZoomFactor,
  zoomAt,
  zoomTo,
  type Bounds,
  type Point,
  type Viewport,
} from '@/lib/canvas/viewport'
import {
  aabbOf,
  allHandlePoints,
  cornersOf,
  clampToLimits,
  handleCursor,
  hitHandle,
  MIN_NODE_SIZE,
  nodesInRect,
  rectFromPoints,
  resizeNode,
  resizeGrabOffset,
  rotateGrabOffset,
  rotateNode,
  topmostAt,
  unionBounds,
  type NodeGeometry,
  type ResizeHandle,
  type TransformHandle,
} from '@/lib/canvas/geometry'
import { useCanvasNodes, type CanvasNodeInput } from '@/hooks/useCanvasNodes'
import { useCanvasHistory } from '@/hooks/useCanvasHistory'
import {
  geometryChanged,
  geometryOf,
  type CanvasHistoryEntry,
  type CanvasOp,
} from '@/lib/canvas/history'
import type { CanvasNode, CanvasNodeType } from '@/lib/canvas/types'
import {
  fitPlacedSize,
  isCanvasImage,
  readImageSize,
  rejectionReason,
  IMAGE_FALLBACK_SIZE,
} from '@/lib/canvas/imageNode'
import { useDirectUpload } from '@/lib/useDirectUpload'
import {
  alignNodes,
  distributeNodes,
  restackNodes,
  type AlignMode,
  type DistributeMode,
} from '@/lib/canvas/arrange'
import CanvasToolbar, { INK_COLORS, type CanvasTool } from './CanvasToolbar'
import CanvasSelectionBar from './CanvasSelectionBar'
import CanvasNodeView, { MIN_INK_EXTENT, STICKY_COLORS, pathFromPoints } from './CanvasNodeView'

/**
 * The infinite canvas surface.
 *
 * Two stacked layers, deliberately:
 *
 *   1. A single transformed div holding every node. Pan and zoom are ONE
 *      composited transform on that div, so moving the viewport costs no
 *      layout and no per-node work.
 *   2. A screen-space SVG overlay for selection outlines and handles. Drawing
 *      those inside the transformed layer would mean counter-scaling every
 *      handle by 1/zoom to keep it a constant size, and they would still go
 *      soft at high zoom. Computing them in screen coordinates keeps them
 *      pixel-crisp at any zoom.
 *
 * Resize and rotate apply to a SINGLE selected node. Multi-select supports move
 * only — resizing a rotated group correctly means compounding each member's
 * transform against the group's, and doing it half-right is worse than not
 * offering it. Move is the operation people actually reach for on a group.
 */

interface InfiniteCanvasProps {
  canvasId: string | null
  /** Guest link token, when the viewer is a critic rather than an account. */
  guestToken?: string | null
  /** Read-only surfaces (view mode, archived spaces) pass false. */
  canEdit?: boolean
  className?: string
}

/** Handle box size and hit slop, in SCREEN pixels — constant at every zoom. */
const HANDLE_PX = 9
const HANDLE_HIT_PX = 14
/** Screen-pixel gap between the node's top edge and the rotate handle. */
const ROTATE_GAP_PX = 26
/** Pointer travel before a press becomes a drag, so a sloppy click still selects. */
const DRAG_THRESHOLD_PX = 3
/** Canvas-space grid pitch. */
const GRID = 40

const STICKY_SIZE = 180
const TEXT_W = 260
const TEXT_H = 44
/** Default stroke weight, in canvas units. */
const INK_SIZE = 3
/**
 * Ink is sampled per pointermove, which on a high-rate mouse is far denser than
 * the stroke needs. Samples closer together than this many SCREEN pixels are
 * dropped: props ships over realtime as a full row on every write, so an
 * unfiltered stroke is both a fatter payload and a slower path to render.
 * Screen pixels, not canvas units — the same hand movement should sample the
 * same way at any zoom.
 */
const INK_MIN_STEP_PX = 2
/**
 * Hard cap on points in one stroke.
 *
 * props travels as a full row on every realtime write, and the API refuses a
 * body over 1 MB — which a stroke would only reach after minutes of unbroken
 * drawing, but reaching it would fail the whole stroke AFTER it was drawn.
 * Stopping quietly at the cap costs the tail of an implausibly long line;
 * failing costs all of it.
 */
const INK_MAX_POINTS = 4000

/**
 * How far a duplicate or paste lands from its source, in canvas units.
 *
 * Enough to see there are two of something without throwing the copy across
 * the board. Matches the cascade used for a multi-file image drop.
 */
const DUPLICATE_OFFSET = 28

/**
 * Minimum thickness given to an axis-aligned line's box, in canvas units.
 *
 * A dead-horizontal drag reports the same y throughout — common with a mouse,
 * not an edge case — and yields a box of zero height. That box does not render
 * and cannot be hit-tested, so the line exists in the database and nowhere
 * else. Padding it gives the stroke something to live in and something to
 * click. The ink path pads by its stroke weight for exactly this reason.
 */
const LINE_MIN_EXTENT = 10

/** Right edge of the tool rail in screen px (left: 16 + 44 wide), for clamping. */
const TOOL_RAIL_RIGHT_EDGE = 72

/**
 * Rebuild the create payload for a node an undo is putting back.
 *
 * The ORIGINAL id, so a redo and any later op still on the stack address the
 * same row rather than a stale one.
 *
 * Two things do not survive the round trip, both by design of the API rather
 * than oversight here. Authorship is stamped server-side from the caller, so
 * restoring a node you deleted but did not create re-attributes it to you —
 * accepting that is much cheaper than letting a request name its own author.
 * And `created_at` is new, which matters only as the tie-break between two
 * nodes sharing a `z`: a restored node may land on the other side of an exact
 * layer tie. Connectors attached to the node were cascade-deleted by the
 * database and are NOT restored either; nothing creates connectors yet, so
 * there is nothing to lose today.
 */
function restoreInputOf(node: CanvasNode): CanvasNodeInput {
  return {
    id: node.id,
    // CanvasNode.type is a plain string. The narrowing rests on migration
    // 036's CHECK, which is what every path into this — POST's own validation,
    // a GET, a realtime row — ultimately passes through. And a value that
    // somehow escaped it would be refused again on the way back in.
    type: node.type as CanvasNodeType,
    x: node.x,
    y: node.y,
    w: node.w,
    h: node.h,
    rotation: node.rotation,
    z: node.z,
    props: node.props,
    fromNodeId: node.fromNodeId,
    toNodeId: node.toNodeId,
  }
}

/**
 * True only for an actual file drag, not selected text or a dragged element.
 *
 * Module scope so the drag handlers that use it need no dependency on it.
 */
function isFileDrag(e: React.DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files')
}

/**
 * An upload in flight, drawn where it will land.
 *
 * Local state, NOT a database row. A placeholder node would mean writing a row
 * that must be cleaned up if the upload fails, and broadcasting a half-made
 * object to anyone else on the canvas. This is a box on the screen of the
 * person doing the dropping, and it disappears either way.
 */
interface PendingUpload {
  key: string
  x: number
  y: number
  w: number
  h: number
  name: string
  progress: number
}

type DragMode = 'pan' | 'move' | 'resize' | 'rotate' | 'marquee' | 'create'

interface DragState {
  mode: DragMode
  pointerId: number
  startScreen: Point
  startCanvas: Point
  startViewport: Viewport
  /** Geometry of every affected node at gesture start, for delta maths. */
  originals: Map<string, NodeGeometry>
  handle?: TransformHandle
  rotateOffset?: number
  /** Where inside the handle the pointer grabbed, in the node's local frame. */
  grabOffset?: Point
  /** Selection to extend when a shift-marquee began, so it adds rather than replaces. */
  marqueeBase?: string[]
  moved: boolean
}

export default function InfiniteCanvas({
  canvasId,
  guestToken,
  canEdit = true,
  className,
}: InfiniteCanvasProps) {
  const {
    nodes,
    loading,
    error,
    clearError,
    createNode,
    commitNode,
    deleteNode,
    previewNode,
    beginGesture,
    endGesture,
  } = useCanvasNodes(canvasId, guestToken)

  // Destructured rather than held as one object: these are the dependencies of
  // the key handler, which must not be rebuilt on every frame of a drag, and
  // the hook's returned object is a fresh literal each render.
  const {
    record: recordHistory,
    takeUndo,
    takeRedo,
    stashRedo,
    stashUndo,
    canUndo,
    canRedo,
  } = useCanvasHistory(canvasId)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const [viewport, setViewport] = useState<Viewport>(IDENTITY_VIEWPORT)
  const [selection, setSelection] = useState<string[]>([])
  const [marquee, setMarquee] = useState<Bounds | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [tool, setTool] = useState<CanvasTool>('select')
  const [color, setColor] = useState<string>(INK_COLORS[0])
  /** Node whose text is being edited inline. */
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
  /** In-progress shape or stroke, before it becomes a node. */
  const [draft, setDraft] = useState<{
    tool: CanvasTool
    rect?: Bounds
    points?: Point[]
  } | null>(null)
  /** Draw a focus ring only when focus arrived from the keyboard. The container
   *  is focusable for its key handlers, so suppressing the ring outright would
   *  leave keyboard users with no indication of where they are. */
  const [keyboardFocus, setKeyboardFocus] = useState(false)
  const pointerFocusRef = useRef(false)
  /** A click-to-place is in flight; see placeTextual. */
  const placingRef = useRef(false)
  /** An undo or redo is being applied; see stepHistory. */
  const applyingRef = useRef(false)
  /**
   * User-action writes that have not settled yet, INCLUDING the recording of
   * their history entry.
   *
   * Undo waits on these. Two things go wrong without it. A delete is
   * fire-and-forget, so a Cmd+Z straight after one — which is exactly when
   * people press it — would send the restoring POST while that DELETE is still
   * in the air; nothing orders two requests on one connection, and if they
   * land the wrong way round the row is gone on the server while the client
   * shows it back. And a create records its entry only once the response
   * arrives, so an undo racing it would pop the entry BEFORE it, leaving the
   * new object standing and an older action undone in its place.
   */
  const pendingActionsRef = useRef<Set<Promise<unknown>>>(new Set())

  const trackAction = useCallback(<T,>(p: Promise<T>): Promise<T> => {
    const pending = pendingActionsRef.current
    pending.add(p)
    // The catch is bookkeeping only — it keeps this branch from becoming an
    // unhandled rejection. The promise handed back is the caller's, untouched.
    void p.catch(() => {}).finally(() => pending.delete(p))
    return p
  }, [])
  /** Cursor for whatever is under the pointer while nothing is being dragged. */
  const [hoverCursor, setHoverCursor] = useState<string>('default')
  /** Uploads in flight, drawn at their drop point. */
  const [pending, setPending] = useState<PendingUpload[]>([])
  /** Upload and file-type failures. Separate from the node hook's own error. */
  const [uploadError, setUploadError] = useState<string | null>(null)
  /** A file is being dragged over the surface. */
  const [dropActive, setDropActive] = useState(false)
  /**
   * dragenter/dragleave fire for every child element the pointer crosses, so a
   * plain boolean flickers off the moment the cursor passes over a node. Depth
   * counting is the standard fix: only the leave that balances the last enter
   * clears the highlight.
   */
  const dragDepthRef = useRef(0)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const { upload } = useDirectUpload()

  const dragRef = useRef<DragState | null>(null)
  /**
   * Whether a gesture is running, as STATE rather than only as a ref.
   *
   * The contextual bar has to hide during a drag, and a ref cannot drive that:
   * reading dragRef during render gave a stale answer, and — worse — a plain
   * click produces no state change at all on release (nothing moved, so no
   * commit, no marquee, no setState). The bar stayed hidden after the single
   * most common way to select something, until an unrelated render happened
   * along. Mirrored through beginDrag/endDragState so the two cannot drift.
   */
  const [dragging, setDragging] = useState(false)
  const beginDrag = useCallback((state: DragState) => {
    dragRef.current = state
    setDragging(true)
  }, [])
  /**
   * Latest values for the pointer handlers, which must not re-bind per frame.
   *
   * Written in an effect rather than during render: a render that React
   * discards (a transition, a Suspense retry) would still have mutated a ref
   * assigned inline, leaving these describing a commit that never happened.
   * Effects flush before the next event, so handlers still read current values.
   */
  const viewportRef = useRef(viewport)
  const nodesRef = useRef(nodes)
  const selectionRef = useRef(selection)
  /**
   * The draft, written synchronously by the pointer handlers.
   *
   * NOT mirrored from state by an effect: finishDrag reads this during a
   * discrete pointerup, which can run before a continuous setDraft from the
   * final pointermove has flushed — so mirroring would drop the last ink
   * sample, or commit a rect one frame stale. State exists only to render the
   * preview.
   */
  const draftRef = useRef<{
    tool: CanvasTool
    rect?: Bounds
    points?: Point[]
  } | null>(null)
  /**
   * The raw endpoints of a line being drawn, before they become a box.
   *
   * `rect` normalises a drag into min/max corners, which loses the direction it
   * was made in — and for a line the direction IS the shape. Dragging up-right
   * and down-right produce the same rect but opposite diagonals. Kept beside
   * the draft rather than inside it so the existing rect-based preview, hit
   * test and commit paths are untouched.
   */
  const draftLineRef = useRef<{ from: Point; to: Point } | null>(null)
  const toolRef = useRef(tool)
  const colorRef = useRef(color)
  useEffect(() => {
    toolRef.current = tool
    // Hover feedback is skipped while a tool is armed, so whatever was under
    // the pointer last would flash back for a frame on returning to select.
    setHoverCursor('default')
  }, [tool])
  useEffect(() => {
    colorRef.current = color
  }, [color])
  useEffect(() => {
    viewportRef.current = viewport
  }, [viewport])
  useEffect(() => {
    nodesRef.current = nodes
  }, [nodes])
  useEffect(() => {
    selectionRef.current = selection
  }, [selection])

  const selectedNodes = useMemo(
    () => nodes.filter((n) => selection.includes(n.id)),
    [nodes, selection]
  )
  const soleSelected = selectedNodes.length === 1 ? selectedNodes[0] : null

  // ---------------------------------------------------------------------------
  // Element size, for fit-to-content and marquee maths.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight })
    })
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  /** Pointer position relative to the canvas element, not the page. */
  const screenPoint = useCallback((e: { clientX: number; clientY: number }): Point => {
    const rect = containerRef.current?.getBoundingClientRect()
    return {
      x: e.clientX - (rect?.left ?? 0),
      y: e.clientY - (rect?.top ?? 0),
    }
  }, [])

  const canvasPoint = useCallback(
    (e: { clientX: number; clientY: number }): Point =>
      toCanvas(viewportRef.current, screenPoint(e)),
    [screenPoint]
  )

  /**
   * Put focus back on the canvas after an inline editor closes.
   *
   * The textarea unmounts on commit, and focus falls to <body> — every canvas
   * shortcut then does nothing until the user clicks the surface again, which
   * reads as the keyboard having broken.
   */
  const refocus = useCallback(() => {
    // Deferred a frame so the editor has unmounted first — focusing the
    // container synchronously fires focusout on a textarea that is still
    // mounted, which React turns back into a commit.
    requestAnimationFrame(() => {
      const el = containerRef.current
      if (!el) return
      const active = document.activeElement
      // Only reclaim focus that fell to nothing. If the user clicked from a
      // note straight into a comment box or the chat, that is where they meant
      // to be, and yanking it back mid-transition is worse than losing the
      // shortcuts.
      if (active && active !== document.body && !el.contains(active)) return
      el.focus({ preventScroll: true })
    })
  }, [])

  /** One above the current top, so a new object lands on top of the pile. */
  const nextZ = useCallback(
    () => nodesRef.current.reduce((max, n) => Math.max(max, n.z), 0) + 1,
    []
  )

  /**
   * Create a node and put it on the undo stack.
   *
   * Every creation the USER makes goes through here. An undo or redo that
   * happens to create a node deliberately does not — those call createNode
   * directly, because their entry is already being moved between the stacks by
   * stepHistory, and recording it again would both duplicate it and wipe the
   * redo branch the user is standing in the middle of.
   */
  const createTracked = useCallback(
    (input: CanvasNodeInput) =>
      // The tracked promise spans the recording too, not just the write, so an
      // undo waiting on it cannot resolve into the gap between them.
      trackAction(
        (async () => {
          const node = await createNode(input)
          if (node) recordHistory([{ kind: 'create', node }])
          return node
        })()
      ),
    [createNode, recordHistory, trackAction]
  )

  /**
   * Upload dropped or picked images and turn each into a node.
   *
   * Sequential, not concurrent. Compression decodes the whole bitmap, so five
   * phone photos at once is five full-resolution buffers alive together — on a
   * laptop that is where the tab starts swapping.
   *
   * All the placeholders appear TOGETHER, once dimensions have been read, and
   * then fill in one at a time. Measuring first is what makes each box the
   * right shape from its first frame; the read is a decode-header, not a full
   * decode, and it is bounded by a timeout in readImageSize so a file that
   * refuses to report cannot stall the drop.
   */
  const placeImageFiles = useCallback(
    async (files: File[], at: Point) => {
      if (!canEdit || files.length === 0) return

      /**
       * Keep the FIRST problem, not the last.
       *
       * Dropping five files where two fail used to show whichever failed most
       * recently, and an upload failure would overwrite the "that was a PDF"
       * message the user actually needed. The first thing that went wrong is
       * the one that explains the rest.
       */
      let reported = false
      const reportProblem = (message: string) => {
        if (reported) return
        reported = true
        setUploadError(message)
      }

      const accepted = files.filter(isCanvasImage)
      const refused = files.filter((f) => !isCanvasImage(f))
      // FIRST problem wins, and it keeps winning — see reportProblem. Only one
      // reason is shown at all: dropping a folder of mixed files should not
      // produce a stack of banners saying nearly the same thing.
      if (refused.length > 0) reportProblem(rejectionReason(refused[0]))
      if (accepted.length === 0) return

      // Measured up front so every placeholder is the right shape from the
      // first frame, and so a cascade can be laid out before anything uploads.
      const measured = await Promise.all(
        accepted.map(async (file) => {
          const size = await readImageSize(file)
          return {
            file,
            ...(size
              ? fitPlacedSize(size.width, size.height)
              : { w: IMAGE_FALLBACK_SIZE, h: IMAGE_FALLBACK_SIZE }),
          }
        })
      )

      // Cascade, so dropping several files doesn't hide all but the last.
      const CASCADE = 28
      const placements = measured.map((m, i) => ({
        ...m,
        key: `${Date.now()}-${i}-${m.file.name}`,
        x: at.x - m.w / 2 + i * CASCADE,
        y: at.y - m.h / 2 + i * CASCADE,
      }))

      setPending((prev) => [
        ...prev,
        ...placements.map((p) => ({
          key: p.key,
          x: p.x,
          y: p.y,
          w: p.w,
          h: p.h,
          name: p.file.name,
          progress: 0,
        })),
      ])

      for (const placement of placements) {
        try {
          const result = await upload(placement.file, {
            onProgress: (pct) =>
              setPending((prev) =>
                prev.map((p) => (p.key === placement.key ? { ...p, progress: pct } : p))
              ),
          })
          const box = clampToLimits({
            x: placement.x,
            y: placement.y,
            w: placement.w,
            h: placement.h,
            rotation: 0,
          })
          await createTracked({
            type: 'image',
            x: box.x,
            y: box.y,
            w: box.w,
            h: box.h,
            z: nextZ(),
            props: {
              url: result.fullUrl,
              thumbUrl: result.thumbnailUrl,
              storagePath: result.storagePath,
              thumbPath: result.thumbnailPath,
              name: placement.file.name,
            },
          })
        } catch (err) {
          reportProblem(
            `Couldn't upload ${placement.file.name}: ${(err as Error).message || 'upload failed'}`
          )
        } finally {
          // Always, on both paths — a placeholder left behind after a failure is
          // a permanent grey box the user cannot remove.
          setPending((prev) => prev.filter((p) => p.key !== placement.key))
        }
      }
    },
    [canEdit, createTracked, nextZ, upload]
  )

  // ---------------------------------------------------------------------------
  // Selection actions: duplicate, copy/paste, stacking, alignment, recolour.
  //
  // Every one of these goes through createTracked or commitNode, so they land
  // on the undo stack for free and need no history handling of their own.
  // ---------------------------------------------------------------------------

  /**
   * Copy a set of nodes, offset so the copies are visibly separate.
   *
   * Returns the new ids so the caller can select them — duplicating and then
   * dragging is one gesture in every canvas tool, and it only works if what you
   * just made is what is selected.
   */
  const cloneNodes = useCallback(
    (sources: CanvasNode[], offset: number): Promise<string[]> =>
      // TRACKED, spanning the whole batch including its recordHistory.
      //
      // createTracked does this per node; dropping to createNode to get one
      // undo entry also dropped the tracking, and that is not cosmetic. An
      // untracked create means stepHistory's wait sees nothing pending, so
      // Cmd+D then Cmd+Z pops the entry BEFORE the duplicate, undoes the wrong
      // thing, and then the clone's late recordHistory lands on top and wipes
      // the redo branch. One entry AND one tracked promise is the combination
      // that is actually correct.
      trackAction(
        (async (): Promise<string[]> => {
          if (!canEdit || sources.length === 0) return []
          // One z for the whole batch to build on, so a duplicated group keeps its
          // internal stacking instead of being flattened into the order it happens
          // to be iterated in.
          const baseZ = nextZ()
          const created: string[] = []
          /** Every clone, for ONE history entry — see the push after the loop. */
          const ops: CanvasOp[] = []
          // Sequential: each create is a round trip, and firing a dozen at once
          // would put a dozen rows in flight with no ordering between them.
          for (let i = 0; i < sources.length; i += 1) {
            const source = sources[i]
            const box = clampToLimits({
              x: source.x + offset,
              y: source.y + offset,
              w: source.w,
              h: source.h,
              rotation: source.rotation,
            })
            // createNode, NOT createTracked: that records one history entry per
            // node, so duplicating a six-node group cost six Cmd+Z presses. One
            // gesture is one undo, matching delete, restack and align.
            const node = await createNode({
              type: source.type as CanvasNodeType,
              x: box.x,
              y: box.y,
              w: box.w,
              h: box.h,
              rotation: box.rotation,
              z: baseZ + i,
              // Deep-copied through JSON — props is JSONB, so it is always
              // JSON-safe. A shallow spread would leave an ink clone SHARING its
              // source's points array. Nothing mutates props in place today, which
              // makes this cheap insurance rather than a fix.
              //
              // For an image the copy points at the SAME storage object rather than
              // duplicating the file — which is what a duplicate should do, and is
              // why the cleanup script counts references rather than assuming one
              // object per node.
              props: JSON.parse(JSON.stringify(source.props)) as Record<string, unknown>,
            })
            if (node) {
              created.push(node.id)
              ops.push({ kind: 'create', node })
            }
          }
          if (ops.length > 0) recordHistory(ops)
          return created
        })()
      ),
    [canEdit, createNode, nextZ, recordHistory, trackAction]
  )

  const duplicateSelection = useCallback(async () => {
    const sources = nodesRef.current.filter((n) => selectionRef.current.includes(n.id))
    if (sources.length === 0) return
    const ids = await cloneNodes(sources, DUPLICATE_OFFSET)
    if (ids.length > 0) setSelection(ids)
  }, [cloneNodes])

  /**
   * Clipboard for copy/paste.
   *
   * A ref, not the system clipboard. Reading real clipboard data needs
   * permission and only carries text or images — a sticky's colour, a shape's
   * stroke and a node's rotation would all be lost on the way through. Within
   * one canvas this keeps everything, and the cost is that it does not cross
   * tabs, which is the trade Miro-likes make too.
   */
  const clipboardRef = useRef<CanvasNode[]>([])

  const copySelection = useCallback(() => {
    const picked = nodesRef.current.filter((n) => selectionRef.current.includes(n.id))
    if (picked.length === 0) return
    clipboardRef.current = picked.map((n) => ({ ...n, props: { ...n.props } }))
  }, [])

  const pasteClipboard = useCallback(async () => {
    const sources = clipboardRef.current
    if (sources.length === 0) return
    const ids = await cloneNodes(sources, DUPLICATE_OFFSET)
    if (ids.length > 0) setSelection(ids)
  }, [cloneNodes])

  /** Bring the selection to the front, or send it to the back. */
  const restackSelection = useCallback(
    (direction: 'front' | 'back') => {
      if (!canEdit) return
      const all = nodesRef.current
      const selected = all
        .filter((n) => selectionRef.current.includes(n.id))
        .map((n) => ({ id: n.id, z: n.z }))
      // Only the OTHERS' z values — see restackNodes. Including the selection's
      // own made every press a write.
      const otherZ = all.filter((n) => !selectionRef.current.includes(n.id)).map((n) => n.z)
      const changes = restackNodes(selected, otherZ, direction)
      if (changes.length === 0) return
      const ops: CanvasOp[] = []
      for (const change of changes) {
        const before = all.find((n) => n.id === change.id)
        if (!before) continue
        ops.push({
          kind: 'update',
          id: change.id,
          before: { z: before.z },
          after: { z: change.z },
        })
        void commitNode(change.id, { z: change.z })
      }
      // One entry for the whole restack, like a group drag.
      if (ops.length > 0) recordHistory(ops)
    },
    [canEdit, commitNode, recordHistory]
  )

  /** Line up or space out the selection. */
  const arrangeSelection = useCallback(
    (action: { align: AlignMode } | { distribute: DistributeMode }) => {
      if (!canEdit) return
      const picked = nodesRef.current.filter((n) => selectionRef.current.includes(n.id))
      const inputs = picked.map((n) => ({
        id: n.id,
        x: n.x,
        y: n.y,
        w: n.w,
        h: n.h,
        rotation: n.rotation,
      }))
      const moves =
        'align' in action
          ? alignNodes(inputs, action.align)
          : distributeNodes(inputs, action.distribute)
      if (moves.length === 0) return

      const ops: CanvasOp[] = []
      for (const move of moves) {
        const before = picked.find((n) => n.id === move.id)
        if (!before) continue
        const box = clampToLimits({ ...before, x: move.x, y: move.y })
        ops.push({
          kind: 'update',
          id: move.id,
          before: { x: before.x, y: before.y },
          after: { x: box.x, y: box.y },
        })
        void commitNode(move.id, { x: box.x, y: box.y })
      }
      if (ops.length > 0) recordHistory(ops)
    },
    [canEdit, commitNode, recordHistory]
  )

  /**
   * Apply the rail's colour to whatever is selected.
   *
   * Which PROP it lands on depends on the node: a sticky's colour is its fill,
   * a shape's is its stroke, ink and text carry their own `color`. Writing one
   * key for all of them would silently do nothing for most of the canvas.
   */
  const recolorSelection = useCallback(
    (next: string) => {
      if (!canEdit) return
      const picked = nodesRef.current.filter((n) => selectionRef.current.includes(n.id))
      if (picked.length === 0) return
      const ops: CanvasOp[] = []
      for (const node of picked) {
        // Nothing to recolour on an image, a frame or a connector: writing a
        // `color` they never read would cost a request, a broadcast and an undo
        // entry to change nothing on screen.
        if (node.type === 'image' || node.type === 'frame' || node.type === 'connector') continue
        const key = node.type === 'sticky' ? 'fill' : node.type === 'shape' ? 'stroke' : 'color'
        if ((node.props as Record<string, unknown>)[key] === next) continue
        const after = { props: { ...node.props, [key]: next } }
        ops.push({
          kind: 'update',
          id: node.id,
          before: { props: node.props },
          after,
        })
        void commitNode(node.id, after)
      }
      if (ops.length > 0) recordHistory(ops)
    },
    [canEdit, commitNode, recordHistory]
  )

  /**
   * Place a sticky or text node and open it for typing straight away.
   *
   * Awaits the create so the caret lands on the SERVER's row rather than the
   * optimistic one — the ids match (the client generates them), but the row
   * that comes back carries the resolved author name, and editing the
   * pre-response copy would write that placeholder back out.
   */
  const placeTextual = useCallback(
    async (type: 'sticky' | 'text', at: Point) => {
      // dragRef is deliberately not set for a click-to-place, so the
      // one-gesture-at-a-time guard does not cover this path — and the tool
      // stays armed until setTool runs AFTER the await. Without this latch a
      // double-click, a fast second click or a second finger lands inside the
      // round trip and places a second node. For 'text' that orphan is an
      // invisible box that still hit-tests and blocks clicks beneath it.
      if (placingRef.current) return
      placingRef.current = true
      try {
        const w = type === 'sticky' ? STICKY_SIZE : TEXT_W
        const h = type === 'sticky' ? STICKY_SIZE : TEXT_H
        const node = await createTracked({
          type,
          x: at.x - w / 2,
          y: at.y - h / 2,
          w,
          h,
          z: nextZ(),
          props:
            type === 'sticky'
              ? {
                  text: '',
                  fill: STICKY_COLORS[nodesRef.current.length % STICKY_COLORS.length],
                }
              : { text: '', color: colorRef.current },
        })
        if (node) {
          setSelection([node.id])
          setEditingNodeId(node.id)
        }
        setTool('select')
      } finally {
        placingRef.current = false
      }
    },
    [createTracked, nextZ]
  )

  // ---------------------------------------------------------------------------
  // Undo and redo.
  // ---------------------------------------------------------------------------

  /**
   * Apply one entry, and report the ops that actually landed.
   *
   * The subset matters: the opposite stack is built from what happened, not
   * from what was attempted, so a half-applied entry stays honest instead of
   * offering a redo for a write that failed or a node that no longer exists.
   *
   * Concurrent, not sequential. An entry's ops always target distinct nodes —
   * they come from one gesture over one selection — so there is no ordering to
   * preserve, and undoing a thirty-node delete should not be thirty round
   * trips end to end.
   */
  const applyOps = useCallback(
    async (entry: CanvasHistoryEntry, direction: 'undo' | 'redo'): Promise<CanvasHistoryEntry> => {
      const live = nodesRef.current
      const applied: CanvasOp[] = []
      /** Nodes this entry leaves ON the canvas, to select afterwards. */
      const present: string[] = []

      await Promise.all(
        entry.map(async (op) => {
          if (op.kind === 'update') {
            // A node a peer deleted while it sat on our stack is skipped, not
            // retried: the PATCH would 404 and raise an error banner about
            // something the user can neither see nor act on. The op is left
            // out of `applied`, so it does not reappear on the other stack.
            if (!live.some((n) => n.id === op.id)) return
            const target = direction === 'undo' ? op.before : op.after
            if (await commitNode(op.id, target)) {
              applied.push(op)
              present.push(op.id)
            }
            return
          }
          // Undoing a create removes; undoing a delete restores. Redo is the
          // same table read the other way round.
          const removing = op.kind === (direction === 'undo' ? 'create' : 'delete')
          if (removing) {
            if (await deleteNode(op.node.id)) applied.push(op)
            return
          }
          const restored = await createNode(restoreInputOf(op.node))
          if (restored) {
            applied.push(op)
            present.push(restored.id)
          }
        })
      )

      // Show what moved. Without this an undo of something scrolled off-screen
      // gives no feedback at all, and an undo of a delete leaves the restored
      // nodes unselected — so the obvious next act, dragging them back where
      // they were, needs a click first.
      //
      // Guarded on `applied`, not on `present`: an entry where every op was
      // skipped changed nothing, and clearing the selection would be the only
      // visible effect of a keypress that did nothing at all.
      if (applied.length > 0) setSelection(present)
      return applied
    },
    [commitNode, createNode, deleteNode]
  )

  const stepHistory = useCallback(
    async (direction: 'undo' | 'redo') => {
      // One at a time. Cmd+Z held down fires on key repeat, and two applies in
      // flight against the same node would race each other's writes while the
      // stacks recorded an order that never happened.
      if (applyingRef.current) return
      // Mid-gesture the drag's own `originals` map holds the truth about where
      // things were, not the stack — this drag's entry is not written until
      // pointerup. Undoing now would apply the PREVIOUS entry underneath a live
      // drag that is about to commit over the top of it. The guard lives here
      // rather than in the key handler because the rail's buttons are the other
      // way in, and on a touch surface a second finger can reach them mid-drag.
      if (dragRef.current) return
      applyingRef.current = true
      try {
        // Close any open editor. Reaching here with one open means the toolbar
        // button was used, in which case its blur has already committed — this
        // is what stops the editor being left open over a canvas that changed
        // underneath it.
        setEditingNodeId(null)
        // Let the action that produced the top entry finish first. See
        // pendingActionsRef: the wait has to come BEFORE the pop, or a create
        // still in flight would have its entry recorded on top of the one this
        // press already took.
        const pending = [...pendingActionsRef.current]
        if (pending.length > 0) await Promise.allSettled(pending)
        // Exactly ONE entry per press, even if every op in it turns out to be
        // unapplicable — a peer deleted the node it referred to, say. Walking
        // on to the next entry would make a single keypress fire an unbounded
        // number of round trips and swallow an unbounded amount of the stack,
        // which is a far worse surprise than a press that visibly does nothing
        // and leaves the next press to undo the step before.
        const entry = direction === 'undo' ? takeUndo() : takeRedo()
        if (!entry) return
        const applied = await applyOps(entry, direction)
        if (direction === 'undo') stashRedo(applied)
        else stashUndo(applied)
      } finally {
        applyingRef.current = false
      }
    },
    [applyOps, stashRedo, stashUndo, takeRedo, takeUndo]
  )

  // ---------------------------------------------------------------------------
  // Wheel: pan by default, zoom with ctrl/meta.
  //
  // Bound manually with { passive: false } because React's onWheel is registered
  // passively, and a passive listener cannot preventDefault — so the browser
  // would page-zoom on ctrl+wheel and rubber-band on trackpad scroll.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const at = screenPoint(e)
      // ctrlKey on a wheel event is how every browser reports a trackpad pinch;
      // it is not necessarily a real Control key. metaKey covers cmd+wheel.
      if (e.ctrlKey || e.metaKey) {
        setViewport((vp) => zoomAt(vp, at, wheelZoomFactor(e.deltaY, e.deltaMode)))
      } else {
        setViewport((vp) => panBy(vp, -e.deltaX, -e.deltaY))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [screenPoint])

  // ---------------------------------------------------------------------------
  // Keyboard.
  // ---------------------------------------------------------------------------
  //
  // Bound to the CONTAINER, not to window. A window listener would make this
  // component reach across the whole page the moment it is mounted: Backspace
  // anywhere outside an input would delete canvas nodes, Cmd+A would hijack
  // select-all, and preventDefault on Space would break Space-to-activate on
  // every button in the surrounding chrome. The container is focusable and
  // takes focus on pointerdown, so these fire only when the canvas is the
  // thing the user is actually working in.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Only keys aimed at the canvas ITSELF. React's onKeyDown also sees keys
      // bubbling up from descendants, so without this, Space on a focused zoom
      // button would be preventDefault-ed here — the button would stop
      // responding to Space and the canvas would enter pan mode instead.
      if (e.target !== e.currentTarget) return
      // Space pans — held, not toggled, so it can't get stuck on.
      if (e.code === 'Space' && !e.repeat) {
        setSpaceHeld(true)
        e.preventDefault()
        return
      }
      // A live tool is the first thing Escape should put down, before the
      // selection — that ordering is what every canvas app does.
      if (e.key === 'Escape' && toolRef.current !== 'select') {
        e.stopPropagation()
        setTool('select')
        draftRef.current = null
        draftLineRef.current = null
        setDraft(null)
        return
      }
      if (e.key === 'Escape') {
        // Only swallow Escape when there is a selection to clear. With nothing
        // selected it must keep bubbling — the studio page uses Escape to leave
        // follow-presenter, and deselecting a sticky should never detach you
        // from a crit you are watching.
        if (selectionRef.current.length === 0) return
        e.stopPropagation()
        setSelection([])
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && canEdit) {
        const ids = selectionRef.current
        if (ids.length === 0) return
        e.preventDefault()
        // Snapshot BEFORE the deletes go out. A delete op has to carry the
        // whole row to rebuild it later, and the moment deleteNode runs, the
        // node is gone from the list optimistically — there would be nothing
        // left to read. One entry for the whole selection, so it comes back in
        // one press rather than one per node.
        const removed = nodesRef.current.filter((n) => ids.includes(n.id))
        if (removed.length > 0)
          recordHistory(removed.map((node): CanvasOp => ({ kind: 'delete', node })))
        setSelection([])
        // Tracked so an immediate Cmd+Z waits for these to land before it
        // POSTs the same ids back — "delete, no wait, undo" is the single most
        // likely thing anyone does here.
        ids.forEach((id) => void trackAction(deleteNode(id)))
        return
      }
      // Undo and redo. Cmd/Ctrl+Z, with Shift for redo, and Ctrl+Y as well
      // because that is the redo people reach for on Windows.
      if (
        canEdit &&
        (e.metaKey || e.ctrlKey) &&
        (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')
      ) {
        e.preventDefault()
        const redo = e.key.toLowerCase() === 'y' || e.shiftKey
        void stepHistory(redo ? 'redo' : 'undo')
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        setSelection(nodesRef.current.map((n) => n.id))
        return
      }
      if (canEdit && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
        // Browsers bind Cmd+D to "bookmark this page", so this must be taken
        // before the default runs or the user gets a bookmark dialog instead.
        e.preventDefault()
        void duplicateSelection()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
        // NOT preventDefault-ed. With nothing selected this should stay the
        // browser's own copy — the canvas has text in it, and swallowing Cmd+C
        // unconditionally is how a surface breaks native copy for everything
        // else on the page.
        if (selectionRef.current.length === 0) return
        e.preventDefault()
        copySelection()
        return
      }
      if (canEdit && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') {
        if (clipboardRef.current.length === 0) return
        e.preventDefault()
        void pasteClipboard()
        return
      }
      // Stacking order, matching the bracket keys every design tool uses.
      if (canEdit && !e.metaKey && !e.ctrlKey && (e.key === ']' || e.key === '[')) {
        if (selectionRef.current.length === 0) return
        e.preventDefault()
        restackSelection(e.key === ']' ? 'front' : 'back')
        return
      }
      // Single-letter tool switches, and only without a modifier — otherwise
      // Cmd+S would put down a sticky on the way to the browser's save dialog.
      if (canEdit && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        const key = e.key.toLowerCase()
        const picked = (
          {
            v: 'select',
            s: 'sticky',
            t: 'text',
            r: 'rect',
            o: 'ellipse',
            l: 'line',
            a: 'arrow',
            p: 'ink',
          } as const
        )[key as 'v' | 's' | 't' | 'r' | 'o' | 'l' | 'a' | 'p']
        if (picked) {
          e.preventDefault()
          setTool(picked)
        }
      }
    },
    [
      canEdit,
      copySelection,
      deleteNode,
      duplicateSelection,
      pasteClipboard,
      recordHistory,
      restackSelection,
      stepHistory,
      trackAction,
    ]
  )

  const handleKeyUp = useCallback((e: React.KeyboardEvent) => {
    if (e.code === 'Space') setSpaceHeld(false)
  }, [])

  // Space-held must clear if the window loses focus mid-pan, or the canvas
  // comes back stuck in pan mode with no key left to release. Blur is the one
  // listener that genuinely belongs on window.
  useEffect(() => {
    const onBlur = () => setSpaceHeld(false)
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [])

  // ---------------------------------------------------------------------------
  // Pointer gestures.
  // ---------------------------------------------------------------------------

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      const el = containerRef.current
      if (!el) return
      // One gesture at a time. A second pointer landing mid-drag (trivial on a
      // touch surface, which this is — touchAction is 'none', so every finger
      // delivers a pointerdown) would otherwise overwrite dragRef and strand
      // the first gesture's ids: finishDrag bails on the pointerId mismatch, so
      // endGesture never runs and those nodes stay suppressed in gestureRef for
      // the life of the component, silently deaf to every future remote update.
      if (dragRef.current) return
      // Focus so the container's key handlers apply to this canvas.
      pointerFocusRef.current = true
      el.focus({ preventScroll: true })
      const screen = screenPoint(e)
      const canvas = toCanvas(viewportRef.current, screen)
      const vp = viewportRef.current

      // Middle button or space-held always pans, whatever is under the cursor.
      const wantsPan = e.button === 1 || spaceHeld
      // Capture AFTER the button test, so a right-click never takes a capture
      // that nothing will release.
      if (!wantsPan && e.button !== 0) return
      el.setPointerCapture(e.pointerId)

      if (wantsPan) {
        beginDrag({
          mode: 'pan',
          pointerId: e.pointerId,
          startScreen: screen,
          startCanvas: canvas,
          startViewport: vp,
          originals: new Map(),
          moved: false,
        })
        return
      }

      // A drawing tool takes the gesture before any hit test — with the pen
      // armed, clicking a node must draw over it, not select it.
      const activeTool = toolRef.current
      if (canEdit && activeTool !== 'select') {
        // Close any open editor first. Its blur would otherwise commit AFTER
        // the new node exists, writing the old text into whatever is selected
        // by then.
        setEditingNodeId(null)

        if (activeTool === 'sticky' || activeTool === 'text') {
          void placeTextual(activeTool, canvas)
          return
        }

        setSelection([])
        draftLineRef.current =
          activeTool === 'line' || activeTool === 'arrow' ? { from: canvas, to: canvas } : null
        const startDraft = {
          tool: activeTool,
          rect: {
            minX: canvas.x,
            minY: canvas.y,
            maxX: canvas.x,
            maxY: canvas.y,
          },
          points: activeTool === 'ink' ? [canvas] : undefined,
        }
        // Written to the ref FIRST and synchronously. finishDrag reads the ref
        // during a discrete pointerup, which can run before a continuous
        // setDraft from the last pointermove has flushed — so the ref is the
        // source of truth and the state exists only to drive the preview.
        draftRef.current = startDraft
        setDraft(startDraft)
        beginDrag({
          mode: 'create',
          pointerId: e.pointerId,
          startScreen: screen,
          startCanvas: canvas,
          startViewport: vp,
          originals: new Map(),
          moved: false,
        })
        return
      }

      const current = nodesRef.current
      const sel = selectionRef.current

      // Handles first: they sit outside the node's own rect, so testing the node
      // first would make the corner handles unreachable.
      if (canEdit && soleSelected) {
        const tol = screenToCanvasLength(vp, HANDLE_HIT_PX)
        const gap = screenToCanvasLength(vp, ROTATE_GAP_PX)
        const hit = hitHandle(soleSelected, canvas, tol, gap)
        if (hit) {
          const originals = new Map<string, NodeGeometry>([[soleSelected.id, { ...soleSelected }]])
          beginGesture([soleSelected.id])
          beginDrag({
            mode: hit === 'rotate' ? 'rotate' : 'resize',
            pointerId: e.pointerId,
            startScreen: screen,
            startCanvas: canvas,
            startViewport: vp,
            originals,
            handle: hit,
            rotateOffset: hit === 'rotate' ? rotateGrabOffset(soleSelected, canvas) : undefined,
            grabOffset:
              hit === 'rotate'
                ? undefined
                : resizeGrabOffset(soleSelected, hit as ResizeHandle, canvas),
            moved: false,
          })
          return
        }
      }

      const hitNode = topmostAt(current, canvas)

      if (!hitNode) {
        // Empty space: marquee, and clear the selection unless extending.
        if (!e.shiftKey) setSelection([])
        beginDrag({
          mode: 'marquee',
          pointerId: e.pointerId,
          startScreen: screen,
          startCanvas: canvas,
          startViewport: vp,
          originals: new Map(),
          // Shift extends: remember what was selected so the marquee adds to it
          // instead of replacing it on the first move.
          marqueeBase: e.shiftKey ? sel : [],
          moved: false,
        })
        return
      }

      // Shift toggles membership; a plain click on an already-selected node
      // keeps the whole selection so a group can be dragged as one.
      let nextSelection: string[]
      if (e.shiftKey) {
        nextSelection = sel.includes(hitNode.id)
          ? sel.filter((id) => id !== hitNode.id)
          : [...sel, hitNode.id]
      } else {
        nextSelection = sel.includes(hitNode.id) ? sel : [hitNode.id]
      }
      setSelection(nextSelection)

      if (!canEdit) return

      const originals = new Map<string, NodeGeometry>()
      current
        .filter((n) => nextSelection.includes(n.id))
        .forEach((n) => originals.set(n.id, { ...n }))
      beginGesture([...originals.keys()])
      beginDrag({
        mode: 'move',
        pointerId: e.pointerId,
        startScreen: screen,
        startCanvas: canvas,
        startViewport: vp,
        originals,
        moved: false,
      })
    },
    [beginDrag, beginGesture, canEdit, placeTextual, screenPoint, soleSelected, spaceHeld]
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current
      const screen = screenPoint(e)

      // Idle: reflect what the pointer is over. The handles live in an SVG
      // overlay with pointerEvents:'none' (so it never swallows a drag), which
      // means they can't carry their own :hover cursor — the container has to
      // do it, using the same hit test the pointerdown path uses.
      if (!drag) {
        if (toolRef.current !== 'select') return
        const vpNow = viewportRef.current
        const at = toCanvas(vpNow, screen)
        let next = 'default'
        if (canEdit && soleSelected) {
          const hit = hitHandle(
            soleSelected,
            at,
            screenToCanvasLength(vpNow, HANDLE_HIT_PX),
            screenToCanvasLength(vpNow, ROTATE_GAP_PX)
          )
          if (hit) next = handleCursor(hit, soleSelected.rotation)
        }
        if (next === 'default' && topmostAt(nodesRef.current, at))
          next = canEdit ? 'move' : 'default'
        setHoverCursor((prev) => (prev === next ? prev : next))
        return
      }
      if (drag.pointerId !== e.pointerId) return
      const dxScreen = screen.x - drag.startScreen.x
      const dyScreen = screen.y - drag.startScreen.y

      // The threshold exists to tell a sloppy click from a drag. A drawing
      // gesture has no such ambiguity — the press already committed to drawing —
      // and swallowing the first few pixels makes every stroke open with a
      // straight jump from where the pen went down.
      if (
        drag.mode !== 'create' &&
        !drag.moved &&
        Math.hypot(dxScreen, dyScreen) < DRAG_THRESHOLD_PX
      ) {
        return
      }
      drag.moved = true

      if (drag.mode === 'pan') {
        setViewport(panBy(drag.startViewport, dxScreen, dyScreen))
        return
      }

      // Canvas-space pointer, computed against the viewport as it was when the
      // gesture began. Using the live viewport would let a simultaneous zoom
      // change the delta under the drag.
      const canvas = toCanvas(drag.startViewport, screen)

      if (drag.mode === 'create') {
        const prev = draftRef.current
        if (!prev) return
        let next = prev
        if (prev.tool === 'ink') {
          const pts = prev.points ?? []
          const last = pts[pts.length - 1]
          // The minimum step is a SCREEN distance converted to canvas units, not
          // a fixed canvas distance: a fixed one filters nothing when zoomed out
          // and throws away most of the stroke when zoomed in, so the same
          // gesture draws smooth or visibly polygonal depending on zoom.
          const minStep = screenToCanvasLength(drag.startViewport, INK_MIN_STEP_PX)
          if (last && Math.hypot(canvas.x - last.x, canvas.y - last.y) < minStep) return
          if (pts.length >= INK_MAX_POINTS) return
          next = { ...prev, points: [...pts, canvas] }
        } else {
          if (draftLineRef.current) draftLineRef.current = { from: drag.startCanvas, to: canvas }
          next = { ...prev, rect: rectFromPoints(drag.startCanvas, canvas) }
        }
        draftRef.current = next
        setDraft(next)
        return
      }

      if (drag.mode === 'marquee') {
        const rect = rectFromPoints(drag.startCanvas, canvas)
        setMarquee(rect)
        const base = drag.marqueeBase ?? []
        const inRect = nodesInRect(nodesRef.current, rect).map((n) => n.id)
        setSelection([...base, ...inRect.filter((id) => !base.includes(id))])
        return
      }

      if (drag.mode === 'move') {
        const dx = canvas.x - drag.startCanvas.x
        const dy = canvas.y - drag.startCanvas.y
        drag.originals.forEach((orig, id) => {
          previewNode(id, clampToLimits({ ...orig, x: orig.x + dx, y: orig.y + dy }))
        })
        return
      }

      const orig = soleSelected ? drag.originals.get(soleSelected.id) : null
      if (!orig || !soleSelected) return

      if (drag.mode === 'resize' && drag.handle && drag.handle !== 'rotate') {
        const next = resizeNode(orig, drag.handle as ResizeHandle, canvas, {
          preserveAspect: e.shiftKey,
          fromCenter: e.altKey,
          grabOffset: drag.grabOffset,
        })
        previewNode(soleSelected.id, clampToLimits(next))
        return
      }

      if (drag.mode === 'rotate') {
        // Shift snaps to 15°, matching the wall editor's shift-to-snap idiom.
        const rotation = rotateNode(orig, canvas, drag.rotateOffset ?? 0, e.shiftKey)
        previewNode(soleSelected.id, { rotation })
      }
    },
    [canEdit, previewNode, screenPoint, soleSelected]
  )

  const finishDrag = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== e.pointerId) return
      dragRef.current = null
      setDragging(false)
      setMarquee(null)
      // releasePointerCapture throws InvalidPointerId when the pointer is no
      // longer active — precisely the pointercancel / lostpointercapture path
      // that reaches here. Letting it throw would skip the commit loop and
      // endGesture below, stranding these ids in the hook's suppression set
      // forever: the same bug this handler exists to prevent, through a
      // different door. It is the only throwing statement in this function.
      try {
        containerRef.current?.releasePointerCapture?.(e.pointerId)
      } catch {
        // Already released by the browser. Nothing to undo.
      }

      if (drag.mode === 'create') {
        const d = draftRef.current
        draftRef.current = null
        setDraft(null)
        // Read below for the diagonal before it is cleared, so a second line
        // cannot inherit the previous one's direction.
        const finishedLine = draftLineRef.current
        draftLineRef.current = null
        // The pen stays armed — drawing is repetitive, and disarming after
        // every stroke would mean re-picking it for each line. Shapes drop back
        // to select, since placing one is usually followed by adjusting it.
        if (d?.tool !== 'ink') setTool('select')
        if (!d) return

        if (d.tool === 'ink') {
          const pts = d.points ?? []
          if (pts.length < 2) return
          // The stroke's own bounding box becomes the node, padded by the stroke
          // weight on each side so the line isn't clipped at the edges by its
          // own thickness. That padding is also what guarantees a non-zero
          // extent for a perfectly straight stroke — MIN_INK_EXTENT below is
          // the belt to its braces, and the one that matters when rendering a
          // row written by some earlier version.
          // Points are stored relative to that box and the box size
          // is stored alongside them, so a later resize SCALES the stroke
          // rather than cropping it (see CanvasNodeView's viewBox).
          const pad = INK_SIZE
          const minX = Math.min(...pts.map((p) => p.x)) - pad
          const minY = Math.min(...pts.map((p) => p.y)) - pad
          const maxX = Math.max(...pts.map((p) => p.x)) + pad
          const maxY = Math.max(...pts.map((p) => p.y)) + pad
          // A perfectly straight horizontal stroke has zero height, which would
          // put a 0 in the viewBox and divide by zero when it scales.
          const bw = Math.max(MIN_INK_EXTENT, maxX - minX)
          const bh = Math.max(MIN_INK_EXTENT, maxY - minY)
          const inkBox = clampToLimits({
            x: minX,
            y: minY,
            w: bw,
            h: bh,
            rotation: 0,
          })
          void createTracked({
            type: 'ink',
            x: inkBox.x,
            y: inkBox.y,
            w: inkBox.w,
            h: inkBox.h,
            z: nextZ(),
            props: {
              points: pts.map((p) => [
                Number((p.x - minX).toFixed(2)),
                Number((p.y - minY).toFixed(2)),
              ]),
              bw,
              bh,
              color: colorRef.current,
              size: INK_SIZE,
            },
          })
          return
        }

        const r = d.rect
        if (!r) return
        const w = r.maxX - r.minX
        const h = r.maxY - r.minY
        // A click with a shape tool is a miss, not a zero-size shape.
        //
        // Lines are judged on their LENGTH rather than on both sides: a
        // perfectly horizontal line has zero height and is a completely normal
        // thing to draw, but the box test would throw it away.
        if (d.tool === 'line' || d.tool === 'arrow') {
          if (Math.hypot(w, h) < MIN_NODE_SIZE) return
        } else if (w < MIN_NODE_SIZE || h < MIN_NODE_SIZE) {
          return
        }
        const isLine = d.tool === 'line' || d.tool === 'arrow'

        // An axis-aligned line gets a real box to live in, centred on the
        // stroke, and records which axis it runs along so the renderer draws
        // through the middle instead of corner to corner. See LINE_MIN_EXTENT.
        let boxX = r.minX
        let boxY = r.minY
        let boxW = w
        let boxH = h
        let axis: 'diagonal' | 'horizontal' | 'vertical' = 'diagonal'
        if (isLine) {
          if (h < LINE_MIN_EXTENT) {
            axis = 'horizontal'
            boxY = r.minY - (LINE_MIN_EXTENT - h) / 2
            boxH = LINE_MIN_EXTENT
          } else if (w < LINE_MIN_EXTENT) {
            axis = 'vertical'
            boxX = r.minX - (LINE_MIN_EXTENT - w) / 2
            boxW = LINE_MIN_EXTENT
          }
        }

        const shapeBox = clampToLimits({
          x: boxX,
          y: boxY,
          w: boxW,
          h: boxH,
          rotation: 0,
        })
        // Which way a DIAGONAL stroke runs. A box cannot express it, so it is
        // recorded from the direction the drag actually went — see
        // NodeProps.diagonal.
        const swne = Boolean(finishedLine && finishedLine.to.y < finishedLine.from.y)
        void createTracked({
          type: 'shape',
          x: shapeBox.x,
          y: shapeBox.y,
          w: shapeBox.w,
          h: shapeBox.h,
          z: nextZ(),
          props: isLine
            ? {
                shape: d.tool,
                stroke: colorRef.current,
                size: 2,
                axis,
                diagonal: swne ? 'swne' : 'nwse',
              }
            : {
                shape: d.tool === 'ellipse' ? 'ellipse' : 'rect',
                stroke: colorRef.current,
              },
        })
        return
      }

      const ids = [...drag.originals.keys()]
      if (ids.length === 0) return

      // Commit FIRST, then release the gesture. commitNode marks the node
      // in-flight synchronously, so by the time endGesture runs the hook can
      // tell "a write is coming" from "this gesture changed nothing" — which is
      // what decides whether it reconciles now or after the write settles.
      // A press that never crossed the drag threshold was a click: it already
      // did its work by selecting, and writing an unchanged geometry would emit
      // a pointless UPDATE to every subscriber in the room.
      if (drag.moved) {
        const live = nodesRef.current
        // One entry for the whole gesture: dragging a six-node selection is
        // six writes but a single Cmd+Z.
        const ops: CanvasOp[] = []
        ids.forEach((id) => {
          const now = live.find((n) => n.id === id)
          const original = drag.originals.get(id)
          if (!now || !original) return
          const before = geometryOf(original)
          const after = geometryOf(now)
          if (!geometryChanged(before, after)) return
          ops.push({ kind: 'update', id, before, after })
          void trackAction(commitNode(id, after))
        })
        if (ops.length > 0) recordHistory(ops)
      }

      endGesture(ids)
    },
    [commitNode, createTracked, endGesture, nextZ, recordHistory, trackAction]
  )

  // ---------------------------------------------------------------------------
  // Create.
  // ---------------------------------------------------------------------------
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!canEdit) return
      // With a tool armed, pointerdown already handled this. Placing a sticky
      // here too would mean two quick clicks with the pen also drop a note.
      if (toolRef.current !== 'select') return
      const canvas = canvasPoint(e)
      const hit = topmostAt(nodesRef.current, canvas)
      if (hit) {
        // Double-click into text is the universal "edit this" gesture. Ink and
        // shapes have no text to edit, so they keep their selection instead.
        if (hit.type === 'sticky' || hit.type === 'text') {
          setSelection([hit.id])
          setEditingNodeId(hit.id)
        }
        return
      }
      void placeTextual('sticky', canvas)
    },
    [canEdit, canvasPoint, placeTextual]
  )

  // ---------------------------------------------------------------------------
  // File drop.
  //
  // Drag events are a separate stream from pointer events, so none of this
  // interacts with the gesture handling above — a file drag never produces a
  // pointerdown, and the canvas never sees it as a marquee.
  // ---------------------------------------------------------------------------

  /**
   * A file dropped just OUTSIDE the canvas must not navigate the page.
   *
   * The default browser action for a file drop is to open it, which replaces
   * the whole app with the image and tears down the room session, any
   * in-progress recording, and the undo stack. The canvas fills most of the
   * screen but not all of it — the chrome bands above and below it are live
   * targets, and a drop landing a few pixels off is an easy miss.
   *
   * preventDefault only, never stopPropagation: this listener sits at the end
   * of the bubble path, so a real drop target that handled the event has
   * already done its work. All this does is stop the browser's fallback.
   */
  useEffect(() => {
    const swallow = (e: DragEvent) => {
      if (!Array.from(e.dataTransfer?.types ?? []).includes('Files')) return
      e.preventDefault()
    }
    window.addEventListener('dragover', swallow)
    window.addEventListener('drop', swallow)
    return () => {
      window.removeEventListener('dragover', swallow)
      window.removeEventListener('drop', swallow)
    }
  }, [])

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (!canEdit || !isFileDrag(e)) return
      e.preventDefault()
      dragDepthRef.current += 1
      setDropActive(true)
    },
    [canEdit]
  )

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!canEdit || !isFileDrag(e)) return
      // Both required. Without preventDefault the browser refuses the drop and
      // navigates to the file instead, replacing the canvas with the image.
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    },
    [canEdit]
  )

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!isFileDrag(e)) return
    e.preventDefault()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setDropActive(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      if (!canEdit || !isFileDrag(e)) return
      e.preventDefault()
      dragDepthRef.current = 0
      setDropActive(false)
      const files = Array.from(e.dataTransfer.files ?? [])
      if (files.length === 0) return
      // Where the pointer actually released, so the image lands under the
      // cursor rather than at some default position.
      void placeImageFiles(files, toCanvas(viewportRef.current, screenPoint(e)))
    },
    [canEdit, placeImageFiles, screenPoint]
  )

  /** Picker fallback: places at the middle of what is currently on screen. */
  const handlePickFiles = useCallback(
    (files: File[]) => {
      const centre = toCanvas(viewportRef.current, {
        x: size.w / 2,
        y: size.h / 2,
      })
      void placeImageFiles(files, centre)
    },
    [placeImageFiles, size.h, size.w]
  )

  const zoomFit = useCallback(() => {
    const bounds = unionBounds(nodesRef.current.map(aabbOf))
    if (!bounds || size.w === 0) return
    setViewport(fitBounds(bounds, size.w, size.h))
  }, [size.h, size.w])

  const zoomBy = useCallback(
    (factor: number) => {
      const centre = { x: size.w / 2, y: size.h / 2 }
      setViewport((vp) => zoomAt(vp, centre, factor))
    },
    [size.h, size.w]
  )

  const resetZoom = useCallback(() => {
    const centre = { x: size.w / 2, y: size.h / 2 }
    setViewport((vp) => zoomTo(vp, centre, 1))
  }, [size.h, size.w])

  // ---------------------------------------------------------------------------
  // Render.
  // ---------------------------------------------------------------------------

  // A drawing tool overrides hover feedback entirely: with the pen armed, what
  // is under the pointer no longer decides what a press will do.
  const cursor = spaceHeld ? 'grab' : tool !== 'select' ? 'crosshair' : hoverCursor

  const selectionOverlay = useMemo(() => {
    if (selectedNodes.length === 0) return null
    const vp = viewport
    // cornersOf, not a local copy of the rotation maths. The outline has to
    // trace exactly what pointInNode hit-tests, and the way those two drift
    // apart is by each computing its own corners.
    const outlines = selectedNodes.map((n) => ({
      id: n.id,
      points: cornersOf(n)
        .map((p) => toScreen(vp, p))
        .map((p) => `${p.x},${p.y}`)
        .join(' '),
    }))

    const gap = screenToCanvasLength(vp, ROTATE_GAP_PX)
    const handles =
      soleSelected && canEdit
        ? allHandlePoints(soleSelected, gap).map(({ handle, point }) => ({
            handle,
            screen: toScreen(vp, point),
          }))
        : []

    // Top-centre of the whole selection, in SCREEN space, for the floating
    // action bar. Computed from the same rotated corners as the outline, so it
    // tracks a tilted node instead of hovering off its unrotated rect.
    // reduce, not Math.min(...spread): Cmd+A on a large canvas spreads four
    // arguments per node, and a few thousand nodes exceeds the argument limit.
    // unionBounds avoids the spread for the same reason.
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const node of selectedNodes) {
      for (const corner of cornersOf(node)) {
        const p = toScreen(vp, corner)
        if (p.x < minX) minX = p.x
        if (p.x > maxX) maxX = p.x
        if (p.y < minY) minY = p.y
        if (p.y > maxY) maxY = p.y
      }
    }

    // Clamped into the viewport, and flipped below the selection when there is
    // no room above. Unclamped, a selection near the top put the bar off-screen
    // and one near the left slid it under the tool rail — which renders later
    // at the same z-index, so it won and the actions became unreachable.
    const BAR_HALF_WIDTH = 150
    const BAR_CLEARANCE = 56
    const railEdge = TOOL_RAIL_RIGHT_EDGE + BAR_HALF_WIDTH
    const above = minY > BAR_CLEARANCE
    const anchor = {
      x: Math.min(
        Math.max((minX + maxX) / 2, railEdge),
        Math.max(railEdge, size.w - BAR_HALF_WIDTH)
      ),
      y: above ? minY : maxY,
      above,
    }

    return { outlines, handles, anchor }
  }, [canEdit, selectedNodes, soleSelected, size.w, viewport])

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background: ROOM.background,
        // The browser must not claim the gesture for scrolling or page zoom —
        // every pointer interaction here is ours.
        touchAction: 'none',
        cursor,
        userSelect: 'none',
        fontFamily: SANS_STACK,
        outline: keyboardFocus ? `2px solid ${ROOM.accent}` : 'none',
        outlineOffset: -2,
      }}
      tabIndex={0}
      onFocus={() => {
        setKeyboardFocus(!pointerFocusRef.current)
        pointerFocusRef.current = false
      }}
      onBlur={() => setKeyboardFocus(false)}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      // If the browser revokes the capture (an OS gesture, a context menu),
      // pointerup may never arrive. Without this the gesture would never end
      // and its nodes would stay suppressed for the life of the component.
      onLostPointerCapture={finishDrag}
      onDoubleClick={handleDoubleClick}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Grid. Painted as a background rather than as elements so it costs
          nothing per cell — an infinite canvas has an unbounded number of them.
          Offsetting by the viewport keeps it locked to canvas space. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `radial-gradient(circle, ${ROOM.hairline} 1px, transparent 1px)`,
          backgroundSize: `${canvasToScreenLength(viewport, GRID)}px ${canvasToScreenLength(viewport, GRID)}px`,
          backgroundPosition: `${viewport.tx}px ${viewport.ty}px`,
          // Below ~0.4 zoom the dots crowd into visual noise.
          opacity: viewport.zoom < 0.4 ? 0 : 1,
          transition: 'opacity 120ms ease',
          pointerEvents: 'none',
        }}
      />

      {/* Node layer: one composited transform for the whole scene. */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          transformOrigin: '0 0',
          transform: `translate(${viewport.tx}px, ${viewport.ty}px) scale(${viewport.zoom})`,
          willChange: 'transform',
        }}
      >
        {nodes.map((node) => (
          <CanvasNodeView
            key={node.id}
            node={node}
            isEditing={node.id === editingNodeId}
            onCommitText={(text) => {
              setEditingNodeId(null)
              refocus()
              const next = text.trim()
              const previous = (node.props as { text?: string }).text ?? ''
              // A text node with nothing in it is invisible but still hit-tests
              // over its whole box, silently blocking clicks on anything under
              // it. A sticky is a visible object, so an empty one is kept.
              if (!next && node.type === 'text') {
                // Undoable only when there was text to lose. Emptying a note
                // someone wrote is a destructive edit; closing a box that was
                // never typed into is not, and restoring THAT would put an
                // invisible click-swallower back on the canvas — the exact
                // thing this deletion exists to prevent.
                if (previous) recordHistory([{ kind: 'delete', node }])
                void trackAction(deleteNode(node.id))
                return
              }
              // Blur fires on every exit, including one that changed nothing.
              // Writing anyway would rebroadcast the full row to the room for a
              // click-in-click-out — the same no-op guard the geometry commit
              // makes in finishDrag.
              if (next === previous) return
              // props is replaced wholesale by the API, so the rest of it has to
              // be carried across explicitly — a sticky's fill lives there.
              const after = { props: { ...node.props, text: next } }
              recordHistory([
                {
                  kind: 'update',
                  id: node.id,
                  before: { props: node.props },
                  after,
                },
              ])
              void trackAction(commitNode(node.id, after))
            }}
            onCancelEdit={() => {
              setEditingNodeId(null)
              refocus()
            }}
          />
        ))}

        {/* The in-progress shape or stroke. Drawn in the same transformed layer
            as real nodes so it sits exactly where it will land, with no
            hand-off jump when the pointer comes up. */}
        {draft?.rect && (draft.tool === 'line' || draft.tool === 'arrow') && (
          <svg
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              overflow: 'visible',
              pointerEvents: 'none',
            }}
            width={1}
            height={1}
          >
            {/* Drawn from where the press started to where the pointer is, NOT
                corner to corner of the box — otherwise dragging up-left would
                preview a line along the wrong diagonal from the one that
                actually gets created. */}
            <line
              x1={draftLineRef.current?.from.x ?? draft.rect.minX}
              y1={draftLineRef.current?.from.y ?? draft.rect.minY}
              x2={draftLineRef.current?.to.x ?? draft.rect.maxX}
              y2={draftLineRef.current?.to.y ?? draft.rect.maxY}
              stroke={color}
              strokeWidth={2}
              strokeLinecap="round"
            />
          </svg>
        )}
        {draft?.rect && draft.tool !== 'ink' && draft.tool !== 'line' && draft.tool !== 'arrow' && (
          <div
            style={{
              position: 'absolute',
              left: draft.rect.minX,
              top: draft.rect.minY,
              width: draft.rect.maxX - draft.rect.minX,
              height: draft.rect.maxY - draft.rect.minY,
              border: `2px solid ${color}`,
              borderRadius: draft.tool === 'ellipse' ? '50%' : 4,
              pointerEvents: 'none',
            }}
          />
        )}
        {/* Uploads in flight, drawn in the transformed layer so they sit exactly
            where the image will land and pan and zoom with everything else. */}
        {pending.map((p) => (
          <div
            key={p.key}
            style={{
              position: 'absolute',
              left: p.x,
              top: p.y,
              width: p.w,
              height: p.h,
              border: `2px dashed ${ROOM.accent}`,
              borderRadius: 3,
              background: `${ROOM.accent}0D`,
              display: 'grid',
              placeItems: 'center',
              pointerEvents: 'none',
              color: ROOM.accent,
              fontSize: 13,
              fontFamily: SANS_STACK,
            }}
          >
            {p.progress > 0 ? `${Math.round(p.progress)}%` : 'Uploading…'}
          </div>
        ))}

        {draft?.tool === 'ink' && draft.points && draft.points.length > 1 && (
          <svg
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              overflow: 'visible',
              pointerEvents: 'none',
            }}
            width={1}
            height={1}
          >
            <path
              d={pathFromPoints(draft.points.map((p) => [p.x, p.y]))}
              fill="none"
              stroke={color}
              strokeWidth={INK_SIZE}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>

      {/* Screen-space overlay: outlines, handles, marquee. */}
      <svg
        width={size.w}
        height={size.h}
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          overflow: 'visible',
        }}
      >
        {selectionOverlay?.outlines.map((o) => (
          <polygon
            key={o.id}
            points={o.points}
            fill="none"
            stroke={ROOM.accent}
            strokeWidth={1.5}
          />
        ))}
        {soleSelected &&
          canEdit &&
          selectionOverlay?.handles.find((h) => h.handle === 'rotate') && (
            <line
              x1={
                toScreen(viewport, {
                  x: soleSelected.x + soleSelected.w / 2,
                  y: soleSelected.y,
                }).x
              }
              y1={
                toScreen(viewport, {
                  x: soleSelected.x + soleSelected.w / 2,
                  y: soleSelected.y,
                }).y
              }
              x2={selectionOverlay.handles.find((h) => h.handle === 'rotate')!.screen.x}
              y2={selectionOverlay.handles.find((h) => h.handle === 'rotate')!.screen.y}
              stroke={ROOM.accent}
              strokeWidth={1}
            />
          )}
        {selectionOverlay?.handles.map(({ handle, screen }) => (
          <rect
            key={handle}
            x={screen.x - HANDLE_PX / 2}
            y={screen.y - HANDLE_PX / 2}
            width={HANDLE_PX}
            height={HANDLE_PX}
            rx={handle === 'rotate' ? HANDLE_PX / 2 : 1.5}
            fill={ROOM.wall}
            stroke={ROOM.accent}
            strokeWidth={1.5}
            style={{
              cursor: handleCursor(handle, soleSelected?.rotation ?? 0),
            }}
          />
        ))}
        {marquee && (
          <rect
            x={toScreen(viewport, { x: marquee.minX, y: marquee.minY }).x}
            y={toScreen(viewport, { x: marquee.minX, y: marquee.minY }).y}
            width={canvasToScreenLength(viewport, marquee.maxX - marquee.minX)}
            height={canvasToScreenLength(viewport, marquee.maxY - marquee.minY)}
            fill={`${ROOM.accent}14`}
            stroke={ROOM.accent}
            strokeWidth={1}
            strokeDasharray="4 3"
          />
        )}
      </svg>

      {/* Drop target highlight. Drawn over everything, ignores the pointer so
          it cannot swallow the drop it is advertising. */}
      {dropActive && (
        <div
          style={{
            position: 'absolute',
            inset: 8,
            border: `2px dashed ${ROOM.accent}`,
            borderRadius: 12,
            background: `${ROOM.accent}0A`,
            pointerEvents: 'none',
            display: 'grid',
            placeItems: 'center',
            color: ROOM.accent,
            fontSize: 14,
            fontWeight: 600,
            zIndex: 3,
          }}
        >
          Drop to add to this crit
        </div>
      )}

      {/* The picker behind the rail's image button. Kept out of the toolbar so
          that component stays free of file handling. */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          // Reset first: picking the same file twice in a row fires no change
          // event otherwise, so the second attempt looks like nothing happened.
          e.target.value = ''
          if (files.length > 0) handlePickFiles(files)
        }}
      />

      {/* Contextual actions. Hidden while a gesture is running — a bar that
          follows a drag under the cursor is in the way, and its buttons would
          be moving targets. */}
      {canEdit && selectionOverlay && !marquee && !dragging && (
        <CanvasSelectionBar
          x={selectionOverlay.anchor.x}
          y={selectionOverlay.anchor.y}
          below={!selectionOverlay.anchor.above}
          count={selectedNodes.length}
          onAlign={(mode) => arrangeSelection({ align: mode })}
          onDistribute={(mode) => arrangeSelection({ distribute: mode })}
          onDuplicate={() => void duplicateSelection()}
          onRestack={restackSelection}
          onDelete={() => {
            const ids = selectionRef.current
            if (ids.length === 0) return
            const removed = nodesRef.current.filter((n) => ids.includes(n.id))
            if (removed.length > 0) {
              recordHistory(removed.map((node): CanvasOp => ({ kind: 'delete', node })))
            }
            setSelection([])
            ids.forEach((id) => void trackAction(deleteNode(id)))
          }}
        />
      )}

      <CanvasToolbar
        tool={tool}
        onToolChange={setTool}
        onPickImage={() => fileInputRef.current?.click()}
        color={color}
        onColorChange={(next) => {
          setColor(next)
          // Also restyles whatever is selected — the thing the old comment here
          // claimed happened and did not. Picking a colour with objects
          // selected means "make these that colour" in every canvas tool.
          recolorSelection(next)
        }}
        disabled={!canEdit}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={() => void stepHistory('undo')}
        onRedo={() => void stepHistory('redo')}
      />

      <ZoomBar
        zoom={viewport.zoom}
        onZoomIn={() => zoomBy(1.2)}
        onZoomOut={() => zoomBy(1 / 1.2)}
        onFit={zoomFit}
        onReset={resetZoom}
      />

      {loading && nodes.length === 0 && <Overlay text="Loading canvas…" />}
      {!loading && nodes.length === 0 && canEdit && (
        <Overlay text="Double-click anywhere to add a note" subtle />
      )}
      {(error || uploadError) && (
        <button
          onClick={() => {
            clearError()
            setUploadError(null)
          }}
          style={{
            position: 'absolute',
            left: 16,
            bottom: 16,
            padding: '8px 12px',
            borderRadius: 8,
            border: `1px solid ${ROOM.redline}`,
            background: ROOM.wall,
            color: ROOM.redline,
            fontSize: 12,
            cursor: 'pointer',
            maxWidth: 'min(420px, calc(100% - 32px))',
            textAlign: 'left',
          }}
        >
          {error || uploadError} — dismiss
        </button>
      )}
    </div>
  )
}

function Overlay({ text, subtle }: { text: string; subtle?: boolean }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        color: subtle ? ROOM.ink2 : ROOM.ink,
        fontSize: 13,
        letterSpacing: 0.2,
      }}
    >
      {text}
    </div>
  )
}

function ZoomBar({
  zoom,
  onZoomIn,
  onZoomOut,
  onFit,
  onReset,
}: {
  zoom: number
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: () => void
  onReset: () => void
}) {
  const btn: React.CSSProperties = {
    width: 30,
    height: 28,
    border: 'none',
    background: 'transparent',
    color: ROOM.ink,
    cursor: 'pointer',
    fontSize: 14,
    lineHeight: 1,
  }
  return (
    <div
      // The bar sits above the canvas and must not start a pan when clicked.
      onPointerDown={(e) => e.stopPropagation()}
      // dblclick as well as pointerdown: the canvas creates a sticky on
      // double-click, and hammering + or Fit would otherwise leave notes
      // scattered under the bar.
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        right: 16,
        bottom: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        padding: 3,
        borderRadius: 10,
        background: ROOM.wall,
        border: `1px solid ${ROOM.hairline}`,
        boxShadow: '0 2px 8px rgba(22,24,29,0.08)',
      }}
    >
      <button style={btn} onClick={onZoomOut} title="Zoom out">
        −
      </button>
      <button
        style={{ ...btn, width: 52, fontSize: 12, color: ROOM.ink2 }}
        onClick={onReset}
        title="Reset to 100%"
      >
        {Math.round(zoom * 100)}%
      </button>
      <button style={btn} onClick={onZoomIn} title="Zoom in">
        +
      </button>
      <div
        style={{
          width: 1,
          height: 18,
          background: ROOM.hairline,
          margin: '0 2px',
        }}
      />
      <button style={{ ...btn, width: 34, fontSize: 11 }} onClick={onFit} title="Zoom to fit">
        Fit
      </button>
    </div>
  )
}
