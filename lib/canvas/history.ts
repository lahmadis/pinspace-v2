/**
 * The op model behind canvas undo/redo.
 *
 * Pure: types and small helpers only, no React and no network, so the stack
 * (hooks/useCanvasHistory.ts) and the thing that applies ops (InfiniteCanvas)
 * can be reasoned about separately. Imports only the CanvasNode type, keeping
 * the same no-server-code property types.ts has.
 *
 * The history is LOCAL and PER-CLIENT. Undo reverses what THIS user did; it
 * never reaches for a peer's edit, even the one that landed most recently.
 * That is what every shared canvas does, and the alternative — a room-wide
 * stack — means your Cmd+Z silently rearranges someone else's work.
 *
 * Because the surface is last-write-wins per node, undo is not a rollback to a
 * past world state: it is a NEW write carrying an old value. If a peer moved
 * the sticky in between, undo moves it back and their edit is lost, exactly as
 * if you had dragged it there yourself. That is the same trade migration 036
 * already makes for direct manipulation, applied consistently.
 */

import type { CanvasNode } from './types'

/**
 * The fields an op may carry — precisely the set PATCH accepts.
 *
 * Typed as its own shape rather than Partial<CanvasNode> so it cannot come to
 * hold `id`, `type` or authorship, none of which the API will patch and all of
 * which would silently no-op if an op ever tried.
 */
export interface NodeSnapshot {
  x?: number
  y?: number
  w?: number
  h?: number
  rotation?: number
  z?: number
  props?: Record<string, unknown>
}

/**
 * One reversible change.
 *
 * `create` and `delete` carry the WHOLE node, not an id: undoing a delete has
 * to rebuild the row from nothing, and by the time undo runs the node is gone
 * from the local list, so there is nowhere else to read it from.
 */
export type CanvasOp =
  | { kind: 'create'; node: CanvasNode }
  | { kind: 'delete'; node: CanvasNode }
  | { kind: 'update'; id: string; before: NodeSnapshot; after: NodeSnapshot }

/**
 * One user action, undone as a unit.
 *
 * Dragging a six-node selection is six writes but ONE Cmd+Z, and deleting that
 * selection likewise. An entry's ops always target DISTINCT nodes — they come
 * from a single gesture over a selection — which is what lets them be applied
 * concurrently with no ordering to preserve.
 */
export type CanvasHistoryEntry = CanvasOp[]

/** The geometry half of a snapshot, as a drag leaves it. */
export function geometryOf(n: {
  x: number
  y: number
  w: number
  h: number
  rotation: number
}): NodeSnapshot {
  return { x: n.x, y: n.y, w: n.w, h: n.h, rotation: n.rotation }
}

/** True when a drag ended somewhere other than where it started. */
export function geometryChanged(a: NodeSnapshot, b: NodeSnapshot): boolean {
  return a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h || a.rotation !== b.rotation
}
