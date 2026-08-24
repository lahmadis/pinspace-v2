/**
 * Node geometry: hit-testing, selection bounds, and the transform maths behind
 * the resize and rotate handles.
 *
 * Pure functions, no React and no DOM, for the same reason as viewport.ts — the
 * pointer handlers, the renderer and the hit-test must agree exactly, and the
 * way they stop agreeing is by each keeping its own copy of the arithmetic.
 *
 * Everything here works in CANVAS space. Convert with lib/canvas/viewport.ts
 * before calling in, never after.
 *
 * Rotation is stored in RADIANS on the node and is measured clockwise, because
 * canvas +y points down: a positive angle turns x toward y, which reads as
 * clockwise on screen even though the formula is the standard counter-clockwise
 * one. Getting this backwards is invisible until someone rotates a node and the
 * handles chase it the wrong way.
 */

import { clampCoord, clampSize, type CanvasNode } from './types'
import type { Point, Bounds } from './viewport'

/** Smallest a node may be dragged, in canvas units. Prevents a zero-area node
 *  that can no longer be grabbed to fix. */
export const MIN_NODE_SIZE = 8

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
export type TransformHandle = ResizeHandle | 'rotate'

export const RESIZE_HANDLES: readonly ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface NodeGeometry extends Rect {
  rotation: number
}

/**
 * Hold a gesture's result inside the range the database will accept.
 *
 * Applied to the PREVIEW, not just the committed value, so a drag that runs
 * past the limit stops at the edge instead of letting the node follow the
 * cursor into territory the PATCH will later reject — which would show the user
 * a position, then silently snap it back when the write returns.
 */
export function clampToLimits(g: NodeGeometry): NodeGeometry {
  return {
    x: clampCoord(g.x),
    y: clampCoord(g.y),
    w: clampSize(g.w),
    h: clampSize(g.h),
    rotation: clampCoord(g.rotation),
  }
}

export function rotatePoint(p: Point, origin: Point, angle: number): Point {
  if (angle === 0) return { x: p.x, y: p.y }
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const dx = p.x - origin.x
  const dy = p.y - origin.y
  return {
    x: origin.x + dx * cos - dy * sin,
    y: origin.y + dx * sin + dy * cos,
  }
}

export function centerOf(r: Rect): Point {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 }
}

/**
 * Map a world point into a node's local (unrotated) frame.
 *
 * Rotating about the node's own centre by -rotation undoes the node's rotation,
 * so in the result the node occupies exactly x..x+w, y..y+h. Every hit-test and
 * resize below is written against that simpler frame.
 */
export function toLocal(node: NodeGeometry, p: Point): Point {
  return rotatePoint(p, centerOf(node), -node.rotation)
}

export function pointInNode(node: NodeGeometry, p: Point, padding = 0): boolean {
  const local = toLocal(node, p)
  return (
    local.x >= node.x - padding &&
    local.x <= node.x + node.w + padding &&
    local.y >= node.y - padding &&
    local.y <= node.y + node.h + padding
  )
}

/** The node's four corners in world space, clockwise from top-left. */
export function cornersOf(node: NodeGeometry): Point[] {
  const c = centerOf(node)
  const raw: Point[] = [
    { x: node.x, y: node.y },
    { x: node.x + node.w, y: node.y },
    { x: node.x + node.w, y: node.y + node.h },
    { x: node.x, y: node.y + node.h },
  ]
  return raw.map((p) => rotatePoint(p, c, node.rotation))
}

/**
 * Axis-aligned bounds of a rotated node.
 *
 * Not the same as {x, y, w, h} once rotation is non-zero — a rotated square is
 * wider than its side. Used for culling and for framing a selection, where
 * using the unrotated rect would clip the corners off.
 */
export function aabbOf(node: NodeGeometry): Bounds {
  const pts = cornersOf(node)
  return {
    minX: Math.min(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxX: Math.max(...pts.map((p) => p.x)),
    maxY: Math.max(...pts.map((p) => p.y)),
  }
}

export function unionBounds(list: Bounds[]): Bounds | null {
  if (list.length === 0) return null
  return list.reduce((acc, b) => ({
    minX: Math.min(acc.minX, b.minX),
    minY: Math.min(acc.minY, b.minY),
    maxX: Math.max(acc.maxX, b.maxX),
    maxY: Math.max(acc.maxY, b.maxY),
  }))
}

/** Local-frame position of a handle, before the node's rotation is applied. */
function localHandlePoint(node: NodeGeometry, handle: ResizeHandle): Point {
  const left = node.x
  const right = node.x + node.w
  const top = node.y
  const bottom = node.y + node.h
  const midX = node.x + node.w / 2
  const midY = node.y + node.h / 2
  switch (handle) {
    case 'nw': return { x: left, y: top }
    case 'n': return { x: midX, y: top }
    case 'ne': return { x: right, y: top }
    case 'e': return { x: right, y: midY }
    case 'se': return { x: right, y: bottom }
    case 's': return { x: midX, y: bottom }
    case 'sw': return { x: left, y: bottom }
    case 'w': return { x: left, y: midY }
  }
}

/** Distance the rotate handle sits above the top edge, in canvas units. Scaled
 *  by the caller against zoom so it stays a constant gap on screen. */
export const ROTATE_HANDLE_GAP = 24

export function handlePoint(node: NodeGeometry, handle: TransformHandle, rotateGap = ROTATE_HANDLE_GAP): Point {
  const c = centerOf(node)
  if (handle === 'rotate') {
    return rotatePoint({ x: c.x, y: node.y - rotateGap }, c, node.rotation)
  }
  return rotatePoint(localHandlePoint(node, handle), c, node.rotation)
}

export function allHandlePoints(
  node: NodeGeometry,
  rotateGap = ROTATE_HANDLE_GAP
): Array<{ handle: TransformHandle; point: Point }> {
  const handles: TransformHandle[] = [...RESIZE_HANDLES, 'rotate']
  return handles.map((handle) => ({ handle, point: handlePoint(node, handle, rotateGap) }))
}

/** Which handle, if any, is under a point. `tolerance` is in canvas units, so
 *  callers divide their pixel hit-slop by the current zoom. */
export function hitHandle(
  node: NodeGeometry,
  p: Point,
  tolerance: number,
  rotateGap = ROTATE_HANDLE_GAP
): TransformHandle | null {
  let best: TransformHandle | null = null
  let bestDist = tolerance
  for (const { handle, point } of allHandlePoints(node, rotateGap)) {
    const d = Math.hypot(point.x - p.x, point.y - p.y)
    // <= so an exact tie prefers the later handle in the list, which puts
    // 'rotate' ahead of the corner it overlaps at small sizes.
    if (d <= bestDist) {
      best = handle
      bestDist = d
    }
  }
  return best
}

/**
 * Resize a node by dragging one handle.
 *
 * Worked entirely in the node's local frame, then mapped back. The subtlety is
 * the last step: the local→world map is "rotate about the OLD centre by
 * +rotation", and it must stay the old centre even though the node's centre
 * moves during the resize. Rotating about the new centre instead makes the
 * anchored edge drift away under the cursor on any rotated node — the classic
 * symptom being that resizing a rotated box also slides it.
 *
 * `fromCenter` (alt/option) resizes about the centre instead of the opposite
 * edge. `preserveAspect` (shift) locks the original ratio.
 */
export interface ResizeOptions {
  preserveAspect?: boolean
  fromCenter?: boolean
  /**
   * Where inside the handle the pointer grabbed it, in the node's LOCAL frame.
   *
   * Without this the dragged edge snaps onto the pointer on the first move, so
   * grabbing a handle anywhere but dead centre jumps the edge by the offset —
   * and since a drag only begins after DRAG_THRESHOLD_PX of travel, every
   * resize starts with a visible jump. rotateNode has always taken the
   * equivalent angular offset; this is the missing half of that pair.
   */
  grabOffset?: Point
}

/** The offset to feed back into resizeNode for the rest of a drag. */
export function resizeGrabOffset(node: NodeGeometry, handle: ResizeHandle, pointer: Point): Point {
  const local = toLocal(node, pointer)
  const hp = localHandlePoint(node, handle)
  return { x: local.x - hp.x, y: local.y - hp.y }
}

export function resizeNode(
  node: NodeGeometry,
  handle: ResizeHandle,
  pointer: Point,
  opts: ResizeOptions = {}
): NodeGeometry {
  const oldCenter = centerOf(node)
  const raw = toLocal(node, pointer)
  const off = opts.grabOffset ?? { x: 0, y: 0 }
  const local = { x: raw.x - off.x, y: raw.y - off.y }

  // The edges that do NOT move are the anchors, and they are read from the
  // node as it was at grab time — never from the working values below, which
  // the aspect and minimum-size passes are about to change.
  const fixedLeft = node.x
  const fixedRight = node.x + node.w
  const fixedTop = node.y
  const fixedBottom = node.y + node.h
  const cx = node.x + node.w / 2
  const cy = node.y + node.h / 2

  let left = fixedLeft
  let right = fixedRight
  let top = fixedTop
  let bottom = fixedBottom

  const movesLeft = handle === 'nw' || handle === 'w' || handle === 'sw'
  const movesRight = handle === 'ne' || handle === 'e' || handle === 'se'
  const movesTop = handle === 'nw' || handle === 'n' || handle === 'ne'
  const movesBottom = handle === 'sw' || handle === 's' || handle === 'se'

  if (movesLeft) left = local.x
  if (movesRight) right = local.x
  if (movesTop) top = local.y
  if (movesBottom) bottom = local.y

  if (opts.fromCenter) {
    // Mirror the dragged edge about the centre so both sides move together.
    if (movesLeft) right = cx + (cx - left)
    if (movesRight) left = cx - (right - cx)
    if (movesTop) bottom = cy + (cy - top)
    if (movesBottom) top = cy - (bottom - cy)
  }

  // Did the pointer cross the anchored edge? Tracked before the size passes,
  // because they discard the sign.
  const flippedX = movesLeft ? left > right : movesRight ? right < left : false
  const flippedY = movesTop ? top > bottom : movesBottom ? bottom < top : false

  let newW = Math.abs(right - left)
  let newH = Math.abs(bottom - top)

  if (opts.preserveAspect && node.w > 0 && node.h > 0) {
    const ratio = node.w / node.h
    const horizontal = movesLeft || movesRight
    const vertical = movesTop || movesBottom
    if (horizontal && vertical) {
      // A corner fits the ratio to whichever axis the pointer stretched more.
      if (newW / newH > ratio) newW = newH * ratio
      else newH = newW / ratio
    } else if (horizontal) {
      newH = newW / ratio
    } else {
      newW = newH * ratio
    }
  }

  newW = Math.max(MIN_NODE_SIZE, newW)
  newH = Math.max(MIN_NODE_SIZE, newH)

  // Re-apply the ratio after the clamp. Clamping each axis independently is
  // what breaks an aspect lock on an extreme ratio — a 100x10 node dragged
  // small hits the floor on height long before width, and would come out
  // square-ish. Scaling both axes up from whichever one the clamp raised keeps
  // the lock true and can only grow the node, so it cannot re-cross the floor.
  if (opts.preserveAspect && node.w > 0 && node.h > 0) {
    const ratio = node.w / node.h
    if (newW / newH > ratio) newH = newW / ratio
    else newW = newH * ratio
  }

  // Anchoring happens LAST, after every pass that can change the size.
  //
  // Deriving the position from the final size against a fixed edge is what
  // makes the minimum-size clamp and the aspect lock behave: computing
  // newLeft from the raw pointer first and clamping the size afterwards let
  // the anchored edge slide by up to MIN_NODE_SIZE, and made an aspect-locked
  // flip land mirrored on the wrong side of the anchor entirely.
  //
  // When neither horizontal edge moves, the aspect pass may still have changed
  // the width; growing it about the centre is the only symmetric choice, and
  // reduces to the original x when the width is unchanged.
  let newLeft: number
  if (opts.fromCenter || (!movesLeft && !movesRight)) newLeft = cx - newW / 2
  else if (movesLeft) newLeft = flippedX ? fixedRight : fixedRight - newW
  else newLeft = flippedX ? fixedLeft - newW : fixedLeft

  let newTop: number
  if (opts.fromCenter || (!movesTop && !movesBottom)) newTop = cy - newH / 2
  else if (movesTop) newTop = flippedY ? fixedBottom : fixedBottom - newH
  else newTop = flippedY ? fixedTop - newH : fixedTop

  // Map the new local centre back through the ORIGINAL rotation origin.
  const newLocalCenter = { x: newLeft + newW / 2, y: newTop + newH / 2 }
  const newWorldCenter = rotatePoint(newLocalCenter, oldCenter, node.rotation)

  return {
    x: newWorldCenter.x - newW / 2,
    y: newWorldCenter.y - newH / 2,
    w: newW,
    h: newH,
    rotation: node.rotation,
  }
}

/** Snap increment for shift-rotate, matching the wall editor's 90° shift-snap
 *  in spirit but finer, since canvas objects are rotated for emphasis. */
export const ROTATE_SNAP = Math.PI / 12 // 15°

/**
 * Angle for a rotate-handle drag.
 *
 * `grabOffset` is the angle between the pointer and the node's rotation at the
 * moment the drag started; subtracting it stops the node jumping to put the
 * handle under the cursor on the first move.
 */
export function rotateNode(
  node: NodeGeometry,
  pointer: Point,
  grabOffset: number,
  snap = false
): number {
  const c = centerOf(node)
  const raw = Math.atan2(pointer.y - c.y, pointer.x - c.x) - grabOffset
  return snap ? Math.round(raw / ROTATE_SNAP) * ROTATE_SNAP : raw
}

/** The offset to pass back into rotateNode for the rest of a drag. */
export function rotateGrabOffset(node: NodeGeometry, pointer: Point): number {
  const c = centerOf(node)
  return Math.atan2(pointer.y - c.y, pointer.x - c.x) - node.rotation
}

/**
 * Topmost node under a point.
 *
 * Iterates in reverse because the array is in paint order — later nodes are
 * drawn on top, so the last match is what the user sees and therefore what they
 * mean to click.
 */
export function topmostAt(nodes: CanvasNode[], p: Point, padding = 0): CanvasNode | null {
  for (let i = nodes.length - 1; i >= 0; i--) {
    if (pointInNode(nodes[i], p, padding)) return nodes[i]
  }
  return null
}

/** Nodes whose axis-aligned bounds intersect a marquee rectangle. */
export function nodesInRect(nodes: CanvasNode[], rect: Bounds): CanvasNode[] {
  return nodes.filter((n) => {
    const b = aabbOf(n)
    return b.minX < rect.maxX && b.maxX > rect.minX && b.minY < rect.maxY && b.maxY > rect.minY
  })
}

/** Normalise a drag into a positive-area rectangle, whichever way it was drawn. */
export function rectFromPoints(a: Point, b: Point): Bounds {
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  }
}

/** CSS cursor for a handle, accounting for the node's rotation — a rotated
 *  box's "nw" corner may point north-east on screen. */
export function handleCursor(handle: TransformHandle, rotation: number): string {
  if (handle === 'rotate') return 'grab'
  const base: Record<ResizeHandle, number> = {
    n: 0, ne: 45, e: 90, se: 135, s: 180, sw: 225, w: 270, nw: 315,
  }
  // Normalised into [0, 360) with a double modulo: rotation is never wrapped
  // (rotateNode returns a raw atan2 result and it accumulates across drags), so
  // a single `+ 360` is not enough for a sufficiently negative angle — the
  // index would go negative and yield the CSS string "undefined-resize", which
  // the browser silently ignores, leaving a stale cursor.
  const deg = ((((base[handle] + (rotation * 180) / Math.PI) % 360) + 360) % 360)
  const names = ['ns', 'nesw', 'ew', 'nwse']
  // 8 sectors of 45° map onto 4 bidirectional cursors.
  return `${names[Math.round(deg / 45) % 4]}-resize`
}
