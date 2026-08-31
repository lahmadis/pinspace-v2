'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  ChevronDown,
  ImageIcon,
  ListChecks,
  Loader2,
  Maximize2,
  Minimize2,
  Mic,
  Pin,
  Sparkles,
  StickyNote,
  Trash2,
  X,
} from 'lucide-react'
import { useCanvasNodes } from '@/hooks/useCanvasNodes'
import { useCritBoards } from '@/hooks/useCritBoards'
import LightboxModal from '@/components/LightboxModal'
import type { Board } from '@/types'
import { useCritTranscript } from '@/hooks/useCritTranscript'
import { useCritSummary } from '@/hooks/useCritSummary'
import { summariseLocally } from '@/lib/summary/localSummary'
import { CRIT_PHASES, MAX_CRIT_PHASE_LENGTH } from '@/lib/constants/critPhases'
import type { DeskCrit } from '@/hooks/useDeskCrits'
import type { NodeProps } from '@/components/canvas/CanvasNodeView'

/**
 * One desk crit, as a column.
 *
 * Each column owns its own data hooks. That is deliberate and it is why this is
 * a component rather than a render function on the board: hooks cannot be
 * called in a loop, and a crit needs four of them (nodes, transcript, summary,
 * deliverables). One component per crit is what makes that legal, and it also
 * means a column re-renders on its own changes rather than the whole desk
 * re-rendering whenever anybody's checkbox moves.
 */
/**
 * One sheet on a crit card.
 *
 * Click opens it in the lightbox; the pin is a separate press. Pinning is the
 * gesture the whole card is built around — "we talked about this one" — set
 * while somebody is still speaking and read back afterwards against the
 * recording, so it has to be one tap and it has to be visible at a glance
 * without opening anything.
 */
function CritSheet({
  name,
  src,
  pinned,
  expanded,
  onOpen,
  onTogglePin,
  onRemove,
}: {
  name?: string
  src?: string
  pinned: boolean
  expanded: boolean
  onOpen: () => void
  onTogglePin: () => void
  onRemove: () => void
}) {
  /**
   * Two presses to delete, not one.
   *
   * Removing a sheet deletes the BOARD, and a board delete takes its image
   * bytes out of storage with it — there is no undo after the request, only
   * before. This button is small, hover-revealed and sits a few pixels from
   * the one that opens the sheet, which is the wrong cost for something
   * permanent. Arming turns it red and names what it is about to do.
   */
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    // Disarms itself, so a stray first click does not leave a live delete
    // sitting under the cursor indefinitely.
    const t = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(t)
  }, [armed])

  return (
    <div
      // Narrower than the 132px it was: a card is now a grid cell rather than a
      // 420px column, so at five across the old tile showed barely one sheet.
      className={`relative group rounded-lg overflow-hidden border bg-white ${
        expanded ? 'w-full' : 'w-[104px] shrink-0'
      } ${pinned ? 'border-[#3B6EF6] ring-1 ring-[#3B6EF6]/30' : 'border-[#16181D]/[0.10]'}`}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onOpen()
        }}
        title={`Open ${name || 'this sheet'} to trace and add callouts`}
        className={`block w-full ${expanded ? 'aspect-[4/3]' : 'h-[84px]'} bg-[#F0F3F9]`}
      >
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={name || 'Sheet'} className="w-full h-full object-cover" />
        ) : null}
      </button>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onTogglePin()
        }}
        aria-pressed={pinned}
        title={pinned ? 'Talked about — unpin' : 'Pin: we talked about this'}
        className={`absolute top-1 left-1 flex items-center justify-center w-6 h-6 rounded-full transition-colors ${
          pinned
            ? 'bg-[#3B6EF6] text-white'
            : 'bg-white/90 text-[#8A8FA0] opacity-0 group-hover:opacity-100 focus:opacity-100'
        }`}
      >
        <Pin className="w-3 h-3" />
      </button>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          if (!armed) {
            setArmed(true)
            return
          }
          onRemove()
        }}
        title={
          armed
            ? 'Click again to delete this sheet and its image for good'
            : `Remove ${name || 'this sheet'}`
        }
        className={`absolute top-1 right-1 flex items-center justify-center h-6 rounded-full transition-opacity ${
          armed
            ? 'px-2 bg-[#C2452D] text-white text-[10px] font-bold opacity-100'
            : 'w-6 bg-white/90 text-[#8A8FA0] hover:text-[#C2452D] opacity-0 group-hover:opacity-100 focus:opacity-100'
        }`}
      >
        {armed ? 'Delete?' : <X className="w-3 h-3" />}
      </button>

      {name && (
        <p className="px-2 py-1 text-[10px] text-[#5A5E6B] truncate" title={name}>
          {name}
        </p>
      )}
    </div>
  )
}

/**
 * The value of the dropdown row that opens the free-text box.
 *
 * A sentinel no value can collide with, rather than the empty string: '' is
 * already "none" on an unfiled crit, and somebody is perfectly entitled to name
 * a phase — or a project — "Other".
 */
const ADD_NEW = ' add-new'

/**
 * A crit's project or its phase: pick one you have, or name a new one.
 *
 * ONE component for both rows because they are the same question twice. Neither
 * is a fixed vocabulary — the phase list in critPhases.ts is a set of
 * suggestions, and projects are only ever whatever this person has typed — so a
 * plain select can offer only what exists and a plain text field makes you spell
 * "Quincy Center Mixed-Use" the same way every week. A select of what you have,
 * with a last row that turns into a text box, is both.
 *
 * Both lists are DERIVED from the crits that exist, so anything typed here is a
 * pick next time by itself. A value already typed shows as its own row at the
 * top, so the closed select always says what the crit is filed under, and
 * choosing the add row again re-opens it for editing rather than starting blank
 * — which is what makes a typed label correctable rather than write-once.
 *
 * A <select> rather than a chip that opens something: re-filing is a correction
 * — you picked Concept and it turned out to be massing — and a correction
 * should cost one press.
 */
function CritPicker({
  value,
  options,
  onChange,
  addLabel,
  emptyLabel,
  placeholder,
  maxLength,
  ariaLabel,
  textClass,
}: {
  value: string | null
  /** Everything already used, for the list. */
  options: readonly string[]
  onChange: (value: string) => void
  addLabel: string
  /** Offered when the field is optional. Omit to require a value. */
  emptyLabel?: string
  placeholder: string
  maxLength: number
  ariaLabel: string
  /** The row's place in the hierarchy — see the header's note. */
  textClass: string
}) {
  const [typing, setTyping] = useState(false)
  const [draft, setDraft] = useState('')
  /** Same Escape-before-blur problem the title had; a ref lands immediately. */
  const abandonedRef = useRef(false)

  const custom = Boolean(value) && !options.includes(value as string)

  const commit = () => {
    setTyping(false)
    if (abandonedRef.current) {
      abandonedRef.current = false
      return
    }
    const next = draft.replace(/\s+/g, ' ').trim()
    if (!next || next === value) return
    onChange(next)
  }

  if (typing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Enter') {
            e.preventDefault()
            e.currentTarget.blur()
          }
          if (e.key === 'Escape') {
            abandonedRef.current = true
            e.currentTarget.blur()
          }
        }}
        placeholder={placeholder}
        maxLength={maxLength}
        aria-label={ariaLabel}
        className={`w-full -mx-1 px-1 py-0.5 rounded-md bg-white outline-none ring-2 ring-[#3B6EF6]/40 ${textClass}`}
      />
    )
  }

  return (
    <div className="relative -mx-1 flex items-center max-w-full">
      <select
        value={value ?? ''}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          e.stopPropagation()
          const next = e.target.value
          if (next === ADD_NEW) {
            // Pre-filled with the label already there, so the add row edits a
            // value you typed instead of making you retype it.
            setDraft(custom ? (value as string) : '')
            setTyping(true)
            return
          }
          onChange(next)
        }}
        aria-label={ariaLabel}
        className={`w-full appearance-none cursor-pointer truncate rounded-md bg-transparent pl-1 pr-6 py-0.5 outline-none hover:bg-[#16181D]/[0.04] focus:bg-white focus:ring-2 focus:ring-[#3B6EF6]/40 ${textClass}`}
      >
        {emptyLabel && <option value="">{emptyLabel}</option>}
        {custom && <option value={value as string}>{value}</option>}
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
        <option value={ADD_NEW}>{custom ? `${addLabel} (rename)` : addLabel}</option>
      </select>
      <ChevronDown className="pointer-events-none absolute right-1 h-4 w-4 shrink-0 text-[#8A8FA0]" />
    </div>
  )
}


export default function CritColumn({
  crit,
  isActive,
  onFocus,
  refreshKey,
  liveTranscript,
  composer,
  onComposerSubmit,
  onComposerCancel,
  expanded = false,
  onToggleExpand,
  onPhaseChange,
  phases = CRIT_PHASES,
  projects = [],
  onProjectChange,
  onPin,
  onReference,
  onNote,
  onStep,
  onToggleRecording,
  onDelete,
  recording = false,
  busy = false,
}: {
  crit: DeskCrit
  /** The crit the tool rail is pointed at. */
  isActive: boolean
  onFocus: () => void
  /** Bumped by the board to make this column reload after an external write. */
  refreshKey: number
  /** Words being spoken into THIS crit right now, if any. */
  liveTranscript?: string | null
  /**
   * Delete this whole crit. Omit to hide the control — only the person who
   * owns the crit may delete it, and the API refuses anyone else.
   */
  onDelete?: () => void
  /** An open inline composer targeting this crit. */
  composer?: 'note' | 'step' | null
  onComposerSubmit?: (text: string) => void
  onComposerCancel?: () => void
  /**
   * Is this crit blown up to fill the page?
   *
   * The card is the same component either way — expanding is a layout state,
   * not a second screen. It used to be a route (/desk-crits/[id]) onto a
   * pan-and-zoom canvas; that canvas is gone, and with it the reason to
   * navigate away from the crit you are already looking at.
   */
  expanded?: boolean
  onToggleExpand?: () => void
  /** Re-file this crit under a different phase. Omit to render it read-only. */
  onPhaseChange?: (phase: string) => void
  /**
   * Every phase already used, for the middle row's list — the suggested ten
   * plus anything anyone has typed. Defaults to the suggestions alone so a
   * caller that has not derived the wider set still gets a usable dropdown.
   */
  phases?: readonly string[]
  /** Every project already used, for the top row's list. */
  projects?: string[]
  /** Re-file this crit under a different project. Omit to render it read-only. */
  onProjectChange?: (project: string) => void
  /**
   * Per-card actions.
   *
   * These used to live on a tool rail down the left of the board, which acted
   * on whichever column was "focused". That indirection existed only because
   * the rail was shared — you had to click a column, then click a tool, and
   * hope the right one was armed. On the card the target is unambiguous.
   */
  onPin?: () => void
  /**
   * Add a REFERENCE — a photo, a precedent image, something you brought to
   * look at rather than something you made. Distinct from a sheet: sheets are
   * boards you pin and mark up in the lightbox, references are just there.
   */
  onReference?: () => void
  onNote?: () => void
  onStep?: () => void
  onToggleRecording?: () => void
  /** Whether THIS crit is the one being recorded into. */
  recording?: boolean
  /** An upload is in flight for this crit. */
  busy?: boolean
}) {
  // realtime off: see the option's note. A personal crit has one viewer, and
  // the board reloads this column through refreshKey after its own writes.
  const { nodes, deleteNode, reload: reloadNodes } = useCanvasNodes(
    crit.id,
    null,
    { realtime: false }
  )
  const transcript = useCritTranscript(crit.id)
  const summary = useCritSummary(crit.id)
  const [summarising, setSummarising] = useState(false)

  const { reload: reloadTranscript } = transcript
  const { reload: reloadSummary } = summary
  useEffect(() => {
    // The tool rail writes into whichever crit is focused, straight through the
    // API, so this column has to be told to pick those changes up. One nonce
    // for all three because a tool action can touch any of them and the column
    // is cheap to refresh.
    if (refreshKey > 0) {
      void reloadNodes()
      void reloadTranscript()
      void reloadSummary()
    }
  }, [refreshKey, reloadNodes, reloadTranscript, reloadSummary])


  /* The title-draft state, its resync effect and commitTitle are gone with the
     name field they served. A crit's name is generated from its project and its
     phase, and both of those are editable on the card now — so the name has
     nothing left to say that the two lines above it do not. */
  const { notes } = useMemo(() => {
    const privateNotes: Array<{ node: (typeof nodes)[number]; props: NodeProps }> = []
    let drawingCount = 0
    for (const node of nodes) {
      const props = node.props as NodeProps
      // Marks made in the crit workspace — trace strokes and callouts — carry
      // the id of the sheet they sit on. They are not content of their own:
      // without this a callout (a sticky) rendered on the card as a loose note
      // torn out of its picture, and a page of trace read as a pile of them.
      if (typeof (node.props as { onNodeId?: unknown })?.onNodeId === 'string') {
        drawingCount += 1
        continue
      }
      // A column can only draw the kinds it has a card for. The canvas surface
      // this replaced also wrote ink, shapes, frames and connectors, and those
      // fell through to the note branch — which reads props.text, so an old
      // traced canvas rendered as one blank yellow card PER PEN STROKE. They
      // are counted instead, so the work is acknowledged rather than either
      // vanishing silently or burying the column.
      if (node.type !== 'image' && node.type !== 'sticky' && node.type !== 'text') {
        drawingCount += 1
        continue
      }
      // Sheets are BOARDS now (migration 042) and arrive from useCritBoards
      // below, so nothing here becomes pinned work any more. What is left in
      // canvas_nodes for a crit is its notes and next steps — crit metadata,
      // not images — and those still render from here.
      privateNotes.push({ node, props })
    }
    return { notes: privateNotes, drawings: drawingCount }
  }, [nodes])

  /**
   * The crit's sheets. Real boards, which is what lets a click open the
   * LIGHTBOX — the same one the 3D and 2D spaces use, with its trace layer and
   * its callouts. Both are keyed by boards.id, so the canvas-node sheets this
   * replaced could not be marked up at all.
   */
  const { boards: sheets, loading: sheetsLoading, setPinned, removeBoard } = useCritBoards(
    crit.id,
    refreshKey,
  )
  const [openBoardId, setOpenBoardId] = useState<string | null>(null)
  const openBoard = sheets.find((b) => b.id === openBoardId) ?? null

  const { saveParsed } = summary
  const { fullText } = transcript

  const handleSummarise = useCallback(async () => {
    if (!fullText.trim()) return
    setSummarising(true)
    try {
      const parsed = summariseLocally(fullText)
      await saveParsed(parsed.summary, parsed.deliverables, 'local')
    } finally {
      setSummarising(false)
    }
  }, [fullText, saveParsed])

  return (
    <section
      onClick={onFocus}
      onDoubleClick={() => onToggleExpand?.()}
      // Always w-full: the grid cell decides how wide a card is now, and a
      // fixed 420px column would overflow its cell at five across.
      className={`w-full rounded-2xl border transition-colors ${
        isActive
          ? 'border-[#3B6EF6]/50 bg-white shadow-[0_8px_30px_rgba(59,110,246,0.10)]'
          : 'border-[#16181D]/[0.08] bg-white/70'
      }`}
    >
      {/* ---------------- header ---------------- */}
      <div className="px-5 pt-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {/* Project, phase, date — largest to smallest, top to bottom.
                The card is read at a glance across a term of them, and that is
                the order the eye wants: WHICH project, then where in it, then
                when. The type shrinks down the stack so the hierarchy is
                visible without reading a word of it.

                The crit's own NAME is gone from here. It was auto-generated as
                "<project> — <phase>", so a card led with a heading and then
                repeated both halves of it one line down; the two fields it was
                built from are the two controls above, and either can now be
                corrected in place. */}
            {onProjectChange ? (
              <CritPicker
                value={crit.project}
                options={projects}
                onChange={onProjectChange}
                addLabel="+ New project…"
                emptyLabel="No project"
                placeholder="Name this project"
                maxLength={120}
                ariaLabel="Project"
                textClass="text-lg font-bold text-[#16181D]"
              />
            ) : (
              <h2 className="text-lg font-bold text-[#16181D] truncate">
                {crit.project ?? 'No project'}
              </h2>
            )}

            {onPhaseChange ? (
              <CritPicker
                value={crit.phase}
                options={phases}
                onChange={onPhaseChange}
                addLabel="+ New phase…"
                emptyLabel={crit.phase ? undefined : 'No phase'}
                placeholder="Name this phase"
                maxLength={MAX_CRIT_PHASE_LENGTH}
                ariaLabel="Project phase"
                textClass="text-[13px] font-semibold text-[#5A5E6B]"
              />
            ) : (
              <p className="text-[13px] font-semibold text-[#5A5E6B] truncate">
                {crit.phase ?? 'No phase'}
              </p>
            )}

            <p className="mt-0.5 truncate px-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[#8A8FA0]">
              {new Date(crit.createdAt).toLocaleDateString(undefined, {
                weekday: 'long',
                month: 'short',
                day: 'numeric',
              })}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* The "Today" / "Reviewed" pill is gone. It restated, as a
                coloured chip, what the date line under the phase already says
                in full — and said it less precisely, since every crit older
                than today collapsed into one word. */}
            {/* Separate from the card's own click, which only focuses it.
                Expanding hides every other crit, so it takes a deliberate
                press rather than every stray click on the card. */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onToggleExpand?.()
              }}
              title={expanded ? 'Show every crit again' : 'Work in this crit on its own'}
              aria-label={expanded ? 'Show every crit again' : 'Work in this crit on its own'}
              className="flex items-center justify-center p-1.5 rounded-lg border border-[#16181D]/[0.12] text-[#5A5E6B] hover:bg-[#16181D]/5"
            >
              {/* Icon only. The arrows say it, and the word beside them was the
                  widest thing in a row of icon buttons. The title and
                  aria-label still carry the sentence. */}
              {expanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
            {/* Deleting takes the transcript, the summary, the next steps and
                every pinned sheet with it, so the confirm lives on the board
                rather than here — this only asks for it. stopPropagation for
                the same reason Open does: the card's own click just focuses it
                for the tool rail. */}
            {onDelete && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete()
                }}
                title="Delete this crit"
                aria-label={`Delete ${crit.title}`}
                className="p-1.5 rounded-lg text-[#8A8FA0] hover:text-[#D64545] hover:bg-[#D64545]/[0.08] transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ---------------- pinned work ---------------- */}
      <div className="px-5">
        <div className="flex items-center justify-end gap-2">
          {onPin && (
            <CardAction onClick={onPin} disabled={busy} icon={<Pin className="w-3 h-3" />}>
              Pin work
            </CardAction>
          )}
        </div>
        <div className="rounded-xl border border-[#16181D]/[0.08] bg-[#F7F9FC] p-3 min-h-[112px]">
          {sheetsLoading && sheets.length === 0 ? (
            <div className="flex items-center gap-2 text-xs text-[#8A8FA0] h-[88px]">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Loading…
            </div>
          ) : sheets.length === 0 ? (
            <p className="text-xs text-[#8A8FA0] leading-relaxed h-[88px] flex items-center">
              Put any work relevant to your conversation.
            </p>
          ) : (
            /* A grid when expanded, a scrolling strip when not: the whole
               reason to expand a crit is to stop reading its sheets through a
               132px letterbox. */
            <div
              className={
                expanded
                  ? 'grid gap-3 grid-cols-[repeat(auto-fill,minmax(200px,1fr))]'
                  : 'flex gap-3 overflow-x-auto pb-1'
              }
            >
              {sheets.map((sheet) => (
                <CritSheet
                  key={sheet.id}
                  name={sheet.title}
                  src={sheet.thumbnailUrl || sheet.fullImageUrl}
                  pinned={sheet.pinned}
                  expanded={expanded}
                  onOpen={() => setOpenBoardId(sheet.id)}
                  onTogglePin={() => void setPinned(sheet.id, !sheet.pinned)}
                  onRemove={() => void removeBoard(sheet.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* The same lightbox the 3D and 2D spaces open, with nothing switched
          off: isEditMode so the author line is editable, and hideCallouts left
          alone so the trace tools and callout pins are both live. A desk crit
          is the surface where marking up work matters most, and it was the one
          surface that could not. */}
      {/* Suspense around the lightbox, not around the page that hosts it.
          LightboxModal calls useSearchParams, which Next requires a boundary
          above — and that requirement fails only at Vercel BUILD, never at
          tsc, so it is invisible locally. Every other host wraps it (share,
          crit, studio, view, gallery); putting the boundary here instead means
          the next host does not have to know, which is exactly what went wrong
          when the desk crit became a host. */}
      {openBoard && (
        <Suspense fallback={null}>
        <LightboxModal
          board={openBoard as Board}
          allBoards={sheets as Board[]}
          isEditMode
          onClose={() => setOpenBoardId(null)}
          onNavigate={(direction) => {
            const i = sheets.findIndex((b) => b.id === openBoard.id)
            if (i < 0) return
            const next = direction === 'next' ? i + 1 : i - 1
            const target = sheets[(next + sheets.length) % sheets.length]
            if (target) setOpenBoardId(target.id)
          }}
        />
        </Suspense>
      )}

      {/* ---------------- only you ---------------- */}
      <div className="px-5 pt-4 pb-5 space-y-3">
        <div className="flex items-center justify-end gap-2">
          <div className="flex items-center gap-1">
            {onNote && (
              <CardAction onClick={onNote} icon={<StickyNote className="w-3 h-3" />}>
                Note
              </CardAction>
            )}
            {onStep && (
              <CardAction onClick={onStep} icon={<ListChecks className="w-3 h-3" />}>
                Step
              </CardAction>
            )}
            {onReference && (
              <CardAction onClick={onReference} disabled={busy} icon={<ImageIcon className="w-3 h-3" />}>
                References
              </CardAction>
            )}
          </div>
        </div>

        {notes.map(({ node, props }) =>
          node.type === 'image' ? (
            <div key={node.id} className="rounded-xl border border-[#16181D]/[0.08] bg-white p-3">
              <div className="flex items-start justify-between gap-2 mb-2">
                <span className="text-[10px] font-bold tracking-[0.12em] uppercase text-[#8A8FA0]">
                  Reference
                </span>
                <RemoveButton onClick={() => void deleteNode(node.id)} label={props.name || 'photo'} />
              </div>
              {props.name && (
                <p className="text-[13px] text-[#16181D] mb-2 truncate">{props.name}</p>
              )}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={props.thumbUrl || props.url}
                alt={props.name || 'Reference'}
                className="w-full rounded-lg object-cover max-h-56"
              />
            </div>
          ) : (
            <div
              key={node.id}
              className="group relative rounded-xl px-4 py-3 text-[13px] leading-relaxed text-[#16181D]"
              style={{ background: '#FDF3C7' }}
            >
              <span className="whitespace-pre-wrap break-words">{props.text}</span>
              <span className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <RemoveButton onClick={() => void deleteNode(node.id)} label="note" />
              </span>
            </div>
          )
        )}

        {composer && (
          <InlineComposer
            kind={composer}
            onSubmit={(text) => onComposerSubmit?.(text)}
            onCancel={() => onComposerCancel?.()}
          />
        )}

        {/* Voice */}
        <div className="rounded-xl border border-[#16181D]/[0.08] bg-white p-3">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="text-[10px] font-bold tracking-[0.12em] uppercase text-[#8A8FA0]">
              Voice note
            </span>
            <div className="flex items-center gap-2">
              {transcript.segments.length > 0 && (
                <span className="text-[11px] text-[#8A8FA0]">
                  {transcript.segments.length} clip{transcript.segments.length === 1 ? '' : 's'}
                </span>
              )}
              {onToggleRecording && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggleRecording()
                  }}
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold ${
                    recording
                      ? 'bg-[#D64545] text-white'
                      : 'bg-[#16181D]/[0.06] text-[#5A5E6B] hover:bg-[#16181D]/10'
                  }`}
                >
                  <Mic className="w-3 h-3" />
                  {recording ? 'Stop' : 'Record'}
                </button>
              )}
            </div>
          </div>
          {transcript.segments.length === 0 && !liveTranscript ? (
            <p className="text-xs text-[#8A8FA0]">Nothing recorded yet.</p>
          ) : (
            <div className="text-[13px] leading-relaxed text-[#16181D] max-h-40 overflow-y-auto space-y-2">
              {transcript.segments.map((seg) => (
                <p key={seg.id} className="whitespace-pre-wrap">
                  {seg.text}
                </p>
              ))}
              {liveTranscript && <p className="text-[#3B6EF6]">{liveTranscript}</p>}
            </div>
          )}
        </div>

        {/* Summary */}
        <div className="rounded-xl border border-[#16181D]/[0.08] bg-white p-3">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="text-[10px] font-bold tracking-[0.12em] uppercase text-[#8A8FA0]">
              Summary
            </span>
            <button
              type="button"
              onClick={() => void handleSummarise()}
              disabled={!transcript.fullText.trim() || summarising}
              title={
                transcript.fullText.trim()
                  ? 'Summarise this crit and pull out next steps'
                  : 'Record something first'
              }
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[#3B6EF6] text-white text-[11px] font-semibold hover:bg-[#2F5BD4] disabled:opacity-40 disabled:cursor-default transition-colors"
            >
              <Sparkles className="w-3 h-3" />
              {summarising ? 'Working…' : summary.summary ? 'Redo' : 'Summarise'}
            </button>
          </div>
          {summary.summary ? (
            <>
              {/* Stored newline separated, one point per line — see the bullet
                  note in localSummary. Rendered as a list so it scans. */}
              <ul className="space-y-1">
                {summary.summary.text
                  .split('\n')
                  .map((line) => line.trim())
                  .filter(Boolean)
                  .map((line, i) => (
                    <li key={i} className="flex gap-2 text-[13px] leading-snug text-[#16181D]">
                      <span className="text-[#3B6EF6] shrink-0">•</span>
                      <span>{line}</span>
                    </li>
                  ))}
              </ul>
              {/* Said plainly, every time. This is pattern-matching, not
                  comprehension, and a summary that looks confident while being
                  wrong is worse than one that admits what it is. */}
              <p className="text-[10px] text-[#8A8FA0] mt-2 italic">
                Rough automatic summary — check it against what was actually said.
              </p>
            </>
          ) : (
            <p className="text-xs text-[#8A8FA0]">
              Record the crit, then summarise it here.
            </p>
          )}
        </div>

        {/* Next steps */}
        <div className="rounded-xl border border-[#16181D]/[0.08] bg-white p-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-[10px] font-bold tracking-[0.12em] uppercase text-[#8A8FA0]">
              Next steps
            </span>
            {summary.deliverables.length > 0 && (
              <span className="text-[11px] text-[#8A8FA0]">
                {summary.deliverables.filter((d) => d.done).length}/{summary.deliverables.length}
              </span>
            )}
          </div>
          {summary.deliverables.length === 0 ? (
            <p className="text-xs text-[#8A8FA0]">Nothing to do yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {summary.deliverables.map((item) => (
                <li key={item.id} className="group flex items-start gap-2">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={item.done}
                    aria-label={item.done ? `Mark "${item.title}" not done` : `Mark "${item.title}" done`}
                    onClick={() => void summary.setDone(item.id, !item.done)}
                    className={`mt-0.5 w-4 h-4 shrink-0 rounded-[5px] border flex items-center justify-center transition-colors ${
                      item.done
                        ? 'bg-[#3B6EF6] border-[#3B6EF6]'
                        : 'border-[#16181D]/25 hover:border-[#3B6EF6]'
                    }`}
                  >
                    {item.done && <Check className="w-3 h-3 text-white" />}
                  </button>
                  <span
                    className={`flex-1 text-[13px] leading-snug ${
                      item.done ? 'text-[#8A8FA0] line-through' : 'text-[#16181D]'
                    }`}
                  >
                    {item.title}
                  </span>
                  <span className="opacity-0 group-hover:opacity-100 transition-opacity">
                    <RemoveButton onClick={() => void summary.remove(item.id)} label={item.title} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {(transcript.error || summary.error) && (
          <button
            onClick={() => {
              transcript.clearError()
              summary.clearError()
            }}
            className="w-full text-left px-3 py-2 rounded-lg bg-[#D64545]/5 border border-[#D64545]/30 text-[11px] text-[#D64545]"
          >
            {transcript.error || summary.error} — dismiss
          </button>
        )}
      </div>
    </section>
  )
}

function RemoveButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      title={`Remove ${label}`}
      aria-label={`Remove ${label}`}
      className="p-1 rounded-md text-[#8A8FA0] hover:text-[#D64545] hover:bg-[#D64545]/[0.08]"
    >
      <Trash2 className="w-3.5 h-3.5" />
    </button>
  )
}

/**
 * Inline entry for a note or a next step.
 *
 * A textarea rather than a dialog: notes are multi-line by nature, and it
 * appears in the column it will be filed under, so there is never a question
 * of which crit is being written into.
 */
function InlineComposer({
  kind,
  onSubmit,
  onCancel,
}: {
  kind: 'note' | 'step'
  onSubmit: (text: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState('')
  const isNote = kind === 'note'

  const commit = () => {
    const text = value.trim()
    if (!text) {
      onCancel()
      return
    }
    onSubmit(text)
  }

  return (
    <div
      className="rounded-xl border border-[#3B6EF6]/40 bg-white p-3"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="text-[10px] font-bold tracking-[0.12em] uppercase text-[#3B6EF6] mb-1.5">
        {isNote ? 'New note' : 'New next step'}
      </div>
      <textarea
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={isNote ? 3 : 2}
        placeholder={isNote ? 'What do you want to remember?' : 'What do you have to do?'}
        onKeyDown={(e) => {
          // Enter commits a step; a note is multi-line, so it needs the
          // modifier. Escape always abandons.
          if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
          // isComposing: confirming an IME candidate fires Enter, and without
          // this a Japanese or Chinese typist submits the half-written step
          // every time they pick a character.
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Enter' && (!isNote || e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            commit()
          }
        }}
        className="w-full text-[13px] leading-relaxed text-[#16181D] border border-[#16181D]/[0.12] rounded-lg px-2.5 py-2 outline-none focus:border-[#3B6EF6]/50 resize-y"
      />
      <div className="flex items-center gap-2 mt-2">
        <button
          type="button"
          onClick={commit}
          disabled={!value.trim()}
          className="px-3 py-1.5 rounded-lg bg-[#3B6EF6] text-white text-[11px] font-semibold disabled:opacity-40"
        >
          Add
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 rounded-lg border border-[#16181D]/[0.12] text-[11px] font-semibold text-[#5A5E6B]"
        >
          Cancel
        </button>
        <span className="ml-auto text-[10px] text-[#8A8FA0]">
          {isNote ? '\u2318\u21B5 to add' : '\u21B5 to add'}
        </span>
      </div>
    </div>
  )
}

/** A small action in a card section header. */
function CardAction({
  children,
  icon,
  onClick,
  disabled,
}: {
  children: React.ReactNode
  icon: React.ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      // The card's own onClick focuses the column; a header action must not
      // also do that, or every action reads as "you also selected this".
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold text-[#5A5E6B] hover:bg-[#16181D]/[0.06] disabled:text-[#B6BAC6] disabled:hover:bg-transparent"
    >
      {icon}
      {children}
    </button>
  )
}
