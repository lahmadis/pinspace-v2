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
