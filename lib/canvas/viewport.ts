/**
 * The canvas viewport — the mapping between infinite canvas space and the
 * pixels on screen.
 *
 * Pure math, no React and no side effects, so the same functions serve the
 * pointer handlers, the render pass, hit-testing and any future minimap. Every
 * "why is the thing under my cursor drifting" bug in a pan/zoom surface comes
 * from two call sites doing this arithmetic slightly differently, so there is
 * exactly one copy of it.
 *
 * Convention: screen = canvas * zoom + t. So `t` is where canvas-space origin
 * lands in screen pixels, and `zoom` is pixels per canvas unit. Canvas +y is
 * DOWN, matching screen +y — the canvas is a drawing surface, not a floor plan,
 * so there is no handedness flip here (unlike lib/room/planProjection.ts, which
 * deliberately maps +Z down the screen).
 *
 * Screen coordinates are relative to the canvas element's top-left, NOT the
 * page — callers converting from a PointerEvent must subtract the element's
 * bounding rect first.
 */

export interface Viewport {
  /** Screen-pixel position of canvas-space origin. */
  tx: number
  ty: number
  /** Screen pixels per canvas unit. */
  zoom: number
}

export interface Point {
  x: number
  y: number
}

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/**
 * Zoom limits.
 *
 * The floor is not arbitrary: below roughly 1% the canvas stops being legible
 * and it becomes very easy to lose your work off-screen with no way back. The
 * ceiling covers zooming in to redline a detail without letting a trackpad
 * pinch run away into a divide-by-near-zero.
 */
export const MIN_ZOOM = 0.02
export const MAX_ZOOM = 32

export const IDENTITY_VIEWPORT: Viewport = { tx: 0, ty: 0, zoom: 1 }

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

export function toScreen(vp: Viewport, p: Point): Point {
  return { x: p.x * vp.zoom + vp.tx, y: p.y * vp.zoom + vp.ty }
}

export function toCanvas(vp: Viewport, p: Point): Point {
  return { x: (p.x - vp.tx) / vp.zoom, y: (p.y - vp.ty) / vp.zoom }
}

/** Scalar length conversions, for stroke widths and hit tolerances. */
export function screenToCanvasLength(vp: Viewport, px: number): number {
  return px / vp.zoom
}

export function canvasToScreenLength(vp: Viewport, units: number): number {
  return units * vp.zoom
}

/** Pan by a screen-pixel delta — drag distance is already in screen units. */
export function panBy(vp: Viewport, dxScreen: number, dyScreen: number): Viewport {
  return { ...vp, tx: vp.tx + dxScreen, ty: vp.ty + dyScreen }
}

/**
 * Zoom about a fixed screen point, so the canvas point under the cursor stays
 * under the cursor.
 *
 * The clamp is applied to the zoom BEFORE solving for the translation, not
 * after. Clamping afterwards is the classic version of this bug: at the zoom
 * limit the factor is silently reduced but the translation still assumes the
 * requested factor, so the canvas creeps sideways every time the user keeps
 * scrolling against the stop.
 */
export function zoomAt(vp: Viewport, anchorScreen: Point, factor: number): Viewport {
  const zoom = clampZoom(vp.zoom * factor)
  // Solve toCanvas(next, anchor) === toCanvas(vp, anchor) for the translation.
  const anchorCanvas = toCanvas(vp, anchorScreen)
  return {
    zoom,
    tx: anchorScreen.x - anchorCanvas.x * zoom,
    ty: anchorScreen.y - anchorCanvas.y * zoom,
  }
}

/** Set an absolute zoom level about a screen anchor (for zoom buttons / 100%). */
export function zoomTo(vp: Viewport, anchorScreen: Point, zoom: number): Viewport {
  return zoomAt(vp, anchorScreen, clampZoom(zoom) / vp.zoom)
}

/**
 * Frame a region of canvas space in a viewport of the given pixel size.
 *
 * Used by "zoom to fit", "zoom to selection" and the initial load. Degenerate
 * bounds — a single node, or an empty canvas — would divide by zero, so a zero
 * extent falls back to centring at the current zoom rather than producing an
 * Infinity that propagates into every subsequent transform.
 */
export function fitBounds(
  bounds: Bounds,
  viewWidth: number,
  viewHeight: number,
  padding = 64,
  fallbackZoom = 1
): Viewport {
  const width = bounds.maxX - bounds.minX
  const height = bounds.maxY - bounds.minY
  const availableW = Math.max(1, viewWidth - padding * 2)
  const availableH = Math.max(1, viewHeight - padding * 2)

  const zoom =
    width > 0 && height > 0
      ? clampZoom(Math.min(availableW / width, availableH / height))
      : clampZoom(fallbackZoom)

  // Centre the region: put its midpoint at the midpoint of the viewport.
  const cx = (bounds.minX + bounds.maxX) / 2
  const cy = (bounds.minY + bounds.maxY) / 2
  return {
    zoom,
    tx: viewWidth / 2 - cx * zoom,
    ty: viewHeight / 2 - cy * zoom,
  }
}

/** The canvas-space rectangle currently visible — for culling offscreen nodes. */
export function visibleBounds(vp: Viewport, viewWidth: number, viewHeight: number): Bounds {
  const topLeft = toCanvas(vp, { x: 0, y: 0 })
  const bottomRight = toCanvas(vp, { x: viewWidth, y: viewHeight })
  return {
    minX: topLeft.x,
    minY: topLeft.y,
    maxX: bottomRight.x,
    maxY: bottomRight.y,
  }
}

/** Union of node rectangles, or null for an empty set. */
export function boundsOf(rects: Array<{ x: number; y: number; w: number; h: number }>): Bounds | null {
  if (rects.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const r of rects) {
    if (r.x < minX) minX = r.x
    if (r.y < minY) minY = r.y
    if (r.x + r.w > maxX) maxX = r.x + r.w
    if (r.y + r.h > maxY) maxY = r.y + r.h
  }
  return { minX, minY, maxX, maxY }
}

/**
 * Wheel events are not zoom events — the same gesture arrives three ways.
 *
 * A trackpad pinch arrives as a wheel event with ctrlKey set (this is a browser
 * convention, not a real Control key, and it is how every canvas app tells pinch
 * from scroll). A two-finger trackpad scroll arrives as a plain wheel with both
 * deltaX and deltaY. A mouse wheel arrives as deltaY in coarse notches.
 *
 * deltaMode is respected because Firefox reports lines (1) or pages (2) rather
 * than pixels (0); treating a line count as a pixel count makes Firefox scroll
 * about a fortieth as fast as Chrome.
 */
const LINE_HEIGHT_PX = 16
const PAGE_HEIGHT_PX = 800

export function normaliseWheelDelta(deltaY: number, deltaMode: number): number {
  if (deltaMode === 1) return deltaY * LINE_HEIGHT_PX
  if (deltaMode === 2) return deltaY * PAGE_HEIGHT_PX
  return deltaY
}

/** Wheel delta to a multiplicative zoom factor. Exponential so each notch is
 *  the same proportional step regardless of current zoom. */
export function wheelZoomFactor(deltaY: number, deltaMode = 0): number {
  return Math.exp(-normaliseWheelDelta(deltaY, deltaMode) * 0.002)
}
