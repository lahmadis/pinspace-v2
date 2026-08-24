'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ParsedDeliverable } from '@/lib/summary/types'

/**
 * A crit's summary and its deliverables.
 *
 * One hook for both because they are produced by one act — a summarise step
 * returns a paragraph and a list together, and saving one without the other is
 * never what anyone means. They are separate TABLES because deliverables
 * outlive the summary that produced them; that is a storage decision, not a
 * reason for two hooks.
 */

export interface Deliverable {
  id: string
  title: string
  detail: string | null
  dueText: string | null
  done: boolean
  position: number
  createdAt: string
}

export interface CritSummary {
  text: string
  source: string
  updatedAt: string
}

export function useCritSummary(canvasId: string | null) {
  const [summary, setSummary] = useState<CritSummary | null>(null)
  const [deliverables, setDeliverables] = useState<Deliverable[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const loadSeqRef = useRef(0)
  /** Live list for callbacks that must not re-create when it changes. */
  const deliverablesRef = useRef<Deliverable[]>([])

  useEffect(() => {
    deliverablesRef.current = deliverables
  }, [deliverables])

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canvasId) {
        setSummary(null)
        setDeliverables([])
        return
      }
      const seq = ++loadSeqRef.current
      setLoading(true)
      try {
        // Both at once: the panel shows them together, and two sequential
        // round trips would render an empty deliverables list under a summary
        // that is already there.
        const [summaryRes, deliverablesRes] = await Promise.all([
          fetch(`/api/canvases/${canvasId}/summary`, { cache: 'no-store', signal }),
          fetch(`/api/canvases/${canvasId}/deliverables`, { cache: 'no-store', signal }),
        ])
        if (!summaryRes.ok) {
          throw new Error((await summaryRes.json().catch(() => ({}))).error || 'Failed to load the summary')
        }
        if (!deliverablesRes.ok) {
          throw new Error(
            (await deliverablesRes.json().catch(() => ({}))).error || 'Failed to load deliverables'
          )
        }
        const summaryJson = await summaryRes.json()
        const deliverablesJson = await deliverablesRes.json()
        if (seq !== loadSeqRef.current) return
        setSummary(summaryJson.summary ?? null)
        setDeliverables((deliverablesJson.deliverables || []) as Deliverable[])
        setError(null)
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        if (seq !== loadSeqRef.current) return
        setError((err as Error).message)
      } finally {
        if (seq === loadSeqRef.current) setLoading(false)
      }
    },
    [canvasId]
  )

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  /**
   * Store a parsed reply: the summary, then any deliverables.
   *
   * Sequential, not parallel, and the summary goes FIRST. If the deliverables
   * insert fails, the user still has the paragraph and can retry the list; the
   * other order would leave orphan tasks under no summary, which reads as the
   * save having half-worked in the more confusing direction.
   */
  const saveParsed = useCallback(
    async (text: string, items: ParsedDeliverable[], source = 'manual'): Promise<boolean> => {
      if (!canvasId) return false
      setSaving(true)
      try {
        if (text.trim()) {
          const res = await fetch(`/api/canvases/${canvasId}/summary`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, source }),
          })
          if (!res.ok) {
            throw new Error((await res.json().catch(() => ({}))).error || 'Failed to save the summary')
          }
          const { summary: saved } = await res.json()
          setSummary(saved as CritSummary)
        }

        if (items.length > 0) {
          const res = await fetch(`/api/canvases/${canvasId}/deliverables`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items }),
          })
          if (!res.ok) {
            throw new Error((await res.json().catch(() => ({}))).error || 'Failed to save deliverables')
          }
          const { deliverables: created } = await res.json()
          // Appended, matching the API — re-summarising adds to the list rather
          // than replacing it, so existing ticks survive.
          setDeliverables((prev) => [...prev, ...(created as Deliverable[])])
        }

        setError(null)
        return true
      } catch (err) {
        setError((err as Error).message)
        return false
      } finally {
        setSaving(false)
      }
    },
    [canvasId]
  )

  const setDone = useCallback(
    async (id: string, done: boolean): Promise<boolean> => {
      if (!canvasId) return false
      const before = deliverablesRef.current.find((d) => d.id === id)
      // Optimistic: a checkbox that waits for a round trip before moving feels
      // broken, and the rollback below is exact.
      setDeliverables((prev) => prev.map((d) => (d.id === id ? { ...d, done } : d)))
      try {
        const res = await fetch(`/api/canvases/${canvasId}/deliverables/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ done }),
        })
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to update')
        return true
      } catch (err) {
        // `before` is missing only for a row appended in the same tick, before
        // the mirroring effect flushed — rare, but leaving the optimistic tick
        // on screen would show a state the server rejected. A reload settles it
        // against what was actually stored.
        if (before) setDeliverables((prev) => prev.map((d) => (d.id === id ? before : d)))
        else void load()
        setError((err as Error).message)
        return false
      }
    },
    [canvasId, load]
  )

  const editTitle = useCallback(
    async (id: string, title: string): Promise<boolean> => {
      if (!canvasId) return false
      const next = title.trim()
      if (!next) return false
      const before = deliverablesRef.current.find((d) => d.id === id)
      if (before?.title === next) return true
      setDeliverables((prev) => prev.map((d) => (d.id === id ? { ...d, title: next } : d)))
      try {
        const res = await fetch(`/api/canvases/${canvasId}/deliverables/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: next }),
        })
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to update')
        return true
      } catch (err) {
        // Same reasoning as setDone: no snapshot means reload rather than leave
        // a rejected title showing.
        if (before) setDeliverables((prev) => prev.map((d) => (d.id === id ? before : d)))
        else void load()
        setError((err as Error).message)
        return false
      }
    },
    [canvasId, load]
  )

  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      if (!canvasId) return false
      const removed = deliverablesRef.current.find((d) => d.id === id)
      setDeliverables((prev) => prev.filter((d) => d.id !== id))
      try {
        const res = await fetch(`/api/canvases/${canvasId}/deliverables/${id}`, { method: 'DELETE' })
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to delete')
        return true
      } catch (err) {
        // Just the ONE row back, re-sorted into place — not a snapshot of the
        // whole list. Restoring the snapshot would undo anything that landed
        // while the request was in flight: another item ticked, a fresh batch
        // appended by a re-summarise. Position is a property of the row, so
        // sorting is enough to put it where it was.
        if (removed) {
          setDeliverables((prev) =>
            [...prev.filter((d) => d.id !== id), removed].sort(
              (a, b) =>
                a.position - b.position ||
                a.createdAt.localeCompare(b.createdAt) ||
                a.id.localeCompare(b.id)
            )
          )
        }
        setError((err as Error).message)
        return false
      }
    },
    [canvasId]
  )

  return {
    summary,
    deliverables,
    loading,
    saving,
    error,
    clearError: useCallback(() => setError(null), []),
    reload: load,
    saveParsed,
    setDone,
    editTitle,
    remove,
  }
}
