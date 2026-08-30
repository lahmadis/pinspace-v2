'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Your desk crits: the personal canvases listed on the dashboard.
 *
 * Deliberately NOT useRoomCanvas. That hook resolves the ONE canvas a space
 * has, creating it on first open — a space's canvas is an implicit thing you
 * find. A desk crit is the opposite: an explicit thing you make, one per crit,
 * and the list is the point. Sharing them would have meant a hook that does
 * neither job well.
 *
 * No realtime here. The list changes only when this user changes it, because a
 * personal canvas has exactly one person who can (migration 038) — so a
 * subscription would deliver nothing a local update hasn't already applied.
 */

export interface DeskCrit {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  /** Project phase. Null on crits made before migration 043. */
  phase: string | null
  /** The named project this crit is about. Null before migration 044. */
  project: string | null
}

interface CanvasListRow {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  phase?: string | null
  project?: string | null
}

export function useDeskCrits() {
  const [crits, setCrits] = useState<DeskCrit[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** Guards against a slow load resolving after a later one. */
  const loadSeqRef = useRef(0)
  /** A create is in flight; see createCrit. */
  const creatingRef = useRef(false)

  const load = useCallback(async (signal?: AbortSignal) => {
    const seq = ++loadSeqRef.current
    setLoading(true)
    try {
      const res = await fetch('/api/canvases', { cache: 'no-store', signal })
      if (!res.ok) {
        throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load your crits')
      }
      const { canvases } = await res.json()
      if (seq !== loadSeqRef.current) return
      setCrits(
        ((canvases || []) as CanvasListRow[]).map((c) => ({
          id: c.id,
          title: c.title || 'Untitled crit',
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
          phase: c.phase ?? null,
          project: c.project ?? null,
        }))
      )
      setError(null)
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      if (seq !== loadSeqRef.current) return
      setError((err as Error).message)
    } finally {
      if (seq === loadSeqRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  /**
   * Make a new crit.
   *
   * Returns the row so the caller can navigate straight into it. Not optimistic:
   * the server mints the id, and pushing a route for an id that doesn't exist
   * yet would land on a canvas that 404s. A create is fast and the button
   * disables while it runs.
   */
  const createCrit = useCallback(
    async (title: string, phase?: string, project?: string): Promise<DeskCrit | null> => {
    // A double-click on "New crit" is one intent, not two. Without this it
    // makes two canvases and navigates into the second, leaving an empty one
    // behind in the list.
    if (creatingRef.current) return null
    creatingRef.current = true
    try {
      const res = await fetch('/api/canvases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // No roomId: that is what makes it personal. See app/api/canvases.
        body: JSON.stringify({ title, phase, project }),
      })
      if (!res.ok) {
        throw new Error((await res.json().catch(() => ({}))).error || 'Failed to create the crit')
      }
      const { canvas } = await res.json()
      const created: DeskCrit = {
        id: canvas.id,
        title: canvas.title || 'Untitled crit',
        createdAt: canvas.createdAt,
        updatedAt: canvas.updatedAt,
        phase: canvas.phase ?? null,
        project: canvas.project ?? null,
      }
      setCrits((prev) => [created, ...prev])
      setError(null)
      return created
    } catch (err) {
      setError((err as Error).message)
      return null
    } finally {
      creatingRef.current = false
    }
    },
    []
  )

  /**
   * Change which phase a crit is about. Optimistic, rolled back on failure —
   * same shape as renameCrit below, for the same reason: a dropdown that waits
   * for a round trip before it shows the new value reads as broken.
   */
  const patchCrit = useCallback(
    async (id: string, patch: { phase?: string; project?: string }): Promise<boolean> => {
      const before = crits.find((c) => c.id === id)
      setCrits((prev) =>
        prev.map((c) =>
          c.id === id
            ? {
                ...c,
                ...(patch.phase !== undefined ? { phase: patch.phase } : {}),
                // '' clears it, and the local copy has to agree with what the
                // server stores or the next render puts the old name back.
                ...(patch.project !== undefined
                  ? { project: patch.project.trim() ? patch.project.trim() : null }
                  : {}),
              }
            : c
        )
      )
      try {
        const res = await fetch(`/api/canvases/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        })
        if (!res.ok) {
          throw new Error((await res.json().catch(() => ({}))).error || 'Failed to save that')
        }
        return true
      } catch (err) {
        if (before) setCrits((prev) => prev.map((c) => (c.id === id ? before : c)))
        setError((err as Error).message)
        return false
      }
    },
    [crits]
  )

  const setCritPhase = useCallback(
    (id: string, phase: string) => patchCrit(id, { phase }),
    [patchCrit]
  )
  const setCritProject = useCallback(
    (id: string, project: string) => patchCrit(id, { project }),
    [patchCrit]
  )

  const renameCrit = useCallback(async (id: string, title: string): Promise<boolean> => {
    const next = title.trim()
    if (!next) return false
    const before = crits.find((c) => c.id === id)
    setCrits((prev) => prev.map((c) => (c.id === id ? { ...c, title: next } : c)))
    try {
      const res = await fetch(`/api/canvases/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: next }),
      })
      if (!res.ok) {
        throw new Error((await res.json().catch(() => ({}))).error || 'Failed to rename')
      }
      return true
    } catch (err) {
      // Put the old title back rather than showing a name the server rejected.
      if (before) setCrits((prev) => prev.map((c) => (c.id === id ? before : c)))
      setError((err as Error).message)
      return false
    }
  }, [crits])

  const deleteCrit = useCallback(async (id: string): Promise<boolean> => {
    const removed = crits.find((c) => c.id === id)
    const index = crits.findIndex((c) => c.id === id)
    setCrits((prev) => prev.filter((c) => c.id !== id))
    try {
      const res = await fetch(`/api/canvases/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        throw new Error((await res.json().catch(() => ({}))).error || 'Failed to delete')
      }
      return true
    } catch (err) {
      // Restore at its old position, not the end — the list is chronological
      // and a failed delete should leave it looking untouched.
      if (removed && index >= 0) {
        setCrits((prev) => {
          const next = [...prev]
          next.splice(index, 0, removed)
          return next
        })
      }
      setError((err as Error).message)
      return false
    }
  }, [crits])

  return {
    crits,
    loading,
    error,
    clearError: useCallback(() => setError(null), []),
    reload: load,
    createCrit,
    renameCrit,
    setCritPhase,
    setCritProject,
    deleteCrit,
  }
}
