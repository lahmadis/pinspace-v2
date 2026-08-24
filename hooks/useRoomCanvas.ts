'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Resolve the canvas belonging to a space, creating one on first use.
 *
 * A space has exactly one canvas for now. The schema does not enforce that —
 * `canvases.room_id` is a plain FK, deliberately, because desk sessions (phase
 * 4) will add many canvases per room — so "the space's canvas" is a convention
 * this hook keeps, not a constraint.
 *
 * Two people opening the tab at the same moment on a space with no canvas can
 * both create one. Rather than guard with a unique index we would have to undo
 * later, both clients pick the OLDEST row: the list route orders by created_at
 * ascending, so they converge on the same canvas and the loser is an empty,
 * harmless row. Cheaper than a constraint that phase 4 would immediately need
 * dropped.
 */
export function useRoomCanvas(
  roomId: string | null,
  opts: { enabled: boolean; canCreate: boolean }
) {
  const { enabled, canCreate } = opts
  const [canvasId, setCanvasId] = useState<string | null>(null)
  // Seeded true when there is work to do. Effects run AFTER paint, so starting
  // at false means the very first committed frame renders the "no canvas yet"
  // empty state — a visible flash of the wrong answer on every first open,
  // before the fetch has even been issued.
  const [loading, setLoading] = useState(() => enabled && Boolean(roomId))
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  /**
   * One create attempt per room, ever.
   *
   * Without this, React 18's development double-invoke of effects POSTs twice
   * and leaves an orphan canvas behind on every first open — and a failed
   * create would retry on each re-render.
   */
  const createdForRef = useRef<string | null>(null)

  const retry = useCallback(() => {
    // Deliberately does NOT clear createdForRef. The guard is now cleared on
    // any create that failed, so a retry after a genuine failure will create;
    // a retry after a create that raced the listing just re-lists and finds the
    // row. Clearing it here would mint a second canvas in that second case.
    setAttempt((n) => n + 1)
  }, [])

  useEffect(() => {
    if (!enabled || !roomId) return
    let cancelled = false
    const controller = new AbortController()

    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/canvases?roomId=${encodeURIComponent(roomId)}`, {
          signal: controller.signal,
        })
        if (!res.ok) {
          throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load canvas')
        }
        const { canvases } = await res.json()
        if (cancelled) return

        if (canvases?.length > 0) {
          setCanvasId(canvases[0].id)
          return
        }
        // Nothing yet. Read-only viewers and guests stop here — the API refuses
        // a guest create anyway, and an archived space should not gain rows
        // just because someone looked at it.
        if (!canCreate) {
          setCanvasId(null)
          return
        }
        if (createdForRef.current === roomId) {
          // We already created one for this room, but this listing doesn't show
          // it — a read that raced our own insert, reachable when the effect
          // re-runs mid-create (canEdit resolves asynchronously, so it can flip
          // under us). Reported as retryable rather than falling through to
          // "no canvas yet", which would be both wrong and a dead end.
          throw new Error('Canvas is still being created')
        }
        createdForRef.current = roomId

        const created = await fetch('/api/canvases', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomId, title: 'Canvas' }),
        }).catch((err) => {
          // A create that never landed must not latch the guard, or the space
          // could never get a canvas without a reload.
          createdForRef.current = null
          throw err
        })
        if (!created.ok) {
          createdForRef.current = null
          throw new Error((await created.json().catch(() => ({}))).error || 'Failed to create canvas')
        }
        const { canvas } = await created.json()
        if (!cancelled) setCanvasId(canvas.id)
      } catch (err) {
        if ((err as Error).name === 'AbortError' || cancelled) return
        setError((err as Error).message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [roomId, enabled, canCreate, attempt])

  return { canvasId, loading, error, retry }
}
