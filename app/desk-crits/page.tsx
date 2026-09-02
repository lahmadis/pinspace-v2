'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import AvatarMenu from '@/components/AvatarMenu'
import { ChromeBar, SHELL_COLUMN } from '@/components/dashboard/ChromeNav'
import { useDashboardChrome } from '@/hooks/useDashboardChrome'
import { useDeskCrits } from '@/hooks/useDeskCrits'
import { useDirectUpload } from '@/lib/useDirectUpload'
import { useSpeechTranscription } from '@/hooks/useSpeechTranscription'
import { isPermanentFailure, unavailableMessage } from '@/lib/transcription/types'
import { isCanvasImage, readImageSize, rejectionReason } from '@/lib/canvas/imageNode'
import {
  CRIT_PHASES,
  DEFAULT_CRIT_PHASE,
  MAX_CRIT_PHASE_LENGTH,
} from '@/lib/constants/critPhases'
import CritColumn from '@/components/desk/CritColumn'

/** The row that swaps the select for a text box. See NewCritPicker. */
const ADD_NEW = ' add-new'

/**
 * Pick one you already have, or name a new one.
 *
 * Both questions the new-crit dialog asks are the same shape: a short list that
 * GROWS BY USE. Projects and phases are not fixed vocabularies — they are
 * whatever this person has typed so far — so neither a plain select (which can
 * only offer what exists) nor a plain text field (which makes you retype
 * "Quincy Center Mixed-Use" every week, and spell it the same way each time)
 * is right on its own.
 *
 * A select of what you have, with one row at the bottom that turns into a text
 * box. Whatever you type there is stored on the crit, and because both lists
 * are DERIVED from the crits you already have, it is in the dropdown the next
 * time by itself — nothing has to be registered anywhere.
 */
function NewCritPicker({
  label,
  options,
  value,
  onChange,
  addLabel,
  placeholder,
  emptyLabel,
  maxLength,
  disabled,
}: {
  label: string
  /** What has been used before. May be empty on a first crit. */
  options: string[]
  value: string
  onChange: (value: string) => void
  addLabel: string
  placeholder: string
  /** Offered as a real choice when the field is optional. Omit to require one. */
  emptyLabel?: string
  maxLength: number
  disabled?: boolean
}) {
  // Starts in the text box when there is nothing to pick from yet: a dropdown
  // whose only row is "add a new one" is a button wearing a select's clothes.
  const [typing, setTyping] = useState(options.length === 0)

  if (typing) {
    return (
      <div>
        <label className="block text-[11px] font-bold tracking-[0.12em] uppercase text-[#8A8FA0]">
          {label}
        </label>
        <input
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
          disabled={disabled}
          className="mt-1.5 w-full rounded-xl border border-[#16181D]/[0.12] px-3 py-2.5 text-sm text-[#16181D] focus:outline-none focus:ring-2 focus:ring-[#3B6EF6]"
        />
        {options.length > 0 && (
          <button
            type="button"
            onClick={() => { onChange(options[0]); setTyping(false) }}
            className="mt-1.5 text-[11px] font-semibold text-[#3B6EF6] hover:underline"
          >
            Pick an existing one instead
          </button>
        )}
      </div>
    )
  }

  return (
    <div>
      <label className="block text-[11px] font-bold tracking-[0.12em] uppercase text-[#8A8FA0]">
        {label}
      </label>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => {
          if (e.target.value === ADD_NEW) {
            onChange('')
            setTyping(true)
            return
          }
          onChange(e.target.value)
        }}
        className="mt-1.5 w-full rounded-xl border border-[#16181D]/[0.12] bg-white px-3 py-2.5 text-sm text-[#16181D] focus:outline-none focus:ring-2 focus:ring-[#3B6EF6]"
      >
        {emptyLabel && <option value="">{emptyLabel}</option>}
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
        <option value={ADD_NEW}>{addLabel}</option>
      </select>
    </div>
  )
}

/**
 * Your desk: every desk crit you have, side by side.
 *
 * A crit is one canvas row (migration 038 made those personal). There is no
 * separate "desk" record — you have one desk and this page is it, which is why
 * the header counts crits rather than naming a desk.
 *
 * Each card carries its own actions. Writes go straight to the API
 * rather than through the focused column's hooks, because those hooks live
 * inside the column component and there is no legal way to reach into one from
 * here. The column is told to reload by a per-crit nonce instead.
 */

export default function DeskPage() {
  // The bar's own data — organisation, admin flag, scope navigation, sign out.
  // The same hook /archive was written for; this page is the second thing
  // sitting beside the dashboard and now wears the same chrome.
  const { user, isAdmin, organization, onScopeChange, onSignOut } = useDashboardChrome()
  const {
    crits, loading, error, clearError, createCrit, deleteCrit,
    setCritPhase, setCritProject,
  } = useDeskCrits()
  const { upload } = useDirectUpload()
  const speech = useSpeechTranscription()

  const [activeCritId, setActiveCritId] = useState<string | null>(null)
  /**
   * The crit blown up to fill the page, if any.
   *
   * Side-by-side cards are the right shape for "which crit was that?" and the
   * wrong one for working in one: four crits share the width, every sheet is a
   * thumbnail, and the one you are actually in is no bigger than the three you
   * are not. Expanding hides the others outright rather than widening this one
   * — a wide card in a scroller is still a card in a scroller.
   */
  const [expandedCritId, setExpandedCritId] = useState<string | null>(null)
  /** The "which phase?" step of creating a crit. */
  const [phasePickerOpen, setPhasePickerOpen] = useState(false)
  /** Filters over the crit list: phase, and a date range. */
  const [phaseFilter, setPhaseFilter] = useState('')
  const [projectFilter, setProjectFilter] = useState('')
  /** What the create dialog's project field is holding. */
  const [newProject, setNewProject] = useState('')
  /** And its phase. Both are picked before the crit exists — see handleCreate. */
  const [newPhase, setNewPhase] = useState<string>(DEFAULT_CRIT_PHASE)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  /** Per-crit reload nonce; see the note above. */
  const [refreshKeys, setRefreshKeys] = useState<Record<string, number>>({})
  /** The crit currently being recorded into, if any. */
  const [recordingCritId, setRecordingCritId] = useState<string | null>(null)
  /** An open inline composer for a note or a next step. */
  const [composer, setComposer] = useState<{ critId: string; kind: 'note' | 'step' } | null>(null)
  /**
   * The crit awaiting a delete confirmation, if any.
   *
   * Confirmed rather than undoable: the row cascades to canvas_nodes, so the
   * transcript, the summary, the next steps and every pinned sheet go with it
   * and there is nothing left to restore from. Title is held alongside the id
   * so the prompt can name what is about to go.
   */
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null)
  const [deleting, setDeleting] = useState(false)

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  /**
   * Which of the two the pending file picker is filling.
   *
   * Sheets and references take different paths now: a SHEET becomes a real
   * board (so the lightbox can open it, and a trace or callout can stick to
   * it), while a REFERENCE stays a canvas_node image — something you brought
   * to look at, not work to be marked up. One <input> serves both, so it has
   * to be told which before it opens.
   */
  const pickKindRef = useRef<'sheet' | 'reference'>('sheet')
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
  const uploadInto = useCallback(
    async (critId: string, files: File[]) => {
      const images = files.filter(isCanvasImage)
      const refused = files.filter((f) => !isCanvasImage(f))
      if (refused.length > 0) setProblem(rejectionReason(refused[0]))
      if (images.length === 0) return

      setBusy('pin')
      try {
        for (const file of images) {
          // Bytes go straight to storage, same as every other upload path; the
          // API call after it writes the BOARD row and links it to this crit.
          // A crit sheet is a real board now (migration 042) — that is what
          // lets the lightbox open it and lets a trace or a callout stick to
          // it, neither of which a canvas node could carry.
          const size = await readImageSize(file)
          const result = await upload(file)
          const res = await fetch(`/api/canvases/${critId}/boards`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fullImageUrl: result.fullUrl,
              thumbnailUrl: result.thumbnailUrl,
              title: file.name,
              width: size?.width,
              height: size?.height,
            }),
          })
          if (!res.ok) throw new Error('Could not add that sheet to the crit')
        }
        bump(critId)
      } catch (err) {
        setProblem((err as Error).message || 'Upload failed')
      } finally {
        setBusy(null)
      }
    },
    [upload, bump]
  )

  /** A reference image: stored as a canvas node, the way notes are. */
  const addReference = useCallback(
    async (critId: string, files: File[]) => {
      const images = files.filter(isCanvasImage)
      const refused = files.filter((f) => !isCanvasImage(f))
      if (refused.length > 0) setProblem(rejectionReason(refused[0]))
      if (images.length === 0) return

      setBusy('reference')
      try {
        for (const file of images) {
          const result = await upload(file)
          await addNode(critId, {
            type: 'image',
            // x/y/w/h are vestigial — they positioned a node on the canvas that
            // no longer exists. Sent because the column is NOT NULL, not
            // because anything reads them.
            x: 0,
            y: 0,
            w: 320,
            h: 320,
            props: {
              url: result.fullUrl,
              thumbUrl: result.thumbnailUrl,
              storagePath: result.storagePath,
              thumbPath: result.thumbnailPath,
              name: file.name,
            },
          })
        }
      } catch (err) {
        setProblem((err as Error).message || 'Upload failed')
      } finally {
        setBusy(null)
      }
    },
    [addNode, upload]
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

  /**
   * Create the crit the phase picker is holding.
   *
   * The phase is asked BEFORE the crit exists rather than set on the card
   * afterwards, because "what stage is this?" is the one thing you reliably
   * know at the moment you make one — you are about to have the crit — and it
   * is the thing nobody goes back to fill in later.
   */
  const handleCreate = async () => {
    const phase = newPhase.trim() || DEFAULT_CRIT_PHASE
    setCreating(true)
    const today = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    const project = newProject.trim()
    // The project leads the title when there is one: a term of crits all
    // called "Concept — Sep 9" is the problem the project field exists to fix.
    const title = project ? `${project} — ${phase}` : `${phase} — ${today}`
    const crit = await createCrit(title, phase, project)
    setCreating(false)
    setPhasePickerOpen(false)
    setNewProject('')
    setNewPhase(DEFAULT_CRIT_PHASE)
    if (crit) {
      setActiveCritId(crit.id)
      // Scroll it into view; a new column appended off-screen looks like
      // nothing happened.
      requestAnimationFrame(() => columnRefs.current[crit.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
    }
  }


  const filtersActive = Boolean(phaseFilter || projectFilter)

  /**
   * Every project this person has used, for the filter and the create dialog.
   *
   * Derived from the crits already loaded rather than fetched: there is no
   * projects table (see migration 044), and the list of projects you have used
   * IS the set of names on your crits. Deduped case-insensitively so "Quincy
   * center" and "Quincy Center" collapse, keeping the first spelling seen.
   */
  const projects = useMemo(() => {
    const seen = new Map<string, string>()
    for (const c of crits) {
      const name = c.project?.trim()
      if (!name) continue
      const key = name.toLowerCase()
      if (!seen.has(key)) seen.set(key, name)
    }
    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b))
  }, [crits])

  /**
   * Every phase the filter can offer: the suggested list, plus any label
   * someone typed into a card's "Other…" box.
   *
   * Without the second half a crit filed under its own phase name is
   * unreachable from up here — the filter would list ten phases that between
   * them do not cover the crits on screen. Deduped case-insensitively for the
   * same reason projects are, though normaliseCritPhase already folds a typed
   * "final review" back onto the listed spelling before it is stored.
   */
  const phaseOptions = useMemo(() => {
    const known = new Set<string>(CRIT_PHASES.map((p) => p.toLowerCase()))
    const extra = new Map<string, string>()
    for (const c of crits) {
      const name = c.phase?.trim()
      if (!name) continue
      const key = name.toLowerCase()
      if (known.has(key) || extra.has(key)) continue
      extra.set(key, name)
    }
    return [
      ...CRIT_PHASES,
      ...Array.from(extra.values()).sort((a, b) => a.localeCompare(b)),
    ]
  }, [crits])

  /**
   * The crits actually on screen.
   *
   * Project and phase only. The date-range pair that used to sit beside them is
   * gone: between them these two already say which work and how far along, and
   * a crit is found by what it was about rather than by the fortnight it fell
   * in. (Its local-day comparison is gone with it — a real trap, since
   * createdAt is UTC and a date picker's value is not, but not one worth
   * keeping a control for.)
   */
  const visibleCrits = useMemo(() => {
    if (!filtersActive) return crits
    return crits.filter((c) => {
      if (phaseFilter && c.phase !== phaseFilter) return false
      if (projectFilter && (c.project ?? '') !== projectFilter) return false
      return true
    })
  }, [crits, filtersActive, phaseFilter, projectFilter])

  const speechBlocked = speech.unavailable !== null && isPermanentFailure(speech.unavailable)

  return (
    <div className="flex flex-col h-screen bg-[#F4F6FA]">
      {/* ---------------- top bar ---------------- */}
      {/* The dashboard's bar, not a header of this page's own.
          It was a full-bleed white strip with a back arrow, "Your Desk" and a
          "PRIVATE TO YOU · 2 DESK CRITS" subtitle — a different chrome one
          click from the dashboard, reached by a tab that then vanished. The
          lockup is shared now (components/dashboard/ChromeNav), so the Desk
          crits tab is simply the selected one and the way back is the same set
          of tabs that got you here.

          The title went with it. "Your Desk" restated the selected tab, and
          the crit count restated a screen full of crits. */}
      <ChromeBar
        // No scope is current here — this page is not one. Desk Crits carries
        // the selection instead; see ChromeNav.
        currentScope={null}
        onScopeChange={onScopeChange}
        hasOrganization={Boolean(organization)}
        orgLabel={organization?.name?.split(' ')[0] || 'Network'}
        brand={null}
      >
        <>
          {/* Everything you can DO. ChromeBar right-aligns whatever it is
              handed, so this is just the contents, in the same order and the
              same shapes as the dashboard's: the page's own controls, then the
              primary action, then the account.

              Filters live here, where a row of dates used to be. Those chips
              scrolled to a crit and did nothing else — a table of contents for
              a list that already fits on screen, naming crits by a date two of
              which were the same day. Filtering is what the space was actually
              worth. */}
          {projects.length > 0 && (
              <select
                value={projectFilter}
                onChange={(e) => setProjectFilter(e.target.value)}
                aria-label="Filter by project"
                className="rounded-xl border border-[#16181D]/[0.12] bg-white px-3 py-2 text-sm font-semibold text-[#16181D] focus:outline-none focus:ring-2 focus:ring-[#3B6EF6]"
              >
                <option value="">All Projects</option>
                {projects.map((project) => (
                  <option key={project} value={project}>
                    {project}
                  </option>
                ))}
              </select>
            )}

            <select
              value={phaseFilter}
              onChange={(e) => setPhaseFilter(e.target.value)}
              aria-label="Filter by phase"
              className="rounded-xl border border-[#16181D]/[0.12] bg-white px-3 py-2 text-sm font-semibold text-[#16181D] focus:outline-none focus:ring-2 focus:ring-[#3B6EF6]"
            >
              <option value="">All Phases</option>
              {phaseOptions.map((phase) => (
                <option key={phase} value={phase}>
                  {phase}
                </option>
              ))}
            </select>

            {filtersActive && (
              <button
                type="button"
                onClick={() => {
                  setPhaseFilter('')
                  setProjectFilter('')
                }}
                className="rounded-xl border border-[#16181D]/[0.12] px-3 py-2 text-sm font-semibold text-[#5A5E6B] transition-colors hover:bg-[#16181D]/[0.04]"
              >
                Clear
              </button>
            )}

            <button
              type="button"
              onClick={() => setPhasePickerOpen(true)}
              disabled={creating}
              // Same black primary the dashboard's create button uses, so the
              // two bars have one "the main action here" and not two colours.
              className="flex shrink-0 items-center gap-1.5 rounded-xl bg-[#16181D] px-3.5 py-2 text-sm font-bold text-white transition-colors hover:bg-[#3B6EF6] disabled:opacity-60"
            >
              <Plus className="h-4 w-4" />
              {creating ? 'Adding…' : 'New Crit'}
            </button>

          <AvatarMenu email={user?.email} isAdmin={isAdmin} onSignOut={onSignOut} />
        </>
      </ChromeBar>

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
        {/* ---------------- the crits ---------------- */}
        {/* The same centred column the dashboard uses, so the crit cards sit
            under the tabs rather than running the full width of the monitor. */}
        <div ref={scrollerRef} className="flex-1 overflow-y-auto pb-8 pt-5">
          <div className={SHELL_COLUMN}>
          {loading && crits.length === 0 ? (
            <div className="flex gap-5">
              {[0, 1, 2].map((i) => (
                <div key={i} className="w-[420px] h-[420px] rounded-2xl bg-white/60 animate-pulse" />
              ))}
            </div>
          ) : visibleCrits.length === 0 && filtersActive ? (
            <div className="h-full flex flex-col items-center justify-center text-center">
              <h2 className="text-lg font-bold text-[#16181D] mb-2">No crits match</h2>
              <p className="text-sm text-[#5A5E6B] max-w-sm mb-5">
                {crits.length} desk crit{crits.length === 1 ? '' : 's'} here, none matching those filters.
              </p>
              <button
                type="button"
                onClick={() => {
                  setPhaseFilter('')
                  setProjectFilter('')
                }}
                className="px-4 py-2.5 rounded-xl border border-[#16181D]/12 text-sm font-semibold text-[#5A5E6B] hover:bg-[#16181D]/4"
              >
                Clear filters
              </button>
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
                onClick={() => setPhasePickerOpen(true)}
                disabled={creating}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#3B6EF6] text-white text-sm font-semibold hover:bg-[#2F5BD4] disabled:opacity-60"
              >
                <Plus className="w-4 h-4" />
                New Crit
              </button>
            </div>
          ) : (
            /*
             * A wrapping grid, capped at five across — not a row that scrolls
             * sideways.
             *
             * The old layout put every crit on one line, so a term's worth of
             * them ran off the right of the screen and the only way to reach an
             * older one was to scroll past everything newer. Wrapping trades
             * that for downward scrolling, which is the direction a page is
             * already read in, and the cap is what stops the cards shrinking to
             * nothing on a wide monitor: past five across, a crit card is
             * narrower than the sheets inside it.
             *
             * Expanded is a single full-width card, so it drops the grid.
             */
            <div
              className={
                expandedCritId
                  ? 'flex'
                  : 'grid gap-5 items-start grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5'
              }
            >
              {(expandedCritId ? visibleCrits.filter((c) => c.id === expandedCritId) : visibleCrits).map((crit) => (
                <div
                  key={crit.id}
                  className={expandedCritId === crit.id ? 'w-full max-w-5xl mx-auto' : undefined}
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
                    expanded={expandedCritId === crit.id}
                    onToggleExpand={() => {
                      setActiveCritId(crit.id)
                      setExpandedCritId((prev) => (prev === crit.id ? null : crit.id))
                    }}
                    onPin={() => {
                      setActiveCritId(crit.id)
                      pickKindRef.current = 'sheet'
                      fileInputRef.current?.click()
                    }}
                    onReference={() => {
                      setActiveCritId(crit.id)
                      pickKindRef.current = 'reference'
                      fileInputRef.current?.click()
                    }}
                    onNote={() => setComposer({ critId: crit.id, kind: 'note' })}
                    onStep={() => setComposer({ critId: crit.id, kind: 'step' })}
                    onToggleRecording={() => toggleRecording(crit.id)}
                    onPhaseChange={(phase) => void setCritPhase(crit.id, phase)}
                    phases={phaseOptions}
                    projects={projects}
                    onProjectChange={(project) => void setCritProject(crit.id, project)}
                    onDelete={() => setPendingDelete({ id: crit.id, title: crit.title })}
                    recording={listening && recordingCritId === crit.id}
                    busy={busy !== null && activeCritId === crit.id}
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
            if (pickKindRef.current === 'reference') void addReference(activeCrit.id, files)
            else void uploadInto(activeCrit.id, files)
          }
        }}
      />

      {/* Which phase? The one question asked before a crit exists.
          A list of buttons rather than a <select> + Create: picking IS the
          create, so a second confirming press would be asking twice. */}
      {phasePickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#16181D]/30 p-4"
          onClick={() => setPhasePickerOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-3xl bg-white p-6 shadow-[0_30px_90px_rgba(22,24,29,0.3)]"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="New desk crit"
          >
            {/* The date, and nothing else, at the top.
                It used to be a heading — "What phase is this crit?" — with the
                date as its subtitle, which asked one of the dialog's two
                questions in the title and left the other unannounced. Both are
                labelled fields below now, so the top of the dialog is free to
                say the one thing that is not a question: which day this crit
                is. */}
            <p className="text-[17px] font-extrabold tracking-[-0.02em] text-[#16181D]">
              {new Date().toLocaleDateString(undefined, {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })}
            </p>

            <div className="mt-4 space-y-4">
              <NewCritPicker
                label="Project"
                options={projects}
                value={newProject}
                onChange={setNewProject}
                addLabel="+ New Project…"
                placeholder="e.g. Quincy Center Mixed-Use"
                // A crit does not have to belong to a project, so "No Project"
                // is a real choice rather than an empty field you leave alone.
                emptyLabel="No Project"
                maxLength={120}
                disabled={creating}
              />

              <NewCritPicker
                label="Phase"
                // The suggested list plus anything already typed, so a studio's
                // own phase is a pick the second time it is used. Same set the
                // header's filter offers.
                options={phaseOptions}
                value={newPhase}
                onChange={setNewPhase}
                addLabel="+ New Phase…"
                placeholder="e.g. Interim pin-up"
                maxLength={MAX_CRIT_PHASE_LENGTH}
                disabled={creating}
              />
            </div>

            {/* Creating is its own press now. Picking a phase used to BE the
                create, which is why the phases were ten buttons; with the phase
                a field like the project, there has to be something to say
                "done" with. */}
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setPhasePickerOpen(false)
                  setNewProject('')
                  setNewPhase(DEFAULT_CRIT_PHASE)
                }}
                disabled={creating}
                className="flex-1 px-4 py-2.5 rounded-xl border border-[#16181D]/[0.12] text-sm font-semibold text-[#5A5E6B] hover:bg-[#16181D]/5 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleCreate()}
                disabled={creating || !newPhase.trim()}
                className="flex-1 px-4 py-2.5 rounded-xl bg-[#3B6EF6] text-sm font-bold text-white transition-colors hover:bg-[#2F5BD4] disabled:opacity-50"
              >
                {creating ? 'Adding…' : 'Create crit'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation. A modal rather than an inline two-step because
          this is not recoverable: the canvas row cascades to its nodes, so the
          transcript, summary, next steps and pinned sheets all go at once. */}
      {pendingDelete && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-crit-title"
          onClick={() => { if (!deleting) setPendingDelete(null) }}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white shadow-2xl border border-[#16181D]/10 p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="delete-crit-title" className="text-base font-bold text-[#16181D]">
              Delete this crit?
            </h2>
            <p className="mt-2 text-sm text-[#5A5E6B]">
              <span className="font-semibold text-[#16181D]">{pendingDelete.title}</span> and
              everything on it — the transcript, the summary, any next steps and every pinned
              sheet — will be removed. This can&rsquo;t be undone.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                disabled={deleting}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-[#5A5E6B] hover:bg-[#16181D]/5 disabled:opacity-60 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  setDeleting(true)
                  // deleteCrit removes it optimistically and puts it back at
                  // its old index if the request fails, surfacing the reason
                  // through the hook's error — which the banner above already
                  // renders, so there is nothing to report here.
                  const ok = await deleteCrit(pendingDelete.id)
                  setDeleting(false)
                  setPendingDelete(null)
                  if (ok) {
                    // Focus follows the list, not the deleted row.
                    setActiveCritId((prev) => (prev === pendingDelete.id ? null : prev))
                  }
                }}
                disabled={deleting}
                className="px-4 py-2 rounded-xl bg-[#D64545] text-white text-sm font-semibold hover:bg-[#B93A3A] disabled:opacity-60 transition-colors"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
