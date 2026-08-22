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
import { useCanvasNodes } from '@/hooks/useCanvasNodes'
import type { CanvasNode } from '@/lib/canvas/types'

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
const STICKY_COLORS = ['#FFE8A3', '#FFD5C2', '#D6E4FF', '#D9F2E3', '#EADCF8']

type DragMode = 'pan' | 'move' | 'resize' | 'rotate' | 'marquee'

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

  const containerRef = useRef<HTMLDivElement | null>(null)
  const [viewport, setViewport] = useState<Viewport>(IDENTITY_VIEWPORT)
  const [selection, setSelection] = useState<string[]>([])
  const [marquee, setMarquee] = useState<Bounds | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [spaceHeld, setSpaceHeld] = useState(false)
  /** Draw a focus ring only when focus arrived from the keyboard. The container
   *  is focusable for its key handlers, so suppressing the ring outright would
   *  leave keyboard users with no indication of where they are. */
  const [keyboardFocus, setKeyboardFocus] = useState(false)
  const pointerFocusRef = useRef(false)
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
      if (e.key === 'Escape') {
        setSelection([])
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && canEdit) {
        const ids = selectionRef.current
        if (ids.length === 0) return
        e.preventDefault()
        setSelection([])
        ids.forEach((id) => void deleteNode(id))
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        setSelection(nodesRef.current.map((n) => n.id))
      }
    },
    [canEdit, deleteNode]
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
    [beginGesture, canEdit, screenPoint, soleSelected, spaceHeld]
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

      if (!drag.moved && Math.hypot(dxScreen, dyScreen) < DRAG_THRESHOLD_PX) return
      drag.moved = true

      if (drag.mode === 'pan') {
        setViewport(panBy(drag.startViewport, dxScreen, dyScreen))
        return
      }

      // Canvas-space pointer, computed against the viewport as it was when the
      // gesture began. Using the live viewport would let a simultaneous zoom
      // change the delta under the drag.
      const canvas = toCanvas(drag.startViewport, screen)

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
        ids.forEach((id) => {
          const now = live.find((n) => n.id === id)
          const before = drag.originals.get(id)
          if (!now || !before) return
          if (
            now.x === before.x &&
            now.y === before.y &&
            now.w === before.w &&
            now.h === before.h &&
            now.rotation === before.rotation
          ) {
            return
          }
          void commitNode(id, { x: now.x, y: now.y, w: now.w, h: now.h, rotation: now.rotation })
        })
      }

      endGesture(ids)
    },
    [commitNode, endGesture]
  )

  // ---------------------------------------------------------------------------
  // Create.
  // ---------------------------------------------------------------------------
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!canEdit) return
      const canvas = canvasPoint(e)
      if (topmostAt(nodesRef.current, canvas)) return
      const topZ = nodesRef.current.reduce((max, n) => Math.max(max, n.z), 0)
      void createNode({
        type: 'sticky',
        x: canvas.x - STICKY_SIZE / 2,
        y: canvas.y - STICKY_SIZE / 2,
        w: STICKY_SIZE,
        h: STICKY_SIZE,
        z: topZ + 1,
        props: {
          text: '',
          color: STICKY_COLORS[nodesRef.current.length % STICKY_COLORS.length],
        },
      })
    },
    [canEdit, canvasPoint, createNode]
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

  const cursor = spaceHeld ? 'grab' : hoverCursor

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
          <NodeView key={node.id} node={node} />
        ))}
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

/**
 * One node.
 *
 * Positioned in CANVAS units inside the transformed layer, so nothing here
 * knows about zoom. Rotation is applied about the centre to match the geometry
 * module's convention — any other transform-origin would make hit-testing and
 * rendering disagree the moment a node is rotated.
 */
function NodeView({ node }: { node: CanvasNode }) {
  const props = node.props as { text?: string; color?: string }
  const isSticky = node.type === 'sticky'

  return (
    <div
      style={{
        position: 'absolute',
        left: node.x,
        top: node.y,
        width: node.w,
        height: node.h,
        transform: `rotate(${node.rotation}rad)`,
        transformOrigin: 'center center',
        background: isSticky ? props.color || STICKY_COLORS[0] : ROOM.wall,
        border: isSticky ? 'none' : `1px solid ${ROOM.hairline}`,
        borderRadius: isSticky ? 2 : 4,
        boxShadow: isSticky ? '0 1px 3px rgba(22,24,29,0.12)' : 'none',
        padding: 12,
        overflow: 'hidden',
        color: ROOM.ink,
        fontSize: 15,
        lineHeight: 1.35,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {props.text || (
        <span style={{ color: ROOM.ink2 }}>{node.type === 'sticky' ? '' : node.type}</span>
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
