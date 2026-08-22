'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CanvasHistoryEntry } from '@/lib/canvas/history'

/**
 * The undo and redo stacks for one canvas.
 *
 * Storage only — this hook never touches the network and never looks at a
 * node. It hands out entries and takes them back; InfiniteCanvas decides what
 * applying one means. Keeping it that way is what makes the ordering rules
 * below checkable by reading one short file.
 *
 * The stacks live in REFS, with only their depths mirrored into state.
 * `takeUndo` has to return the popped entry synchronously to the key handler
 * that called it, which a useState setter cannot do; the mirrored depths exist
 * purely so the rail's buttons can grey out.
 */

/**
 * Entries kept per canvas.
 *
 * Bounded because an entry can be large: a delete op carries the whole node,
 * and an ink node's props hold up to INK_MAX_POINTS coordinate pairs — around
 * 300 KB in memory for a maximal stroke. The cap applies to each stack
 * separately, so the true ceiling is 200 entries, and a pathological canvas of
 * nothing but maximal strokes would reach tens of megabytes. That is the
 * worst case worth bounding, and a hundred steps is already far past what
 * anyone reaches for.
 */
const MAX_HISTORY = 100

export interface CanvasHistory {
  /** A new user action. Pushes to undo and INVALIDATES redo. */
  record: (entry: CanvasHistoryEntry) => void
  /** Pop the newest undoable entry, or null when there is nothing to undo. */
  takeUndo: () => CanvasHistoryEntry | null
  takeRedo: () => CanvasHistoryEntry | null
  /**
   * Put an entry on the opposite stack after applying it.
   *
   * Separate from `record` because these must NOT clear the other stack — an
   * undo that cleared redo would make redo unreachable, which is the whole
   * point of it. Callers pass only the ops that actually applied, so a partly
   * failed undo leaves a redo that matches what really happened.
   */
  stashRedo: (entry: CanvasHistoryEntry) => void
  stashUndo: (entry: CanvasHistoryEntry) => void
  canUndo: boolean
  canRedo: boolean
  clear: () => void
}

export function useCanvasHistory(canvasId: string | null): CanvasHistory {
  const undoRef = useRef<CanvasHistoryEntry[]>([])
  const redoRef = useRef<CanvasHistoryEntry[]>([])
  const [depths, setDepths] = useState({ undo: 0, redo: 0 })

  const sync = useCallback(() => {
    const undo = undoRef.current.length
    const redo = redoRef.current.length
    // Compared before setting: every gesture that changes nothing about
    // whether the buttons are enabled would otherwise re-render the whole
    // canvas, and there is one of those per drag.
    setDepths((prev) => (prev.undo === undo && prev.redo === redo ? prev : { undo, redo }))
  }, [])

  const clear = useCallback(() => {
    undoRef.current = []
    redoRef.current = []
    sync()
  }, [sync])

  /**
   * A different canvas is a different history.
   *
   * Without this, switching spaces and pressing Cmd+Z would apply the previous
   * canvas's entries to this one — every op carries a node id, and those ids
   * belong to rows in another canvas, so the writes would 404 at best and, for
   * a restore, insert a foreign node into the canvas you are looking at.
   */
  useEffect(() => {
    clear()
  }, [canvasId, clear])

  const record = useCallback(
    (entry: CanvasHistoryEntry) => {
      if (entry.length === 0) return
      undoRef.current.push(entry)
      // Drop from the bottom once full. shift() on a 100-element array of
      // references is not worth a ring buffer.
      if (undoRef.current.length > MAX_HISTORY) undoRef.current.shift()
      // A new action makes the redo branch unreachable — the world it would
      // have been replayed onto no longer exists. Standard for every linear
      // history, and the alternative is a tree nobody asked for.
      redoRef.current = []
      sync()
    },
    [sync]
  )

  const takeUndo = useCallback(() => {
    const entry = undoRef.current.pop() ?? null
    if (entry) sync()
    return entry
  }, [sync])

  const takeRedo = useCallback(() => {
    const entry = redoRef.current.pop() ?? null
    if (entry) sync()
    return entry
  }, [sync])

  const stashRedo = useCallback(
    (entry: CanvasHistoryEntry) => {
      if (entry.length === 0) return
      redoRef.current.push(entry)
      if (redoRef.current.length > MAX_HISTORY) redoRef.current.shift()
      sync()
    },
    [sync]
  )

  const stashUndo = useCallback(
    (entry: CanvasHistoryEntry) => {
      if (entry.length === 0) return
      undoRef.current.push(entry)
      if (undoRef.current.length > MAX_HISTORY) undoRef.current.shift()
      sync()
    },
    [sync]
  )

  return {
    record,
    takeUndo,
    takeRedo,
    stashRedo,
    stashUndo,
    canUndo: depths.undo > 0,
    canRedo: depths.redo > 0,
    clear,
  }
}
