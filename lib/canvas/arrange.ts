/**
 * Align, distribute, and stacking order for a canvas selection.
 *
 * Pure: takes geometry, returns geometry. No React, no network, nothing about
 * how a node is stored — so the rules here can be reasoned about (and later
 * tested) without a canvas in front of you.
 *
 * Everything works on the AXIS-ALIGNED BOUNDING BOX, not the raw x/y/w/h. A
 * rotated node's corners stick out past its own rect, so aligning by `x` would
 * leave a tilted sticky visibly proud of the edge it was supposedly aligned to.
 * Aligning the boxes is what people actually mean, and it degrades to the same
 * answer when nothing is rotated.
 */

import { aabbOf, type NodeGeometry } from './geometry'
import type { Bounds } from './viewport'

export type AlignMode = 'left' | 'center-x' | 'right' | 'top' | 'center-y' | 'bottom'
export type DistributeMode = 'horizontal' | 'vertical'

/** A node's id with the geometry an arrange operation should give it. */
export interface ArrangeResult {
  id: string
  x: number
  y: number
}

interface ArrangeInput extends NodeGeometry {
  id: string
}

/** The union of every selected node's bounding box. */
function unionOf(items: ArrangeInput[]): Bounds {
  const boxes = items.map(aabbOf)
  return {
    minX: Math.min(...boxes.map(b => b.minX)),
    minY: Math.min(...boxes.map(b => b.minY)),
    maxX: Math.max(...boxes.map(b => b.maxX)),
    maxY: Math.max(...boxes.map(b => b.maxY)),
  }
}

/**
 * Move each node so its bounding box lines up with the selection's.
 *
 * Returns only the nodes that actually MOVE. An align where three of four
 * objects were already flush should be three writes, not four, and one undo
 * step that visibly restores three objects rather than a no-op on the fourth.
 */
export function alignNodes(items: ArrangeInput[], mode: AlignMode): ArrangeResult[] {
  // Two is the minimum that means anything: aligning one object to itself is a
  // no-op, and the UI should not offer it.
  if (items.length < 2) return []

  const group = unionOf(items)
  const results: ArrangeResult[] = []

  for (const item of items) {
    const box = aabbOf(item)
    let dx = 0
    let dy = 0
    switch (mode) {
      case 'left':
        dx = group.minX - box.minX
        break
      case 'right':
        dx = group.maxX - box.maxX
        break
      case 'center-x':
        dx = (group.minX + group.maxX) / 2 - (box.minX + box.maxX) / 2
        break
      case 'top':
        dy = group.minY - box.minY
        break
      case 'bottom':
        dy = group.maxY - box.maxY
        break
      case 'center-y':
        dy = (group.minY + group.maxY) / 2 - (box.minY + box.maxY) / 2
        break
    }
    // Sub-pixel deltas are rounding noise from the bounding-box maths, not a
    // move anyone asked for. Writing them would emit pointless updates and put
    // a meaningless entry on the undo stack.
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) continue
    results.push({ id: item.id, x: item.x + dx, y: item.y + dy })
  }

  return results
}

/**
 * Spread nodes so the GAPS between them are equal.
 *
 * Equal gaps, not equal centres. With mixed sizes — a wide image between two
 * stickies — equal centre spacing leaves the big object crowding its
 * neighbours, which is not what "distribute" is meant to look like.
 *
 * The two outermost nodes stay put and define the span; everything between
 * them is repositioned. That matches every canvas tool people have used, and
 * it means the operation cannot grow the selection's footprint.
 */
export function distributeNodes(items: ArrangeInput[], mode: DistributeMode): ArrangeResult[] {
  // Three is the minimum: with two, the ends are the whole selection and there
  // is nothing in between to space out.
  if (items.length < 3) return []

  const horizontal = mode === 'horizontal'
  const withBoxes = items.map(item => ({ item, box: aabbOf(item) }))
  const sorted = [...withBoxes].sort((a, b) =>
    horizontal ? a.box.minX - b.box.minX : a.box.minY - b.box.minY
  )

  const first = sorted[0].box
  const last = sorted[sorted.length - 1].box
  const span = horizontal ? last.maxX - first.minX : last.maxY - first.minY
  const totalSize = sorted.reduce(
    (sum, { box }) => sum + (horizontal ? box.maxX - box.minX : box.maxY - box.minY),
    0
  )

  // Negative when the nodes overlap more than the span allows. Distributing
  // then would stack them at overlapping positions, which is worse than the
  // arrangement the user already has.
  const gap = (span - totalSize) / (sorted.length - 1)
  if (!Number.isFinite(gap) || gap < 0) return []

  const results: ArrangeResult[] = []
  let cursor = horizontal ? first.minX : first.minY

  for (let i = 0; i < sorted.length; i += 1) {
    const { item, box } = sorted[i]
    const size = horizontal ? box.maxX - box.minX : box.maxY - box.minY

    // Ends are anchors, never moved.
    if (i > 0 && i < sorted.length - 1) {
      const currentEdge = horizontal ? box.minX : box.minY
      const delta = cursor - currentEdge
      if (Math.abs(delta) >= 0.01) {
        results.push({
          id: item.id,
          x: horizontal ? item.x + delta : item.x,
          y: horizontal ? item.y : item.y + delta,
        })
      }
    }
    cursor += size + gap
  }

  return results
}

/**
 * New `z` values that put a selection above or below everything else.
 *
 * Relative order WITHIN the selection is preserved — sending three overlapping
 * cards to the back should keep them stacked the way they were, just behind
 * the rest.
 *
 * Returns only nodes whose z actually changes; a selection already at the front
 * yields nothing rather than a stack of no-op writes.
 */
export function restackNodes(
  selected: Array<{ id: string; z: number }>,
  /**
   * z values of the nodes NOT in the selection.
   *
   * Must exclude the selection. Passing every node's z made `top` the
   * already-front node's own value, so `top + 1` always differed and every
   * press emitted a write, a realtime broadcast and an undo entry — with z
   * drifting upward without bound.
   */
  otherZ: number[],
  direction: 'front' | 'back'
): Array<{ id: string; z: number }> {
  if (selected.length === 0) return []
  // Nothing else on the canvas: the selection is already both front and back.
  if (otherZ.length === 0) return []

  const ordered = [...selected].sort((a, b) => a.z - b.z)
  const top = Math.max(...otherZ)
  const bottom = Math.min(...otherZ)

  // Already clear of everything in that direction, in the right internal
  // order? Then this is a no-op, and saying so beats N pointless writes.
  const settled =
    direction === 'front'
      ? ordered.every((n, i) => n.z === top + 1 + i)
      : ordered.every((n, i) => n.z === bottom - ordered.length + i)
  if (settled) return []

  const results: Array<{ id: string; z: number }> = []
  ordered.forEach((node, i) => {
    // Integers: z is an INTEGER column (migration 036), so fractional values
    // would be truncated by the database and could collapse two layers into
    // one. Stepping by whole numbers from the current extreme keeps the
    // selection's internal order intact.
    const next = direction === 'front' ? top + 1 + i : bottom - ordered.length + i
    if (next === node.z) return
    results.push({ id: node.id, z: next })
  })
  return results
}
