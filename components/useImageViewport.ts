'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Zoom/pan + image-rect measurement for a single <img> displayed object-contain
 * inside a container. Foundation for anchored callouts (Phase A.3) and the fix
 * for the missing lightbox zoom.
 *
 * Coordinate spaces:
 *  - "container point" = pixels relative to the container element's top-left.
 *    The mapping functions return / accept container points, so any overlay
 *    that consumes them must be positioned over the SAME container element.
 *  - "image fraction" = 0..1 of the image's intrinsic (natural) dimensions,
 *    resolution-independent and stable across zoom/pan. fx=0,fy=0 is the
 *    image's top-left; fx=1,fy=1 its bottom-right.
 *
 * The base painted rect (the image at scale 1) is computed analytically from
 * the natural size + container size using the same "contain, never upscale"
 * rule that `max-w-full max-h-full object-contain` produces — so the mapping
 * functions stay pure (derived from measured base + current scale/offset),
 * never reading the DOM per call.
 *
 * ROTATION: the mapping is rotation-aware. imageFractionToContainerPoint and its
 * inverse compose the board's rotation about the image center, in the SAME order
 * as the CSS `translate() scale() rotate()` (transform-origin center) the caller
 * applies to the <img>. Pass the board rotation (radians) as the second argument;
 * it defaults to 0, and the unrotated path is byte-for-byte the previous math.
 * Zoom/pan stay correct under rotation: uniform zoom about a screen point and pan
 * (a pure translate of offset) both commute with the fixed image-center rotation.
 */

interface Rect { left: number; top: number; width: number; height: number }
interface Point { x: number; y: number }

const MIN_SCALE = 1
const DEFAULT_MAX_SCALE = 8

export interface ImageViewport {
  /** Callback ref for the zoom/pan container (the element events attach to). */
  containerRef: (node: HTMLDivElement | null) => void
  /** Ref for the <img>. */
  imgRef: React.RefObject<HTMLImageElement>
  scale: number
  offsetX: number
  offsetY: number
  isZoomed: boolean
  /** True while panning/pinching — caller disables the CSS transition then. */
  isInteracting: boolean
  /** Always-current scale, for handlers that must not re-subscribe on zoom. */
  scaleRef: React.MutableRefObject<number>
  onImageLoad: (e: React.SyntheticEvent<HTMLImageElement>) => void
  reset: () => void
  onPointerDown: (e: React.PointerEvent) => void
  onPointerMove: (e: React.PointerEvent) => void
  onPointerUp: (e: React.PointerEvent) => void
  onPointerCancel: (e: React.PointerEvent) => void
  onDoubleClick: (e: React.MouseEvent) => void
  /** image fraction (0..1) → container point, at the current transform. */
  imageFractionToContainerPoint: (fx: number, fy: number) => Point | null
  /** container point → image fraction (0..1), at the current transform. */
  containerPointToImageFraction: (px: number, py: number) => Point | null
  /** Phase B.3.1: current viewport as { z=scale, cx,cy=fraction at container center }, or null if unmeasured. */
  getViewportFraction: () => { z: number; cx: number; cy: number } | null
  /** Phase B.3.1: drive the viewport so fraction (cx,cy) sits at the container center at scale z. */
  applyViewportFraction: (z: number, cx: number, cy: number) => void
  /** Phase B.3.1: enable/disable local zoom/pan input (followers disable while driven). */
  setInteractionEnabled: (enabled: boolean) => void
}

export function useImageViewport(
  maxScale: number = DEFAULT_MAX_SCALE,
  rotationRad: number = 0,
): ImageViewport {
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 })
  const [isInteracting, setIsInteracting] = useState(false)

  const imgRef = useRef<HTMLImageElement>(null)
  const containerElRef = useRef<HTMLDivElement | null>(null)
  const naturalRef = useRef<{ w: number; h: number } | null>(null)
  const baseRef = useRef<Rect | null>(null)          // painted rect at scale 1, container-local
  const viewRef = useRef({ scale: 1, x: 0, y: 0 })   // mirror of scale/offset for imperative handlers
  const scaleRef = useRef(1)
  // Board rotation (radians) mirrored into a ref so the mapping callbacks below
  // read the current value without taking it as a dep — their identity must stay
  // stable (redrawTraces and others close over them).
  const rotationRef = useRef(rotationRad)
  useEffect(() => { rotationRef.current = rotationRad }, [rotationRad])
  // Phase B.3.1: when false, all local zoom/pan input is ignored. Set false on a
  // follower while their lightbox viewport is driven by the presenter; the
  // viewport is then moved only via applyViewportFraction (below).
  const interactionEnabledRef = useRef(true)

  const pointersRef = useRef<Map<number, Point>>(new Map())
  const panLastRef = useRef<Point | null>(null)
  const pinchRef = useRef<{ startDist: number; startScale: number } | null>(null)

  const wheelListenerRef = useRef<((e: WheelEvent) => void) | null>(null)
  const roRef = useRef<ResizeObserver | null>(null)

  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

  // Base painted rect: contain-fit within the container, never upscaled — the
  // exact box `max-w-full max-h-full` with auto dims yields at scale 1.
  const measureBase = useCallback(() => {
    const el = containerElRef.current
    const nat = naturalRef.current
    if (!el || !nat || nat.w <= 0 || nat.h <= 0) { baseRef.current = null; return }
    const cw = el.clientWidth
    const ch = el.clientHeight
    if (cw <= 0 || ch <= 0) { baseRef.current = null; return }
    const fit = Math.min(cw / nat.w, ch / nat.h, 1)
    const w = nat.w * fit
    const h = nat.h * fit
    baseRef.current = { left: (cw - w) / 2, top: (ch - h) / 2, width: w, height: h }
  }, [])

  // Keep the image overlapping the container: when scaled larger than the
  // container on an axis, clamp so its edges can't reveal empty space; when
  // smaller, center it. Prevents dragging the image fully off-screen.
  const constrain = useCallback((s: number, x: number, y: number): Point => {
    const base = baseRef.current
    const el = containerElRef.current
    if (!base || !el) return { x, y }
    const cw = el.clientWidth
    const ch = el.clientHeight
    const w = base.width * s
    const h = base.height * s
    const cx = base.left + base.width / 2   // base center (≈ container center)
    const cy = base.top + base.height / 2
    let centerX = cx + x
    let centerY = cy + y
    if (w <= cw) centerX = cw / 2
    else centerX = clamp(centerX, cw - w / 2, w / 2)
    if (h <= ch) centerY = ch / 2
    else centerY = clamp(centerY, ch - h / 2, h / 2)
    return { x: centerX - cx, y: centerY - cy }
  }, [])

  const applyView = useCallback((nextScaleRaw: number, ox: number, oy: number) => {
    let s = clamp(nextScaleRaw, MIN_SCALE, maxScale)
    let x = ox
    let y = oy
    if (s <= MIN_SCALE + 1e-4) { s = MIN_SCALE; x = 0; y = 0 }    // fit: always centered
    else { const c = constrain(s, x, y); x = c.x; y = c.y }
    viewRef.current = { scale: s, x, y }
    scaleRef.current = s
    setScale(s)
    setOffset({ x, y })
  }, [constrain, maxScale])

  // Zoom to `nextScale` while keeping the image point under (px,py) fixed.
  const zoomAtPoint = useCallback((nextScaleRaw: number, px: number, py: number) => {
    const base = baseRef.current
    if (!base) return
    const { scale: s, x: ox, y: oy } = viewRef.current
    const cx = base.left + base.width / 2
    const cy = base.top + base.height / 2
    const Cx = cx + ox
    const Cy = cy + oy
    const nextScale = clamp(nextScaleRaw, MIN_SCALE, maxScale)
    // fraction of the base painted rect currently under the cursor
    const fx = (px - Cx) / (base.width * s) + 0.5
    const fy = (py - Cy) / (base.height * s) + 0.5
    // new center so that same fraction stays under (px,py)
    const Cx2 = px - (fx - 0.5) * base.width * nextScale
    const Cy2 = py - (fy - 0.5) * base.height * nextScale
    applyView(nextScale, Cx2 - cx, Cy2 - cy)
  }, [applyView, maxScale])

  const toContainerPoint = (clientX: number, clientY: number): Point | null => {
    const el = containerElRef.current
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: clientX - r.left, y: clientY - r.top }
  }

  // Wheel = scroll-zoom (no modifier) and trackpad pinch (ctrlKey). Attached as
  // a native non-passive listener so preventDefault actually stops page scroll
  // (React's synthetic onWheel is passive).
  const handleWheel = useCallback((e: WheelEvent) => {
    if (!baseRef.current || !interactionEnabledRef.current) return
    e.preventDefault()
    const p = toContainerPoint(e.clientX, e.clientY)
    if (!p) return
    const intensity = e.ctrlKey ? 0.02 : 0.005
    const factor = Math.exp(-e.deltaY * intensity)
    zoomAtPoint(viewRef.current.scale * factor, p.x, p.y)
  }, [zoomAtPoint])

  const wheelDispatch = useRef<(e: WheelEvent) => void>(() => {})
  useEffect(() => { wheelDispatch.current = handleWheel }, [handleWheel])

  const containerRef = useCallback((node: HTMLDivElement | null) => {
    // Detach from any previous node first.
    if (containerElRef.current && wheelListenerRef.current) {
      containerElRef.current.removeEventListener('wheel', wheelListenerRef.current)
    }
    if (roRef.current) { roRef.current.disconnect(); roRef.current = null }
    containerElRef.current = node
    wheelListenerRef.current = null

    if (node) {
      const listener = (e: WheelEvent) => wheelDispatch.current(e)
      wheelListenerRef.current = listener
      node.addEventListener('wheel', listener, { passive: false })
      if (typeof ResizeObserver !== 'undefined') {
        roRef.current = new ResizeObserver(() => {
          measureBase()
          const v = viewRef.current
          applyView(v.scale, v.x, v.y)   // re-constrain to the new container size
        })
        roRef.current.observe(node)
      }
      measureBase()
    }
  }, [measureBase, applyView])

  const onImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      naturalRef.current = { w: img.naturalWidth, h: img.naturalHeight }
      measureBase()
      const v = viewRef.current
      applyView(v.scale, v.x, v.y)
    }
  }, [measureBase, applyView])

  const reset = useCallback(() => { applyView(1, 0, 0) }, [applyView])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (!baseRef.current || !interactionEnabledRef.current) return
    const p = toContainerPoint(e.clientX, e.clientY)
    if (!p) return
    pointersRef.current.set(e.pointerId, p)

    if (pointersRef.current.size === 2) {
      const pts = Array.from(pointersRef.current.values())
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
      pinchRef.current = { startDist: dist || 1, startScale: viewRef.current.scale }
      panLastRef.current = null
      setIsInteracting(true)
      try { (e.target as Element).setPointerCapture(e.pointerId) } catch { /* noop */ }
    } else if (pointersRef.current.size === 1 && viewRef.current.scale > 1) {
      panLastRef.current = p
      setIsInteracting(true)
      try { (e.target as Element).setPointerCapture(e.pointerId) } catch { /* noop */ }
    }
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!interactionEnabledRef.current) return
    if (!pointersRef.current.has(e.pointerId)) return
    const p = toContainerPoint(e.clientX, e.clientY)
    if (!p) return
    pointersRef.current.set(e.pointerId, p)

    if (pointersRef.current.size === 2 && pinchRef.current) {
      const pts = Array.from(pointersRef.current.values())
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }
      const next = pinchRef.current.startScale * (dist / pinchRef.current.startDist)
      zoomAtPoint(next, mid.x, mid.y)
    } else if (pointersRef.current.size === 1 && panLastRef.current && viewRef.current.scale > 1) {
      const dx = p.x - panLastRef.current.x
      const dy = p.y - panLastRef.current.y
      panLastRef.current = p
      applyView(viewRef.current.scale, viewRef.current.x + dx, viewRef.current.y + dy)
    }
  }, [zoomAtPoint, applyView])

  const endPointer = useCallback((e: React.PointerEvent) => {
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.delete(e.pointerId)
      try { (e.target as Element).releasePointerCapture(e.pointerId) } catch { /* noop */ }
    }
    if (pointersRef.current.size < 2) pinchRef.current = null
    if (pointersRef.current.size === 1) {
      // pinch → single-finger: re-baseline pan to the remaining pointer
      const remaining = Array.from(pointersRef.current.values())[0]
      panLastRef.current = viewRef.current.scale > 1 ? remaining : null
    }
    if (pointersRef.current.size === 0) {
      panLastRef.current = null
      setIsInteracting(false)
    }
  }, [])

  const onDoubleClick = useCallback((e: React.MouseEvent) => {
    if (!baseRef.current || !interactionEnabledRef.current) return
    const p = toContainerPoint(e.clientX, e.clientY)
    if (!p) return
    if (viewRef.current.scale > 1) reset()
    else zoomAtPoint(2, p.x, p.y)
  }, [reset, zoomAtPoint])

  const imageFractionToContainerPoint = useCallback((fx: number, fy: number): Point | null => {
    const base = baseRef.current
    if (!base) return null
    const { scale: s, x, y } = viewRef.current
    const cx = base.left + base.width / 2 + x
    const cy = base.top + base.height / 2 + y
    // Local offset from the image center at scale 1, then rotate → scale → the
    // pan-translated center. This matches the CSS `translate() scale() rotate()`
    // (transform-origin center); uniform scale commutes with rotation, so scaling
    // after the rotation is equivalent to the CSS S·R order.
    const rot = rotationRef.current
    const vx = (fx - 0.5) * base.width
    const vy = (fy - 0.5) * base.height
    if (!rot) return { x: cx + vx * s, y: cy + vy * s }
    const cos = Math.cos(rot)
    const sin = Math.sin(rot)
    const rx = vx * cos - vy * sin
    const ry = vx * sin + vy * cos
    return { x: cx + rx * s, y: cy + ry * s }
  }, [])

  const containerPointToImageFraction = useCallback((px: number, py: number): Point | null => {
    const base = baseRef.current
    if (!base) return null
    const { scale: s, x, y } = viewRef.current
    const cx = base.left + base.width / 2 + x
    const cy = base.top + base.height / 2 + y
    // Exact inverse of imageFractionToContainerPoint: undo translate + scale, then
    // the inverse rotation about the image center. This is the PLACEMENT path (new
    // callout pins / trace points), so it must stay the precise inverse or points
    // land off where the user clicked on a rotated board.
    const rot = rotationRef.current
    const dx = (px - cx) / s
    const dy = (py - cy) / s
    let vx = dx
    let vy = dy
    if (rot) {
      const cos = Math.cos(rot)
      const sin = Math.sin(rot)
      vx = dx * cos + dy * sin
      vy = -dx * sin + dy * cos
    }
    return { x: vx / base.width + 0.5, y: vy / base.height + 0.5 }
  }, [])

  // Phase B.3.1: express/consume the viewport in a resolution-independent way for
  // presenter→follower sync. `z` = scale (relative to the contain-fit base, so it
  // means the same "zoomed in 2x" on any container size); `cx,cy` = the image
  // fraction (0..1) currently under the container center. Followers reproduce the
  // same framing regardless of their own container dimensions.
  const getViewportFraction = useCallback((): { z: number; cx: number; cy: number } | null => {
    const el = containerElRef.current
    const base = baseRef.current
    if (!el || !base) return null
    const cw = el.clientWidth
    const ch = el.clientHeight
    if (cw <= 0 || ch <= 0 || base.width <= 0 || base.height <= 0) return null
    const { scale: s, x, y } = viewRef.current
    const cx0 = base.left + base.width / 2 + x
    const cy0 = base.top + base.height / 2 + y
    return {
      z: s,
      cx: (cw / 2 - cx0) / (base.width * s) + 0.5,
      cy: (ch / 2 - cy0) / (base.height * s) + 0.5,
    }
  }, [])

  // Inverse of getViewportFraction: place image fraction (cx,cy) at the container
  // center at scale z. Routes through applyView so the result is clamped +
  // constrained exactly like local interaction.
  const applyViewportFraction = useCallback((z: number, cx: number, cy: number) => {
    const el = containerElRef.current
    const base = baseRef.current
    if (!el || !base) return
    const cw = el.clientWidth
    const ch = el.clientHeight
    const s = clamp(z, MIN_SCALE, maxScale)
    const x = cw / 2 - (base.left + base.width / 2) - (cx - 0.5) * base.width * s
    const y = ch / 2 - (base.top + base.height / 2) - (cy - 0.5) * base.height * s
    applyView(s, x, y)
  }, [applyView, maxScale])

  const setInteractionEnabled = useCallback((enabled: boolean) => {
    interactionEnabledRef.current = enabled
  }, [])

  // Belt-and-suspenders teardown on unmount. The callback ref also detaches
  // both of these when React passes null, but mirror it here so the wheel
  // listener and observer are guaranteed released.
  useEffect(() => {
    return () => {
      if (roRef.current) { roRef.current.disconnect(); roRef.current = null }
      if (containerElRef.current && wheelListenerRef.current) {
        containerElRef.current.removeEventListener('wheel', wheelListenerRef.current)
        wheelListenerRef.current = null
      }
    }
  }, [])

  return {
    containerRef,
    imgRef,
    scale,
    offsetX: offset.x,
    offsetY: offset.y,
    isZoomed: scale > MIN_SCALE + 1e-3,
    isInteracting,
    scaleRef,
    onImageLoad,
    reset,
    onPointerDown,
    onPointerMove,
    onPointerUp: endPointer,
    onPointerCancel: endPointer,
    onDoubleClick,
    imageFractionToContainerPoint,
    containerPointToImageFraction,
    getViewportFraction,
    applyViewportFraction,
    setInteractionEnabled,
  }
}
