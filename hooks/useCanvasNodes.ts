'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase/client'
import {
  transformNode,
  type CanvasNode,
  type CanvasNodeRow,
  type CanvasNodeType,
} from '@/lib/canvas/types'

/**
 * The canvas's node set: load, optimistic local edits, writes, and multiplayer.
 *
 * Concurrency is last-write-wins PER NODE, decided in migration 036. Two people
 * dragging different stickies never conflict, which is the whole reason nodes
 * are rows instead of one JSON document like wall-config. Two people dragging
 * the SAME sticky is a race that the later write wins, and that is the intended
 * behaviour — not a bug to be locked away behind a version check.
 *
 * Guests receive no postgres_changes at all (they authenticate with a link, not
 * an account, so RLS can't see them). They ride the same broadcast-ping pattern
 * the studio page already uses for boards: every successful write pings the
 * room, and anyone without a database subscription refetches.
 */

export interface CanvasNodeInput {
  /**
   * Reuse a specific id instead of minting one.
   *
   * Only undo needs this: restoring a deleted node under its ORIGINAL id is
   * what keeps a further redo, and any op still on the stack referring to it,
   * pointing at the same object. A fresh id would make the second Cmd+Z in a
   * row address a row that no longer exists.
   */
  id?: string
  type: CanvasNodeType
  x: number
  y: number
  w?: number
  h?: number
  rotation?: number
  z?: number
  props?: Record<string, unknown>
  fromNodeId?: string | null
  toNodeId?: string | null
}

/** The subset of a node a gesture may change. */
export interface NodePatch {
  x?: number
  y?: number
  w?: number
  h?: number
  rotation?: number
  z?: number
  props?: Record<string, unknown>
}

interface RealtimeCanvasPayload {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE'
  new: Partial<CanvasNodeRow>
  old: Partial<CanvasNodeRow>
}

/**
 * Paint order: (z, created_at, id), matching the GET route's ORDER BY.
 *
 * The tie-break has to be total and identical on both sides — z alone leaves
 * ties, and if the server and the client broke them differently, a node would
 * jump layers the moment a reload replaced the optimistic list with the fetched
 * one.
 */
function sortNodes(list: CanvasNode[]): CanvasNode[] {
  return [...list].sort(
    (a, b) =>
      a.z - b.z ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id)
  )
}

export function useCanvasNodes(
  canvasId: string | null,
  guestToken?: string | null,
  opts?: {
    /**
     * Subscribe to live changes. Default true.
     *
     * Pass false where nothing can change underneath you. The desk board reads
     * many crits at once and writes through the API with its own reload nonce,
     * so each column would otherwise open TWO channels — a broadcast and a
     * postgres_changes — for a personal canvas that has exactly one viewer.
     * Twenty crits is forty channels against a per-client quota of about a
     * hundred, spent to deliver events nobody is waiting for.
     */
    realtime?: boolean
  }
) {
  const realtimeEnabled = opts?.realtime !== false
  const [nodes, setNodes] = useState<CanvasNode[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * Nodes under an active local gesture, and nodes with a write in flight.
   *
   * Both suppress incoming realtime for those ids. Without the first, a remote
   * echo lands mid-drag and the node jumps back to where it was when the drag
   * started — the object fights the cursor. Without the second, our own write
   * echoes back and briefly overwrites a newer local edit made while the
   * request was in the air.
   *
   * Refs, not state: they are read inside the realtime callback, and putting
   * them in state would mean re-subscribing the channel on every drag.
   */
  const gestureRef = useRef<Set<string>>(new Set())
  const inflightRef = useRef<Map<string, number>>(new Map())
  /**
   * Nodes whose realtime events we DISCARDED while a write was in flight.
   *
   * Suppressing the echo is necessary, but it also throws away a genuine remote
   * edit that happened to land inside our request window — and last-write-wins
   * means the database may well be holding that peer's value, not ours. Without
   * this the two clients simply disagree until someone reloads. Recording the id
   * and refetching once our write settles closes that window.
   */
  const staleRef = useRef<Set<string>>(new Set())
  /** Live node list for callbacks that must not re-create on every frame. */
  const nodesRef = useRef<CanvasNode[]>([])
  const liveChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Guards against a slow first load resolving after a later one. */
  const loadSeqRef = useRef(0)

  const headers = useMemo(() => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    if (guestToken) h['X-Guest-Token'] = guestToken
    return h
  }, [guestToken])

  useEffect(() => {
    nodesRef.current = nodes
  }, [nodes])

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canvasId) {
        setNodes([])
        return
      }
      const seq = ++loadSeqRef.current
      setLoading(true)
      try {
        const res = await fetch(`/api/canvases/${canvasId}/nodes`, { headers, signal })
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load canvas')
        const json = await res.json()
        // Discard a response that a newer load has already superseded.
        if (seq !== loadSeqRef.current) return
        const fetched = (json.nodes || []) as CanvasNode[]
        setNodes((prev) => {
          // A refetch replaces the world — but NOT a node the user is currently
          // dragging, or one with a write still in the air. The stale-node
          // reconciliation deliberately routes contended nodes through here, so
          // without this guard the very nodes most likely to be under someone's
          // pointer are the ones a refetch would yank out from under it, or
          // revert to a value older than a PATCH already in flight.
          const held = new Set<string>([...gestureRef.current, ...inflightRef.current.keys()])
          if (held.size === 0) return sortNodes(fetched)
          const localHeld = prev.filter((n) => held.has(n.id))
          const localById = new Map(localHeld.map((n) => [n.id, n]))
          const merged = fetched.map((n) => localById.get(n.id) ?? n)
          const fetchedIds = new Set(fetched.map((n) => n.id))
          // Optimistic creates the server hasn't returned yet must survive too.
          return sortNodes([...merged, ...localHeld.filter((n) => !fetchedIds.has(n.id))])
        })
        setError(null)
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        if (seq !== loadSeqRef.current) return
        setError((err as Error).message)
      } finally {
        if (seq === loadSeqRef.current) setLoading(false)
      }
    },
    [canvasId, headers]
  )

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  const scheduleRefetch = useCallback(() => {
    if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current)
    refetchTimerRef.current = setTimeout(() => {
      refetchTimerRef.current = null
      void load()
    }, 300)
  }, [load])

  useEffect(
    () => () => {
      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current)
    },
    []
  )

  /** Tell anyone without a database subscription that something changed. */
  const pingDirty = useCallback(() => {
    liveChannelRef.current?.send({ type: 'broadcast', event: 'canvas-dirty', payload: {} })
  }, [])

  const markInflight = useCallback(
    (id: string, delta: number) => {
      const map = inflightRef.current
      const next = (map.get(id) || 0) + delta
      if (next > 0) {
        map.set(id, next)
        return
      }
      map.delete(id)
      // A remote event for this node arrived while we were writing and was
      // dropped. Now that nothing is in flight, go and find out what the
      // database actually holds. Set.delete reports whether it was there.
      if (staleRef.current.delete(id)) scheduleRefetch()
    },
    [scheduleRefetch]
  )

  // ---------------------------------------------------------------------------
  // Local-only edits. Used for every frame of a drag, so they must NOT touch the
  // network — one PATCH per pointermove would be hundreds of writes per gesture
  // and each one rebroadcasts the full row to the room.
  // ---------------------------------------------------------------------------

  const beginGesture = useCallback((ids: string[]) => {
    ids.forEach((id) => gestureRef.current.add(id))
  }, [])

  const endGesture = useCallback(
    (ids: string[]) => {
      let needsRefetch = false
      ids.forEach((id) => {
        gestureRef.current.delete(id)
        // Only reconcile here for nodes with NO write in flight — a gesture
        // that changed nothing, so no commit will follow. When a commit is
        // pending, markInflight does it once the write settles, which avoids a
        // refetch racing our own PATCH response.
        if (!inflightRef.current.has(id) && staleRef.current.delete(id)) needsRefetch = true
      })
      if (needsRefetch) scheduleRefetch()
    },
    [scheduleRefetch]
  )

  const previewNode = useCallback((id: string, patch: NodePatch) => {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)))
  }, [])

  // ---------------------------------------------------------------------------
  // Writes.
  // ---------------------------------------------------------------------------

  const createNode = useCallback(
    async (input: CanvasNodeInput): Promise<CanvasNode | null> => {
      if (!canvasId) return null
      // The id is generated HERE so the object can render and be selected before
      // the round trip finishes, and so a retry of a dropped response conflicts
      // rather than creating a duplicate. Same contract as boards and traces.
      // An undo restoring a deleted node supplies the original id instead.
      const id = input.id ?? crypto.randomUUID()
      const now = new Date().toISOString()
      const optimistic: CanvasNode = {
        id,
        canvasId,
        type: input.type,
        x: input.x,
        y: input.y,
        w: input.w ?? 0,
        h: input.h ?? 0,
        rotation: input.rotation ?? 0,
        z: input.z ?? 0,
        props: input.props ?? {},
        fromNodeId: input.fromNodeId ?? null,
        toNodeId: input.toNodeId ?? null,
        authorId: null,
        // Replaced by the server's own resolution when the response lands —
        // the API refuses a body-supplied name for account holders, so this is
        // a placeholder for one frame, never the stored value.
        authorName: '…',
        updatedBy: '',
        createdAt: now,
        updatedAt: now,
      }
      // An id already in the list is REPLACED, not appended.
      //
      // Normally impossible — a minted uuid collides with nothing. It becomes
      // reachable through undo: a failed DELETE rolls its node back into the
      // list while the history still holds the delete op, so restoring it
      // would put a second copy of the same id in the array. React would key
      // them identically, and the rollback below would then remove both.
      //
      // Captured from `prev` inside the updater, NOT from nodesRef: that ref
      // is mirrored by an effect and so lags a commit, and it lags it in
      // exactly the window this guards — a failed delete's rollback and the
      // undo's create in the same tick. Reading the stale ref would report
      // nothing displaced while the filter below removed the node anyway, so a
      // second failure would drop a row that still exists on the server. The
      // assignment is an idempotent read, which is what makes it safe under
      // StrictMode's double invocation.
      let displaced: CanvasNode | undefined
      setNodes((prev) => {
        displaced = prev.find((n) => n.id === id)
        return sortNodes([...prev.filter((n) => n.id !== id), optimistic])
      })
      markInflight(id, 1)

      try {
        const res = await fetch(`/api/canvases/${canvasId}/nodes`, {
          method: 'POST',
          headers,
          // `id` LAST: input may now carry its own, and an absent-but-declared
          // optional would spread `id: undefined` over a good one.
          body: JSON.stringify({ ...input, id }),
        })
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to create')
        const { node } = await res.json()
        setNodes((prev) => sortNodes(prev.map((n) => (n.id === id ? node : n))))
        pingDirty()
        return node as CanvasNode
      } catch (err) {
        // Roll the optimistic node back out rather than leaving a ghost that
        // looks saved and vanishes on the next reload. If this create replaced
        // a node that was already there, put that one back — dropping it would
        // make a failed write destructive.
        setNodes((prev) => {
          const without = prev.filter((n) => n.id !== id)
          return displaced ? sortNodes([...without, displaced]) : without
        })
        setError((err as Error).message)
        return null
      } finally {
        markInflight(id, -1)
      }
    },
    [canvasId, headers, markInflight, pingDirty]
  )

  const commitNode = useCallback(
    async (id: string, patch: NodePatch): Promise<boolean> => {
      if (!canvasId) return false
      const before = nodesRef.current.find((n) => n.id === id)
      setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)))
      markInflight(id, 1)
      try {
        const res = await fetch(`/api/canvases/${canvasId}/nodes/${id}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify(patch),
        })
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to save')
        const { node } = await res.json()
        setNodes((prev) => sortNodes(prev.map((n) => (n.id === id ? node : n))))
        pingDirty()
        return true
      } catch (err) {
        // Restore the pre-gesture geometry. Silently keeping the local value
        // would show the user a position the server never accepted.
        if (before) setNodes((prev) => prev.map((n) => (n.id === id ? before : n)))
        setError((err as Error).message)
        return false
      } finally {
        markInflight(id, -1)
      }
    },
    // `nodes` is deliberately absent: it is read through nodesRef instead, so
    // this callback keeps a stable identity across the hundreds of setNodes
    // calls a single drag produces. Depending on the array would re-create
    // every consumer — including the canvas's window key listeners — per frame.
    [canvasId, headers, markInflight, pingDirty]
  )

  const deleteNode = useCallback(
    async (id: string): Promise<boolean> => {
      if (!canvasId) return false
      // Keep only the ONE node for rollback, not a snapshot of the whole array.
      // Deleting a multi-node selection fires these concurrently, and restoring
      // a whole stale array would resurrect siblings that a sibling call had
      // already successfully deleted.
      const removed = nodesRef.current.find((n) => n.id === id)
      setNodes((prev) => prev.filter((n) => n.id !== id))
      markInflight(id, 1)
      try {
        const res = await fetch(`/api/canvases/${canvasId}/nodes/${id}`, {
          method: 'DELETE',
          headers,
        })
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to delete')
        pingDirty()
        return true
      } catch (err) {
        if (removed) setNodes((prev) => sortNodes([...prev.filter((n) => n.id !== id), removed]))
        setError((err as Error).message)
        return false
      } finally {
        markInflight(id, -1)
      }
    },
    [canvasId, headers, markInflight, pingDirty]
  )

  // ---------------------------------------------------------------------------
  // Multiplayer.
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!canvasId || !realtimeEnabled) return

    // Broadcast channel: ephemeral, and the ONLY live signal a guest gets.
    // Account holders join it too, to send the ping.
    const live = supabase
      .channel(`canvas-live:${canvasId}`)
      .on('broadcast', { event: 'canvas-dirty' }, () => {
        // Only guests act on it — everyone else has postgres_changes below, and
        // acting on both would mean a full refetch after every remote keystroke.
        if (guestToken) scheduleRefetch()
      })
      .subscribe()
    liveChannelRef.current = live

    // postgres_changes, filtered server-side by canvas_id. Without the filter we
    // would receive every canvas node change in the entire database and discard
    // most of them client-side.
    const changes = guestToken
      ? null
      : supabase
          .channel(`canvas-nodes:${canvasId}`)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'canvas_nodes', filter: `canvas_id=eq.${canvasId}` },
            (payload: RealtimeCanvasPayload) => {
              if (payload.eventType === 'DELETE') {
                // REPLICA IDENTITY FULL (migration 036) means old carries the
                // whole row, not just the key, so the id is always present.
                const goneId = payload.old?.id
                if (goneId) setNodes((prev) => prev.filter((n) => n.id !== goneId))
                return
              }
              const row = payload.new
              if (!row?.id) return
              const incoming = transformNode(row as CanvasNodeRow)

              // Never let a remote echo overwrite a node the user is holding, or
              // one with a write still in the air.
              if (gestureRef.current.has(incoming.id)) {
                // The user is holding this node. Their pointer wins for now,
                // and the commit at the end of the gesture is what settles it.
                staleRef.current.add(incoming.id)
                return
              }
              if (inflightRef.current.has(incoming.id)) {
                staleRef.current.add(incoming.id)
                return
              }

              setNodes((prev) => {
                const existing = prev.find((n) => n.id === incoming.id)
                if (!existing) return sortNodes([...prev, incoming])
                // Drop an event that is older than what we already show. Events
                // can arrive out of order after a reconnect, and applying a
                // stale one would resurrect a position the author has already
                // moved away from. updated_at is set by a database trigger, so
                // this compares server time, not client clocks.
                if (incoming.updatedAt < existing.updatedAt) return prev
                return sortNodes(prev.map((n) => (n.id === incoming.id ? incoming : n)))
              })
            }
          )
          .subscribe()

    return () => {
      if (refetchTimerRef.current) {
        clearTimeout(refetchTimerRef.current)
        refetchTimerRef.current = null
      }
      liveChannelRef.current = null
      supabase.removeChannel(live)
      if (changes) supabase.removeChannel(changes)
    }
  }, [canvasId, guestToken, realtimeEnabled, scheduleRefetch])

  return {
    nodes,
    loading,
    error,
    clearError: useCallback(() => setError(null), []),
    reload: load,
    createNode,
    commitNode,
    deleteNode,
    previewNode,
    beginGesture,
    endGesture,
  }
}
