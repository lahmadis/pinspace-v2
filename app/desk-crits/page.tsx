'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Plus } from 'lucide-react'
import { useDeskCrits, type DeskCrit } from '@/hooks/useDeskCrits'
import { useDirectUpload } from '@/lib/useDirectUpload'
import { useSpeechTranscription } from '@/hooks/useSpeechTranscription'
import { isPermanentFailure, unavailableMessage } from '@/lib/transcription/types'
import { fitPlacedSize, isCanvasImage, readImageSize, rejectionReason } from '@/lib/canvas/imageNode'
import { critChipDate } from '@/lib/desk/zones'
import type { DeskZone } from '@/lib/desk/zones'
import DeskToolRail, { type DeskTool } from '@/components/desk/DeskToolRail'
import CritColumn from '@/components/desk/CritColumn'

/**
 * Your desk: every desk crit you have, side by side.
 *
 * A crit is one canvas row (migration 038 made those personal). There is no
 * separate "desk" record — you have one desk and this page is it, which is why
 * the header counts crits rather than naming a desk.
 *
 * The tool rail acts on the FOCUSED column. Writes go straight to the API
 * rather than through the focused column's hooks, because those hooks live
 * inside the column component and there is no legal way to reach into one from
 * here. The column is told to reload by a per-crit nonce instead.
 */
/** Gap between pinned sheets on the crit canvas, in canvas units. */
const PIN_GAP = 40
/** Private references sit on their own row, clear of the pinned work. */
const PRIVATE_ROW_Y = 720

export default function DeskPage() {
  const router = useRouter()
  const { crits, loading, error, clearError, createCrit } = useDeskCrits()
  const { upload } = useDirectUpload()
  const speech = useSpeechTranscription()

  const [tool, setTool] = useState<DeskTool>('select')
  const [activeCritId, setActiveCritId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  /** Per-crit reload nonce; see the note on the tool rail above. */
  const [refreshKeys, setRefreshKeys] = useState<Record<string, number>>({})
  /** The crit currently being recorded into, if any. */
  const [recordingCritId, setRecordingCritId] = useState<string | null>(null)
  /** An open inline composer for a note or a next step. */
  const [composer, setComposer] = useState<{ critId: string; kind: 'note' | 'step' } | null>(null)

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  /** Which zone the pending file picker is filling. */
  const pickZoneRef = useRef<DeskZone>('shared')
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const columnRefs = useRef<Record<string, HTMLDivElement | null>>({})

  // Focus the newest crit once the list arrives, so the tools have a target
  // without the user having to know they must click one first.
  useEffect(() => {
    if (activeCritId || crits.length === 0) return
    setActiveCritId(crits[0].id)
  }, [crits, activeCritId])

  const bump = useCallback((critId: string) => {
    setRefreshKeys((prev) => ({ ...prev, [critId]: (prev[critId] ?? 0) + 1 }))
  }, [])

  const activeCrit = crits.find((c) => c.id === activeCritId) ?? null

  // ---------------------------------------------------------------------------
  // Writes. Each hits the API for the focused crit, then bumps that column.
  // ---------------------------------------------------------------------------

  const addNode = useCallback(
    async (critId: string, body: Record<string, unknown>) => {
      const res = await fetch(`/api/canvases/${critId}/nodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: crypto.randomUUID(), ...body }),
      })
      if (!res.ok) {
        throw new Error((await res.json().catch(() => ({}))).error || 'Could not add that')
      }
      bump(critId)
    },
    [bump]
  )

  const addNote = useCallback(
    async (critId: string, text: string) => {
      if (!text.trim()) return
      setBusy('note')
      try {
        await addNode(critId, {
          type: 'sticky',
          x: 0,
          y: 0,
          w: 240,
          h: 120,
          props: { text: text.trim(), zone: 'private' },
        })
      } catch (err) {
        setProblem((err as Error).message)
      } finally {
        setBusy(null)
      }
    },
    [addNode]
  )

  const addStep = useCallback(
    async (critId: string, title: string) => {
      if (!title.trim()) return
      setBusy('steps')
      try {
        const res = await fetch(`/api/canvases/${critId}/deliverables`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: [{ title: title.trim() }] }),
        })
        if (!res.ok) {
          throw new Error((await res.json().catch(() => ({}))).error || 'Could not add that step')
        }
        bump(critId)
      } catch (err) {
        setProblem((err as Error).message)
      } finally {
        setBusy(null)
      }
    },
    [bump]
  )

  /**
   * Where the next pinned item goes, in canvas units.
   *
   * Reads what the crit already holds rather than counting locally: this page
   * does not own the node list (each column does), and a stale count would
   * stack a new upload on an existing sheet.
   */
  const nextFreeX = useCallback(async (critId: string, zone: DeskZone): Promise<number> => {
    try {
      const res = await fetch(`/api/canvases/${critId}/nodes`, { cache: 'no-store' })
      if (!res.ok) return 0
      const { nodes } = await res.json()
      const inZone = ((nodes || []) as Array<{ x: number; w: number; props?: Record<string, unknown> }>)
        .filter((n) => (n.props?.zone === 'shared' ? 'shared' : 'private') === zone)
      if (inZone.length === 0) return 0
      return Math.max(...inZone.map((n) => (n.x ?? 0) + (n.w ?? 0))) + PIN_GAP
    } catch {
      // A failed read must not block the upload; landing at the origin is
      // recoverable by dragging, losing the upload is not.
      return 0
    }
  }, [])

  const uploadInto = useCallback(
    async (critId: string, zone: DeskZone, files: File[]) => {
      const images = files.filter(isCanvasImage)
      const refused = files.filter((f) => !isCanvasImage(f))
      if (refused.length > 0) setProblem(rejectionReason(refused[0]))
      if (images.length === 0) return

      setBusy(zone === 'shared' ? 'pin' : 'photo')
      try {
        // Laid out in a row rather than all at the origin.
        //
        // These nodes carry real canvas coordinates — the crit workspace view
        // draws them on the canvas — so creating every one at 0,0 stacked a
        // whole crit's work in one spot with only the top sheet visible. The
        // existing layout is read first so a second upload continues the row
        // rather than landing on the first.
        let cursorX = await nextFreeX(critId, zone)
        for (const file of images) {
          const size = await readImageSize(file)
          const box = size ? fitPlacedSize(size.width, size.height) : { w: 320, h: 320 }
          const result = await upload(file)
          await addNode(critId, {
            type: 'image',
            x: cursorX,
            y: zone === 'shared' ? 0 : PRIVATE_ROW_Y,
            w: box.w,
            h: box.h,
            props: {
              url: result.fullUrl,
              thumbUrl: result.thumbnailUrl,
              storagePath: result.storagePath,
              thumbPath: result.thumbnailPath,
              name: file.name,
              zone,
            },
          })
          cursorX += box.w + PIN_GAP
        }
      } catch (err) {
        setProblem((err as Error).message || 'Upload failed')
      } finally {
        setBusy(null)
      }
    },
    [addNode, nextFreeX, upload]
  )

  // ---------------------------------------------------------------------------
  // Voice. One recording at a time, into the crit that was focused when it
  // started — so scrolling to read another column mid-crit cannot redirect it.
  // ---------------------------------------------------------------------------

  const { flush, listening, stop: stopSpeech, start: startSpeech } = speech

  /**
   * Words taken off the recogniser but not yet stored — TAGGED with the crit
   * they belong to.
   *
   * flush() clears the recogniser's buffer, so a request that fails leaves
   * those words nowhere else. Holding them means the next save carries them
   * again rather than dropping part of a crit on a flaky connection.
   *
   * The crit id is the load-bearing part. Untagged, a failed save on one crit
   * followed by a recording into another prepended the first crit's words to
   * the second — the same words-leak the Stop bug caused, surviving in the
   * failure path.
   */
  const unsavedSpeechRef = useRef<{ critId: string; text: string } | null>(null)

  const saveSpeech = useCallback(
    async (critId: string) => {
      const held = unsavedSpeechRef.current
      // Only reuse held words that belong to THIS crit. Anything held for a
      // different one stays held for it.
      const carried = held && held.critId === critId ? held.text : ''
      const text = [carried, flush()].filter(Boolean).join(' ').trim()
      if (!text) return
      if (carried) unsavedSpeechRef.current = null

      // fetch has no timeout of its own, so a hung request would leave these
      // words in an unreachable closure: no error, no banner, no retry. The
      // sibling hook bounds its save for exactly this reason.
      const abort = new AbortController()
      const timer = setTimeout(() => abort.abort(), 20000)
      try {
        const res = await fetch(`/api/canvases/${critId}/transcript`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, source: 'web-speech' }),
          signal: abort.signal,
        })
        if (!res.ok) {
          throw new Error((await res.json().catch(() => ({}))).error || 'Could not save the recording')
        }
        bump(critId)
      } catch (err) {
        unsavedSpeechRef.current = { critId, text }
        const aborted = (err as Error).name === 'AbortError'
        setProblem(
          aborted
            ? "Saving that recording timed out — the words are held and will go with the next save."
            : `${(err as Error).message} — those words are held and will go with the next save.`
        )
      } finally {
        clearTimeout(timer)
      }
    },
    [bump, flush]
  )

  /**
   * Last-ditch save when the page goes away mid-crit.
   *
   * Leaving the desk while recording used to drop everything since the last
   * autosave, and the banner's promise that held words "go with the next save"
   * was untrue across a navigation. `keepalive` lets the request outlive the
   * document; fire-and-forget because there is nothing left to report to.
   */
  useEffect(() => {
    const rescue = () => {
      const held = unsavedSpeechRef.current
      const target = recordingCritId ?? held?.critId
      if (!target) return
      const carried = held && held.critId === target ? held.text : ''
      const text = [carried, flush()].filter(Boolean).join(' ').trim()
      if (!text) return
      unsavedSpeechRef.current = null
      void fetch(`/api/canvases/${target}/transcript`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, source: 'web-speech' }),
        keepalive: true,
      }).catch(() => {})
    }
    window.addEventListener('pagehide', rescue)
    return () => {
      window.removeEventListener('pagehide', rescue)
      rescue()
    }
  }, [flush, recordingCritId])

  // Write down whatever settled once recording ends, however it ended — the
  // Stop button, a denied microphone, or the recogniser giving up.
  useEffect(() => {
    if (listening || !recordingCritId || !speech.committed) return
    const critId = recordingCritId
    const timer = setTimeout(() => void saveSpeech(critId), 500)
    return () => clearTimeout(timer)
  }, [listening, recordingCritId, speech.committed, saveSpeech])

  // Periodic save during a long crit, so a crash costs at most twenty seconds.
  useEffect(() => {
    if (!listening || !recordingCritId) return
    const critId = recordingCritId
    const timer = setInterval(() => void saveSpeech(critId), 20000)
    return () => clearInterval(timer)
  }, [listening, recordingCritId, saveSpeech])

  const toggleRecording = useCallback(
    (critId: string) => {
      if (listening) {
        // recordingCritId is deliberately LEFT SET. The save effect above is
        // guarded on it, so clearing it here — as this used to — meant Stop
        // short-circuited that effect and the recording was never written: a
        // crit shorter than one autosave interval vanished entirely, and the
        // words left on the recogniser were then flushed into whichever crit
        // was recorded next. It is replaced on the next start instead.
        stopSpeech()
        return
      }
      setRecordingCritId(critId)
      startSpeech()
    },
    [listening, startSpeech, stopSpeech]
  )

  // ---------------------------------------------------------------------------

  const runTool = useCallback(
    (picked: DeskTool) => {
      setTool(picked)
      if (picked === 'select') return
      if (!activeCritId) {
        setProblem('Make a crit first, then pick a tool.')
        return
      }
      // Note and Next steps open an inline composer on the focused column
      // rather than a window.prompt. Once a browser shows "prevent this page
      // from creating additional dialogs" and the user ticks it, prompt()
      // returns null forever and both tools go silently dead for the session —
      // and a prompt cannot take a multi-line note anyway.
      if (picked === 'note') setComposer({ critId: activeCritId, kind: 'note' })
      if (picked === 'steps') setComposer({ critId: activeCritId, kind: 'step' })
      if (picked === 'voice') toggleRecording(activeCritId)
      if (picked === 'pin' || picked === 'photo') {
        pickZoneRef.current = picked === 'pin' ? 'shared' : 'private'
        fileInputRef.current?.click()
      }
    },
    [activeCritId, toggleRecording]
  )

  const submitComposer = useCallback(
    async (text: string) => {
      if (!composer) return
      const { critId, kind } = composer
      setComposer(null)
      if (kind === 'note') await addNote(critId, text)
      else await addStep(critId, text)
    },
    [addNote, addStep, composer]
  )

  const handleCreate = async () => {
    setCreating(true)
    const today = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    const crit = await createCrit(`Desk crit — ${today}`)
    setCreating(false)
    if (crit) {
      setActiveCritId(crit.id)
      // Scroll it into view; a new column appended off-screen looks like
      // nothing happened.
      requestAnimationFrame(() => columnRefs.current[crit.id]?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }))
    }
  }

  const jumpTo = (crit: DeskCrit) => {
    setActiveCritId(crit.id)
    columnRefs.current[crit.id]?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }

  const speechBlocked = speech.unavailable !== null && isPermanentFailure(speech.unavailable)

  return (
    <div className="flex flex-col h-screen bg-[#F4F6FA]">
      {/* ---------------- top bar ---------------- */}
      <header className="shrink-0 h-[72px] flex items-center gap-4 px-5 bg-white border-b border-[#16181D]/8">
        <button
          type="button"
          onClick={() => router.push('/dashboard')}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#16181D]/12 text-sm font-semibold text-[#5A5E6B] hover:bg-[#16181D]/4"
        >
          <ArrowLeft className="w-4 h-4" />
          Dashboard
        </button>

        <div className="min-w-0">
          <h1 className="text-lg font-extrabold text-[#16181D] leading-tight">Your desk</h1>
          <p className="text-[10px] font-bold tracking-[0.14em] uppercase text-[#8A8FA0]">
            Private to you · {crits.length} desk crit{crits.length === 1 ? '' : 's'}
          </p>
        </div>

        {/* Date chips — jump to a crit without dragging the scroller. */}
        <div className="ml-auto flex items-center gap-2 overflow-x-auto max-w-[46vw]">
          {crits.map((crit) => (
            <button
              key={crit.id}
              type="button"
              onClick={() => jumpTo(crit)}
              className={`shrink-0 px-3.5 py-2 rounded-full text-sm font-semibold border transition-colors ${
                crit.id === activeCritId
                  ? 'border-[#3B6EF6] text-[#3B6EF6] bg-[#3B6EF6]/6'
                  : 'border-[#16181D]/12 text-[#5A5E6B] hover:bg-[#16181D]/4'
              }`}
            >
              {critChipDate(crit.createdAt)}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={handleCreate}
          disabled={creating}
          className="shrink-0 flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#3B6EF6] text-white text-sm font-semibold hover:bg-[#2F5BD4] disabled:opacity-60 transition-colors"
        >
          <Plus className="w-4 h-4" />
          {creating ? 'Adding…' : 'New crit'}
        </button>
      </header>

      {(problem || error || (speech.unavailable && speechBlocked)) && (
        <button
          onClick={() => {
            setProblem(null)
            clearError()
          }}
          className="shrink-0 px-5 py-2.5 bg-[#F0A500]/10 border-b border-[#F0A500]/30 text-[12px] text-[#7A5400] text-left"
        >
          {problem ||
            error ||
            (speech.unavailable ? unavailableMessage(speech.unavailable) : '')}{' '}
          — dismiss
        </button>
      )}

      <div className="flex-1 flex min-h-0">
        <DeskToolRail
          active={tool}
          recording={listening}
          onPick={runTool}
          // Voice stays live during an upload: `busy` used to disable the whole
          // rail, which made Stop unreachable while a photo was uploading even
          // though the recording carried on.
          disabled={busy !== null}
          keepEnabled={listening ? ['voice'] : undefined}
        />

        {/* ---------------- the crits ---------------- */}
        <div ref={scrollerRef} className="flex-1 overflow-x-auto overflow-y-auto p-6">
          {loading && crits.length === 0 ? (
            <div className="flex gap-5">
              {[0, 1, 2].map((i) => (
                <div key={i} className="w-[420px] h-[420px] rounded-2xl bg-white/60 animate-pulse" />
              ))}
            </div>
          ) : crits.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center">
              <h2 className="text-lg font-bold text-[#16181D] mb-2">No desk crits yet</h2>
              <p className="text-sm text-[#5A5E6B] max-w-sm mb-5">
                Make one before your next crit. Pin the work you&rsquo;ll show, record what gets
                said, and keep the next steps in the same place.
              </p>
              <button
                type="button"
                onClick={handleCreate}
                disabled={creating}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#3B6EF6] text-white text-sm font-semibold hover:bg-[#2F5BD4] disabled:opacity-60"
              >
                <Plus className="w-4 h-4" />
                New crit
              </button>
            </div>
          ) : (
            <div className="flex gap-5 items-start">
              {crits.map((crit) => (
                <div
                  key={crit.id}
                  ref={(el) => {
                    columnRefs.current[crit.id] = el
                  }}
                >
                  <CritColumn
                    crit={crit}
                    isActive={crit.id === activeCritId}
                    onFocus={() => setActiveCritId(crit.id)}
                    refreshKey={refreshKeys[crit.id] ?? 0}
                    liveTranscript={
                      recordingCritId === crit.id
                        ? [speech.committed, speech.interim].filter(Boolean).join(' ')
                        : null
                    }
                    onOpen={() => router.push(`/desk-crits/${crit.id}`)}
                    composer={composer?.critId === crit.id ? composer.kind : null}
                    onComposerSubmit={submitComposer}
                    onComposerCancel={() => setComposer(null)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          // Reset first: picking the same file twice in a row fires no change
          // event otherwise, so the second attempt looks like nothing happened.
          e.target.value = ''
          if (files.length > 0 && activeCrit) {
            void uploadInto(activeCrit.id, pickZoneRef.current, files)
          }
        }}
      />
    </div>
  )
}
