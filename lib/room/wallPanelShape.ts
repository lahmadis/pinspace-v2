import * as THREE from 'three'

/**
 * Corner radius on a wall's FREE vertical edges, in inches.
 *
 * Deliberately tiny against a 96in x 120in panel — at the distance the room is
 * viewed from this is a softened arris, not a rounded rectangle. Bigger reads
 * as a foam-core mockup rather than a built partition.
 *
 * Only free ends get it. A radius where two walls MEET opens a notch at eye
 * level, which is why every corner was square before; see wallFreeEnds.
 */
export const WALL_END_RADIUS = 3

/** Segments per corner arc. Two is enough to kill the highlight on a 3in arc. */
export const WALL_END_RADIUS_SEGMENTS = 2

/**
 * The wall's silhouette: a rectangle with a radius on whichever vertical edges
 * are free, centred on the origin in local XY.
 *
 * Shared rather than written twice because EVERY surface stacked on a wall has
 * to use this outline, not just the slab. The pick planes did not, and that was
 * a visible bug: WallSurface draws a full-size plane at z = ±3.01 with
 * opacity 0.01, which is invisible where it sits over the white wall — but once
 * the slab's corners were rounded, the plane's still-square corner hung past
 * the wall's silhouette onto the pale background, front and back overlapping,
 * and read as a faint grey sharp corner tracing the shape the wall used to be.
 */
export function wallPanelShape(
  width: number,
  height: number,
  roundPlusX: boolean,
  roundMinusX: boolean,
): THREE.Shape {
  const hw = width / 2
  const hh = height / 2
  // Never let the radius eat more than a fifth of the smaller dimension — a
  // 12in-wide sliver wall would otherwise come out as a lozenge.
  const r = Math.min(WALL_END_RADIUS, width / 5, height / 5)
  const rp = roundPlusX ? r : 0
  const rm = roundMinusX ? r : 0

  const shape = new THREE.Shape()
  shape.moveTo(-hw + rm, -hh)
  shape.lineTo(hw - rp, -hh)
  if (rp > 0) shape.quadraticCurveTo(hw, -hh, hw, -hh + rp)
  shape.lineTo(hw, hh - rp)
  if (rp > 0) shape.quadraticCurveTo(hw, hh, hw - rp, hh)
  shape.lineTo(-hw + rm, hh)
  if (rm > 0) shape.quadraticCurveTo(-hw, hh, -hw, hh - rm)
  shape.lineTo(-hw, -hh + rm)
  if (rm > 0) shape.quadraticCurveTo(-hw, -hh, -hw + rm, -hh)
  return shape
}
