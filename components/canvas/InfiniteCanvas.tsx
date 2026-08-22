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
import CanvasToolbar, { INK_COLORS, type CanvasTool } from './CanvasToolbar'
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
  const [draft, setDraft] = useState<{ tool: CanvasTool; rect?: Bounds; points?: Point[] } | null>(null)
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

  const dragRef = useRef<DragState | null>(null)
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
  const draftRef = useRef<{ tool: CanvasTool; rect?: Bounds; points?: Point[] } | null>(null)
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
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) }
  }, [])

  const canvasPoint = useCallback(
    (e: { clientX: number; clientY: number }): Point => toCanvas(viewportRef.current, screenPoint(e)),
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
  const nextZ = useCallback(() => nodesRef.current.reduce((max, n) => Math.max(max, n.z), 0) + 1, [])

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
              ? { text: '', fill: STICKY_COLORS[nodesRef.current.length % STICKY_COLORS.length] }
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
        if (removed.length > 0) recordHistory(removed.map((node): CanvasOp => ({ kind: 'delete', node })))
        setSelection([])
        // Tracked so an immediate Cmd+Z waits for these to land before it
        // POSTs the same ids back — "delete, no wait, undo" is the single most
        // likely thing anyone does here.
        ids.forEach((id) => void trackAction(deleteNode(id)))
        return
      }
      // Undo and redo. Cmd/Ctrl+Z, with Shift for redo, and Ctrl+Y as well
      // because that is the redo people reach for on Windows.
      if (canEdit && (e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) {
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
      // Single-letter tool switches, and only without a modifier — otherwise
      // Cmd+S would put down a sticky on the way to the browser's save dialog.
      if (canEdit && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        const key = e.key.toLowerCase()
        const picked = ({ v: 'select', s: 'sticky', t: 'text', r: 'rect', o: 'ellipse', p: 'ink' } as const)[
          key as 'v' | 's' | 't' | 'r' | 'o' | 'p'
        ]
        if (picked) {
          e.preventDefault()
          setTool(picked)
        }
      }
    },
    [canEdit, deleteNode, recordHistory, stepHistory, trackAction]
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
        dragRef.current = {
          mode: 'pan',
          pointerId: e.pointerId,
          startScreen: screen,
          startCanvas: canvas,
          startViewport: vp,
          originals: new Map(),
          moved: false,
        }
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
        const startDraft = {
          tool: activeTool,
          rect: { minX: canvas.x, minY: canvas.y, maxX: canvas.x, maxY: canvas.y },
          points: activeTool === 'ink' ? [canvas] : undefined,
        }
        // Written to the ref FIRST and synchronously. finishDrag reads the ref
        // during a discrete pointerup, which can run before a continuous
        // setDraft from the last pointermove has flushed — so the ref is the
        // source of truth and the state exists only to drive the preview.
        draftRef.current = startDraft
        setDraft(startDraft)
        dragRef.current = {
          mode: 'create',
          pointerId: e.pointerId,
          startScreen: screen,
          startCanvas: canvas,
          startViewport: vp,
          originals: new Map(),
          moved: false,
        }
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
          dragRef.current = {
            mode: hit === 'rotate' ? 'rotate' : 'resize',
            pointerId: e.pointerId,
            startScreen: screen,
            startCanvas: canvas,
            startViewport: vp,
            originals,
            handle: hit,
            rotateOffset: hit === 'rotate' ? rotateGrabOffset(soleSelected, canvas) : undefined,
            grabOffset:
              hit === 'rotate' ? undefined : resizeGrabOffset(soleSelected, hit as ResizeHandle, canvas),
            moved: false,
          }
          return
        }
      }

      const hitNode = topmostAt(current, canvas)

      if (!hitNode) {
        // Empty space: marquee, and clear the selection unless extending.
        if (!e.shiftKey) setSelection([])
        dragRef.current = {
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
        }
        return
      }

      // Shift toggles membership; a plain click on an already-selected node
      // keeps the whole selection so a group can be dragged as one.
      let nextSelection: string[]
      if (e.shiftKey) {
        nextSelection = sel.includes(hitNode.id) ? sel.filter((id) => id !== hitNode.id) : [...sel, hitNode.id]
      } else {
        nextSelection = sel.includes(hitNode.id) ? sel : [hitNode.id]
      }
      setSelection(nextSelection)

      if (!canEdit) return

      const originals = new Map<string, NodeGeometry>()
      current.filter((n) => nextSelection.includes(n.id)).forEach((n) => originals.set(n.id, { ...n }))
      beginGesture([...originals.keys()])
      dragRef.current = {
        mode: 'move',
        pointerId: e.pointerId,
        startScreen: screen,
        startCanvas: canvas,
        startViewport: vp,
        originals,
        moved: false,
      }
    },
    [beginGesture, canEdit, placeTextual, screenPoint, soleSelected, spaceHeld]
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
        if (next === 'default' && topmostAt(nodesRef.current, at)) next = canEdit ? 'move' : 'default'
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
      if (drag.mode !== 'create' && !drag.moved && Math.hypot(dxScreen, dyScreen) < DRAG_THRESHOLD_PX) {
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
          const inkBox = clampToLimits({ x: minX, y: minY, w: bw, h: bh, rotation: 0 })
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
        if (w < MIN_NODE_SIZE || h < MIN_NODE_SIZE) return
        const shapeBox = clampToLimits({ x: r.minX, y: r.minY, w, h, rotation: 0 })
        void createTracked({
          type: 'shape',
          x: shapeBox.x,
          y: shapeBox.y,
          w: shapeBox.w,
          h: shapeBox.h,
          z: nextZ(),
          props: { shape: d.tool === 'ellipse' ? 'ellipse' : 'rect', stroke: colorRef.current },
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

    return { outlines, handles }
  }, [canEdit, selectedNodes, soleSelected, viewport])

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
              recordHistory([{ kind: 'update', id: node.id, before: { props: node.props }, after }])
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
        {draft?.rect && draft.tool !== 'ink' && (
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
        {draft?.tool === 'ink' && draft.points && draft.points.length > 1 && (
          <svg
            style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}
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
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}
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
        {soleSelected && canEdit && selectionOverlay?.handles.find((h) => h.handle === 'rotate') && (
          <line
            x1={toScreen(viewport, { x: soleSelected.x + soleSelected.w / 2, y: soleSelected.y }).x}
            y1={toScreen(viewport, { x: soleSelected.x + soleSelected.w / 2, y: soleSelected.y }).y}
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
            style={{ cursor: handleCursor(handle, soleSelected?.rotation ?? 0) }}
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

      <CanvasToolbar
        tool={tool}
        onToolChange={setTool}
        color={color}
        onColorChange={setColor}
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
      {error && (
        <button
          onClick={clearError}
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
          }}
        >
          {error} — dismiss
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
      <button style={btn} onClick={onZoomOut} title="Zoom out">−</button>
      <button
        style={{ ...btn, width: 52, fontSize: 12, color: ROOM.ink2 }}
        onClick={onReset}
        title="Reset to 100%"
      >
        {Math.round(zoom * 100)}%
      </button>
      <button style={btn} onClick={onZoomIn} title="Zoom in">+</button>
      <div style={{ width: 1, height: 18, background: ROOM.hairline, margin: '0 2px' }} />
      <button style={{ ...btn, width: 34, fontSize: 11 }} onClick={onFit} title="Zoom to fit">
        Fit
      </button>
    </div>
  )
}
