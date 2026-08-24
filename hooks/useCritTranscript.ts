'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { TranscriptionSource } from '@/lib/transcription/types'

/**
 * How long a save may hang before it counts as failed.
 *
 * Not a nicety. The panel serialises saves behind a flag, so a request that
 * never settles latches that flag for the rest of the session: every later
 * save becomes a silent no-op, the final save never runs, and the retry button
 * stays disabled behind a permanent "Saving…". A dead connection produces
 * exactly that — fetch has no timeout of its own and will wait indefinitely.
 *
 * Generous, because the cost of giving up early is a duplicate paragraph if the
 * request actually lands, and the cost of not giving up is losing the crit.
 */
const SAVE_TIMEOUT_MS = 20000

/**
 * The stored transcript of one crit: load it, and append to it.
 *
 * Deliberately knows nothing about microphones. useSpeechTranscription produces
 * text; this persists it. Keeping them apart is what lets the provider change
 * without touching saving, and lets a pasted or typed transcript use the same
 * path — which is why `source` is a parameter rather than a constant.
 */

export interface TranscriptSegment {
  id: string
  text: string
  source: string
  recordedAt: string
}

/**
 * The hook's own return type.
 *
 * Exported because the transcript is owned ONE level above the panel that
 * records into it — the summary tab reads the same text, and two components
 * each calling this hook would mean two fetches and two diverging copies of
 * the same crit. The container calls it and passes this down.
 */
export type CritTranscript = ReturnType<typeof useCritTranscript>

export function useCritTranscript(canvasId: string | null) {
  const [segments, setSegments] = useState<TranscriptSegment[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const loadSeqRef = useRef(0)

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canvasId) {
        setSegments([])
        return
      }
      const seq = ++loadSeqRef.current
      setLoading(true)
      try {
        const res = await fetch(`/api/canvases/${canvasId}/transcript`, {
          cache: 'no-store',
          signal,
        })
        if (!res.ok) {
          throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load the transcript')
        }
        const { segments: rows } = await res.json()
        if (seq !== loadSeqRef.current) return
        setSegments((rows || []) as TranscriptSegment[])
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
   * Append one segment.
   *
   * Returns false on failure, and the CALLER keeps the text — see the panel,
   * which puts unsaved speech back rather than dropping it. An optimistic
   * insert here would be the wrong shape: the whole point of saving is that the
   * words survive, so showing them as saved when they aren't is the one lie
   * this feature must not tell.
   */
  const appendSegment = useCallback(
    async (text: string, source: TranscriptionSource, recordedAt?: string): Promise<boolean> => {
      if (!canvasId) return false
      const trimmed = text.trim()
      if (!trimmed) return false

      setSaving(true)
      const timeout = new AbortController()
      const timer = setTimeout(() => timeout.abort(), SAVE_TIMEOUT_MS)
      try {
        const res = await fetch(`/api/canvases/${canvasId}/transcript`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: trimmed, source, recordedAt }),
          signal: timeout.signal,
        })
        if (!res.ok) {
          throw new Error((await res.json().catch(() => ({}))).error || 'Failed to save what was said')
        }
        const { segment } = await res.json()
        setSegments((prev) => [...prev, segment as TranscriptSegment])
        setError(null)
        return true
      } catch (err) {
        // An abort here is the timeout above, never a caller cancelling — this
        // controller is local. Said in words the user can act on, because the
        // panel is about to show them the words it could not save.
        setError(
          (err as Error).name === 'AbortError'
            ? 'Saving timed out. The words below are still here — try again.'
            : (err as Error).message
        )
        return false
      } finally {
        clearTimeout(timer)
        setSaving(false)
      }
    },
    [canvasId]
  )

  /** The whole crit as one block of text — what the summary step reads. */
  const fullText = segments.map((s) => s.text).join('\n\n')

  return {
    segments,
    fullText,
    loading,
    saving,
    error,
    clearError: useCallback(() => setError(null), []),
    reload: load,
    appendSegment,
  }
}
