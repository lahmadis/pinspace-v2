/**
 * Smart-guide snapping math for the 2D wall editor.
 *
 * Pure functions — no React, no Three. Lifted out of DraggableBoard so the move
 * gesture and the corner-resize gesture share one implementation instead of
 * forking into two copies that drift.
 *
 * All coordinates are wall-local INCHES with the origin at the wall center,
 * matching DraggableBoard's `localPosition * scaledWall*` math.
 */

/**
 * Soft-snap threshold in wall-local inches. While dragging, if any of the
 * dragged board's three vertical lines (left edge, center, right edge) is
 * within this distance of a target's three vertical lines — or the equivalent
 * on the horizontal axis — the board snaps to that exact alignment and a
 * Miro-style guide line is drawn. Outside the threshold the drag is fully
 * free / continuous.
 *
 * Deliberately in inches, not screen pixels: OrbitControls is disabled while a
 * wall is being edited (StudioRoom's `enabled={editingWall === null}`), so
 * there is no zoom during the gesture and a constant inch threshold is already
 * a constant pixel threshold.
 */
export const GUIDE_SNAP_THRESHOLD_IN = 2

/**
 * How close two lines must land, after snapping, to count as "on the same
 * line" and draw a guide. Tighter than the snap threshold so we don't draw
 * guides for alignments that are merely nearby.
 */
export const GUIDE_COINCIDENCE_TOLERANCE_IN = 0.25

/**
 * A rectangle the dragged board can align to. Boards on the same wall + side
 * are targets; so is the wall itself, expressed as a rectangle centered at the
 * wall origin — its three X lines are then left edge / center / right edge,
 * which is exactly the wall snapping we want.
 */
export interface SnapTarget {
  id: string
  centerInchesX: number
  centerInchesY: number
  widthInches: number
  heightInches: number
}

export interface ActiveGuides {
  vertical: number[]
  horizontal: number[]
}

/** Sentinel id for the wall-as-snap-target. Never collides with a board id. */
export const WALL_SNAP_TARGET_ID = '__wall__'

/**
 * The wall itself as a snap target: a rectangle centered on the wall origin,
 * so its three lines per axis are left edge / center / right edge (and bottom /
 * center / top). Both gestures use this — keep it one definition so the two
 * cannot drift into disagreeing about where the wall's center is.
 */
export function wallSnapTarget(wallWidthInches: number, wallHeightInches: number): SnapTarget {
  return {
    id: WALL_SNAP_TARGET_ID,
    centerInchesX: 0,
    centerInchesY: 0,
    widthInches: wallWidthInches,
    heightInches: wallHeightInches,
  }
}

/**
 * Edge alignment treats a board's edges as axis-aligned lines in wall space,
 * which only holds at 0° and 180° (at 180° the half-extents are unchanged). At
 * 90°/270° the board's width runs along the wall's Y axis, so the half-extents
 * would have to swap — the move gesture has never handled that either, so
 * rather than invent rotation-aware alignment lines we suppress edge alignment
 * on rotated boards. Size matching is unaffected: width and height are
 * intrinsic to the board, not spatial.
 */
export const ROTATION_SNAP_EPSILON_DEG = 0.5

/** True when a board's edges are axis-aligned in wall space (0° or 180°). */
export function isAxisAlignedForSnap(rotationRad: number): boolean {
  const deg = ((rotationRad * 180) / Math.PI) % 360
  const norm = deg > 180 ? deg - 360 : deg < -180 ? deg + 360 : deg
  const a = Math.abs(norm)
  return a < ROTATION_SNAP_EPSILON_DEG || Math.abs(a - 180) < ROTATION_SNAP_EPSILON_DEG
}

/**
 * Half-extents of a board's axis-aligned bounding box in wall space, for ANY
 * rotation.
 *
 * The snapping above sidesteps rotation by suppressing edge alignment on
 * rotated boards (see isAxisAlignedForSnap) — a drag can simply decline to
 * offer a guide. Align and distribute cannot: silently skipping the rotated
 * board in a selection is worse than moving it, so they need extents that are
 * actually correct off-axis. A 40x20 board turned 90° occupies 20x40 of wall,
 * and using its unrotated half-width to place its left edge is out by 10".
 *
 * Standard AABB of a rotated rectangle:
 *   halfW' = |cos t| * halfW + |sin t| * halfH
 *   halfH' = |sin t| * halfW + |cos t| * halfH
 * Exact at every angle, and it collapses to (halfW, halfH) at 0° / 180°, so
 * callers need no special case for the common orientation.
 *
 * NOT used by snapCenter or snapEdges — those keep their existing behaviour
 * deliberately. This exists so align/distribute can share one definition of a
 * board's footprint instead of re-deriving extent math.
 */
export function rotatedHalfExtents(
  widthInches: number,
  heightInches: number,
  rotationRad: number
): { halfWidth: number; halfHeight: number } {
  const halfW = widthInches / 2
  const halfH = heightInches / 2
  const c = Math.abs(Math.cos(rotationRad))
  const s = Math.abs(Math.sin(rotationRad))
  return {
    halfWidth: c * halfW + s * halfH,
    halfHeight: s * halfW + c * halfH,
  }
}

/**
 * The axis-aligned bounding box a board occupies in wall-local inches.
 *
 * Convenience over rotatedHalfExtents for callers that want edges rather than
 * extents — align works in edges (left/right/top/bottom), distribute works in
 * gaps between them.
 */
export function boardBounds(target: SnapTarget, rotationRad = 0): {
  left: number
  right: number
  top: number
  bottom: number
  centerX: number
  centerY: number
  halfWidth: number
  halfHeight: number
} {
  const { halfWidth, halfHeight } = rotatedHalfExtents(
    target.widthInches,
    target.heightInches,
    rotationRad
  )
  return {
    left: target.centerInchesX - halfWidth,
    right: target.centerInchesX + halfWidth,
    bottom: target.centerInchesY - halfHeight,
    top: target.centerInchesY + halfHeight,
    centerX: target.centerInchesX,
    centerY: target.centerInchesY,
    halfWidth,
    halfHeight,
  }
}

/**
 * A board whose width or height the resized board has matched exactly. Matching
 * size is not a spatial alignment, so this draws no guide line — the caller
 * outlines the matched board instead.
 */
export interface SizeMatch {
  targetId: string
  axis: 'width' | 'height'
  valueIn: number
}

interface AxisCandidate {
  /** Snapped size on this axis, absolute inches. */
  size: number
  /** How far the size had to move to get there. */
  distance: number
}

/** The three alignment lines a rectangle contributes on one axis. */
function linesFor(center: number, half: number): [number, number, number] {
  return [center - half, center, center + half]
}

/** Guide coordinates are rounded before de-duplication so two targets that
 *  land on the same line produce one guide, not two hairline-apart ones. */
function guideKey(v: number): number {
  return Math.round(v * 100) / 100
}

/**
 * Move-gesture snap: shift a board's CENTER onto the nearest target alignment
 * on each axis independently, then report every line the board now coincides
 * with so a guide can be drawn for each.
 *
 * `targets` is a parameter rather than a fixed set so the caller decides what
 * is snappable — the move gesture and the resize gesture pass different lists.
 */
export function snapCenter(params: {
  centerX: number
  centerY: number
  halfWidth: number
  halfHeight: number
  targets: ReadonlyArray<SnapTarget>
  /** The dragged board's own id, skipped so it never snaps to itself. */
  excludeId: string
}): { centerX: number; centerY: number; guides: ActiveGuides } {
  const { halfWidth, halfHeight, targets, excludeId } = params
  let centerX = params.centerX
  let centerY = params.centerY

  // Pass 1 — closest alignment within threshold, per axis.
  let bestXDelta = 0
  let bestXDeltaAbs = GUIDE_SNAP_THRESHOLD_IN
  let bestYDelta = 0
  let bestYDeltaAbs = GUIDE_SNAP_THRESHOLD_IN

  for (const target of targets) {
    if (target.id === excludeId) continue
    const ohw = target.widthInches / 2
    const ohh = target.heightInches / 2
    const dragXLines = linesFor(centerX, halfWidth)
    const otherXLines = linesFor(target.centerInchesX, ohw)
    for (const dx of dragXLines) {
      for (const ox of otherXLines) {
        const delta = ox - dx
        const absD = Math.abs(delta)
        if (absD < bestXDeltaAbs) {
          bestXDeltaAbs = absD
          bestXDelta = delta
        }
      }
    }
    const dragYLines = linesFor(centerY, halfHeight)
    const otherYLines = linesFor(target.centerInchesY, ohh)
    for (const dy of dragYLines) {
      for (const oy of otherYLines) {
        const delta = oy - dy
        const absD = Math.abs(delta)
        if (absD < bestYDeltaAbs) {
          bestYDeltaAbs = absD
          bestYDelta = delta
        }
      }
    }
  }

  centerX += bestXDelta
  centerY += bestYDelta

  // Pass 2 — after snapping, re-scan to find EVERY active alignment (several
  // targets may align simultaneously).
  const verticalSet = new Set<number>()
  const horizontalSet = new Set<number>()
  if (targets.length > 0) {
    const dragXLines = linesFor(centerX, halfWidth)
    const dragYLines = linesFor(centerY, halfHeight)
    for (const target of targets) {
      if (target.id === excludeId) continue
      const ohw = target.widthInches / 2
      const ohh = target.heightInches / 2
      const otherXLines = linesFor(target.centerInchesX, ohw)
      const otherYLines = linesFor(target.centerInchesY, ohh)
      for (const dx of dragXLines) {
        for (const ox of otherXLines) {
          if (Math.abs(dx - ox) < GUIDE_COINCIDENCE_TOLERANCE_IN) verticalSet.add(guideKey(ox))
        }
      }
      for (const dy of dragYLines) {
        for (const oy of otherYLines) {
          if (Math.abs(dy - oy) < GUIDE_COINCIDENCE_TOLERANCE_IN) horizontalSet.add(guideKey(oy))
        }
      }
    }
  }

  return {
    centerX,
    centerY,
    guides: { vertical: Array.from(verticalSet), horizontal: Array.from(horizontalSet) },
  }
}

/**
 * Best snap for ONE axis of a corner resize, in size space.
 *
 * Two candidate sources compete:
 *   - edge alignment: the moving edge lands on a target's edge or center line,
 *     which implies a size of `(line - anchor) * dir`
 *   - size match: the board's dimension equals a target's dimension
 *
 * The smaller correction wins. Ties go to edge alignment, which is considered
 * first and only displaced by a strictly smaller distance — spatial alignment
 * is the more visually obvious of the two.
 *
 * Candidates outside [minSize, maxSize] are rejected rather than clamped, so a
 * snap can never collapse a board below the floor or silently land somewhere
 * other than where its guide says.
 */
function bestAxisCandidate(params: {
  size: number
  anchor: number
  dir: number
  minSize: number
  maxSize: number
  alignTargets: ReadonlyArray<SnapTarget>
  sizeTargets: ReadonlyArray<SnapTarget>
  excludeId: string
  allowEdgeAlign: boolean
  axis: 'width' | 'height'
}): AxisCandidate | null {
  const { size, anchor, dir, minSize, maxSize, excludeId, allowEdgeAlign, axis } = params
  let best: AxisCandidate | null = null

  const consider = (candidateSize: number) => {
    if (!Number.isFinite(candidateSize)) return
    if (candidateSize < minSize || candidateSize > maxSize) return
    const distance = Math.abs(candidateSize - size)
    if (distance >= GUIDE_SNAP_THRESHOLD_IN) return
    if (best && distance >= best.distance) return
    best = { size: candidateSize, distance }
  }

  if (allowEdgeAlign) {
    for (const t of params.alignTargets) {
      if (t.id === excludeId) continue
      const center = axis === 'width' ? t.centerInchesX : t.centerInchesY
      const half = (axis === 'width' ? t.widthInches : t.heightInches) / 2
      for (const line of linesFor(center, half)) {
        // The moving edge sits at `anchor + dir * size`; landing it on `line`
        // means the size becomes (line - anchor) * dir.
        consider((line - anchor) * dir)
      }
    }
  }

  for (const t of params.sizeTargets) {
    if (t.id === excludeId) continue
    consider(axis === 'width' ? t.widthInches : t.heightInches)
  }

  return best
}

/**
 * Corner-resize snap. Works in SIZE space (absolute inches) because that is
 * what gets persisted, and because it stays correct for rotated boards, where
 * the moving corner is not simply `anchor + dir * size` along the wall axes.
 *
 * Only the moving edges participate. The two edges through the anchor corner
 * are fixed by construction and never enter the candidate set, so dragging one
 * corner can never shift the opposite edge.
 *
 * `alignTargets` may include the wall (as a rectangle centered on the wall
 * origin, whose three lines are then left / center / right). `sizeTargets`
 * should be boards only — matching a board's size to the wall's is meaningless
 * and there would be nothing sensible to outline.
 */
export function snapEdges(params: {
  width: number
  height: number
  /** The fixed anchor corner, wall-local inches. */
  anchorX: number
  anchorY: number
  /** ±1 per axis: which side of the anchor the moving corner sits on. */
  dirX: number
  dirY: number
  minWidth: number
  minHeight: number
  maxWidth: number
  maxHeight: number
  alignTargets: ReadonlyArray<SnapTarget>
  sizeTargets: ReadonlyArray<SnapTarget>
  excludeId: string
  /** False on rotated boards — see isAxisAlignedForSnap. */
  allowEdgeAlign: boolean
  /** 'proportional' locks the aspect ratio, so only one axis can drive. */
  mode: 'free' | 'proportional'
}): { width: number; height: number; guides: ActiveGuides; sizeMatches: SizeMatch[] } {
  const {
    anchorX, anchorY, dirX, dirY,
    minWidth, minHeight, maxWidth, maxHeight,
    alignTargets, sizeTargets, excludeId, allowEdgeAlign, mode,
  } = params

  const shared = { alignTargets, sizeTargets, excludeId, allowEdgeAlign }
  const xCand = bestAxisCandidate({
    ...shared, size: params.width, anchor: anchorX, dir: dirX,
    minSize: minWidth, maxSize: maxWidth, axis: 'width',
  })
  const yCand = bestAxisCandidate({
    ...shared, size: params.height, anchor: anchorY, dir: dirY,
    minSize: minHeight, maxSize: maxHeight, axis: 'height',
  })

  let width = params.width
  let height = params.height

  if (mode === 'free') {
    if (xCand) width = xCand.size
    if (yCand) height = yCand.size
  } else {
    // Aspect is locked, so only one axis can drive and the other follows by
    // ratio.
    //
    // Rank and gate on the INDUCED correction — the larger distance either
    // axis actually travels — not on the winning axis's own distance. The
    // carry multiplies by the aspect ratio, so on a 10:1 board a 1.9" snap of
    // the short side would drag the long side ~19": far outside the threshold,
    // and a visible jump. Gating on the induced value keeps the promise the
    // threshold makes, which is that no edge moves more than it.
    const evaluate = (cand: AxisCandidate | null, axis: 'width' | 'height') => {
      if (!cand) return null
      const base = axis === 'width' ? params.width : params.height
      if (!(base > 0)) return null
      const scale = cand.size / base
      const w = params.width * scale
      const h = params.height * scale
      if (w < minWidth || w > maxWidth || h < minHeight || h > maxHeight) return null
      const induced = Math.max(Math.abs(w - params.width), Math.abs(h - params.height))
      if (induced >= GUIDE_SNAP_THRESHOLD_IN) return null
      return { w, h, induced }
    }

    const xApplied = evaluate(xCand, 'width')
    const yApplied = evaluate(yCand, 'height')
    // Ties favour the width candidate, matching the per-axis ordering above.
    const winner =
      xApplied && yApplied
        ? (yApplied.induced < xApplied.induced ? yApplied : xApplied)
        : (xApplied ?? yApplied)

    if (winner) {
      width = winner.w
      height = winner.h
    }
  }

  // Re-scan from the FINAL size so a guide is only drawn where the board
  // actually landed — including the case where the snap was dropped above.
  const verticalSet = new Set<number>()
  const horizontalSet = new Set<number>()
  if (allowEdgeAlign) {
    const edgeX = anchorX + dirX * width
    const edgeY = anchorY + dirY * height
    for (const t of alignTargets) {
      if (t.id === excludeId) continue
      for (const line of linesFor(t.centerInchesX, t.widthInches / 2)) {
        if (Math.abs(edgeX - line) < GUIDE_COINCIDENCE_TOLERANCE_IN) verticalSet.add(guideKey(line))
      }
      for (const line of linesFor(t.centerInchesY, t.heightInches / 2)) {
        if (Math.abs(edgeY - line) < GUIDE_COINCIDENCE_TOLERANCE_IN) horizontalSet.add(guideKey(line))
      }
    }
  }

  const sizeMatches: SizeMatch[] = []
  for (const t of sizeTargets) {
    if (t.id === excludeId) continue
    if (Math.abs(t.widthInches - width) < GUIDE_COINCIDENCE_TOLERANCE_IN) {
      sizeMatches.push({ targetId: t.id, axis: 'width', valueIn: t.widthInches })
    }
    if (Math.abs(t.heightInches - height) < GUIDE_COINCIDENCE_TOLERANCE_IN) {
      sizeMatches.push({ targetId: t.id, axis: 'height', valueIn: t.heightInches })
    }
  }

  return {
    width,
    height,
    guides: { vertical: Array.from(verticalSet), horizontal: Array.from(horizontalSet) },
    sizeMatches,
  }
}
