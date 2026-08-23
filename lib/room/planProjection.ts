/**
 * The one world↔screen mapping for every top-down plan of a space.
 *
 * There used to be two, and they disagreed: the read-only Plan view mapped world
 * +Z DOWN the screen, while the wall editor mapped it UP (`maxZ - z`), so the
 * same room was drawn mirrored in the two surfaces. Each was self-consistent —
 * the editor negates its pointer deltas to match — so neither looked broken on
 * its own, and the disagreement only became visible when the two had to share a
 * canvas.
 *
 * Convention here is +Z down the screen, which matches how the room reads from
 * its own default 3D camera: that camera sits in the +X/+Z quadrant looking back
 * toward the origin, so +Z is the near edge, and "near the viewer" belongs at the
 * bottom of a plan. Screen +Y is down in SVG, so this is also the mapping with no
 * sign flips in it.
 *
 * Anything that converts pointer movement back to world units MUST go through
 * `toWorld`/`scale` rather than hand-rolling the inverse — a hardcoded sign is
 * exactly how the two conventions drifted apart in the first place.
 *
 * 1 world unit = 1 inch, matching lib/wallLayout.ts.
 */

export interface PlanBoundsLike {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export interface PlanProjection {
  /** Screen pixels per world inch. Uniform, so plan grid cells stay square. */
  scale: number
  /** World inches per screen pixel — the factor drag handlers need. */
  invScale: number
  /** World (x, z) → screen (px, py). */
  toPx: (x: number, z: number) => [number, number]
  /** Screen (px, py) → world (x, z). */
  toWorld: (px: number, py: number) => [number, number]
  /** Size of the drawn room on screen, for centring chrome against it. */
  usedWidth: number
  usedHeight: number
  offsetX: number
  offsetY: number
}

/**
 * Fit `bounds` into a `viewWidth × viewHeight` canvas with `padding` on every
 * side, centred, preserving aspect ratio.
 */
export function makePlanProjection(
  bounds: PlanBoundsLike,
  viewWidth: number,
  viewHeight: number,
  padding: number,
): PlanProjection {
  const worldWidth = bounds.maxX - bounds.minX
  const worldDepth = bounds.maxZ - bounds.minZ
  const sx = (viewWidth - 2 * padding) / (worldWidth || 1)
  const sz = (viewHeight - 2 * padding) / (worldDepth || 1)
  const scale = Math.min(sx, sz) || 1

  const usedWidth = worldWidth * scale
  const usedHeight = worldDepth * scale
  const offsetX = (viewWidth - usedWidth) / 2
  const offsetY = (viewHeight - usedHeight) / 2

  return {
    scale,
    invScale: 1 / scale,
    usedWidth,
    usedHeight,
    offsetX,
    offsetY,
    toPx: (x, z) => [offsetX + (x - bounds.minX) * scale, offsetY + (z - bounds.minZ) * scale],
    toWorld: (px, py) => [
      bounds.minX + (px - offsetX) / scale,
      bounds.minZ + (py - offsetY) / scale,
    ],
  }
}
