'use client'

import { useCallback, useEffect, useState } from 'react'
import type { Board } from '@/types'

/** A crit sheet: a real board, plus its role in this crit. */
export type CritBoard = Board & { pinned: boolean }

/**
 * The sheets in one desk crit.
 *
 * Replaces useCanvasNodes for this surface. A crit's sheets are boards now
 * (migration 042), which is what lets the lightbox open one — trace strokes and
 * callouts are keyed by boards.id, so the previous canvas-node sheets could not
 * be marked up at all.
 *
 * No realtime subscription, deliberately: crit_boards has RLS on and no
 * policies (service-role only, this project's pattern), and postgres_changes
 * filters per subscriber — a table with no SELECT policy delivers no events to
 * anyone. `reload` after a write is the honest mechanism rather than a
 * subscription that would silently never fire.
 */
export function useCritBoards(critId: string | null, refreshKey = 0) {
  const [boards, setBoards] = useState<CritBoard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!critId) {
      setBoards([])
      setLoading(false)
      return
    }
    try {
      const res = await fetch(`/api/canvases/${critId}/boards`, { cache: 'no-store' })
      if (!res.ok) throw new Error('Failed to load sheets')
      const data = await res.json()
      setBoards((data.boards ?? []) as CritBoard[])
      setError(null)
    } catch {
      setError('Could not load this crit’s sheets.')
    } finally {
      setLoading(false)
    }
  }, [critId])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  /**
   * Pin or unpin a sheet — optimistic, and rolled back on failure.
   *
   * Optimistic because this is pressed DURING a crit, while someone is talking:
   * a checkbox that waits for a round trip before it looks pressed gets pressed
   * twice.
   */
  const setPinned = useCallback(
    async (boardId: string, pinned: boolean) => {
      if (!critId) return
      setBoards((prev) => prev.map((b) => (b.id === boardId ? { ...b, pinned } : b)))
      try {
        const res = await fetch(`/api/canvases/${critId}/boards/${boardId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pinned }),
        })
        if (!res.ok) throw new Error('pin failed')
      } catch {
        setBoards((prev) => prev.map((b) => (b.id === boardId ? { ...b, pinned: !pinned } : b)))
        setError('That pin didn’t save.')
      }
    },
    [critId]
  )

  /** Remove a sheet from the crit. The board goes with it — see the DELETE route. */
  const removeBoard = useCallback(
    async (boardId: string) => {
      if (!critId) return
      const previous = boards
      setBoards((prev) => prev.filter((b) => b.id !== boardId))
      try {
        const res = await fetch(`/api/canvases/${critId}/boards/${boardId}`, { method: 'DELETE' })
        if (!res.ok) throw new Error('delete failed')
      } catch {
        setBoards(previous)
        setError('Could not remove that sheet.')
      }
    },
    [critId, boards]
  )

  return { boards, loading, error, reload: load, setPinned, removeBoard, clearError: () => setError(null) }
}
