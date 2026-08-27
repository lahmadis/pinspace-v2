'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  ImageIcon,
  ListChecks,
  Loader2,
  Maximize2,
  Mic,
  Pin,
  Sparkles,
  StickyNote,
  Trash2,
} from 'lucide-react'
import { useCanvasNodes } from '@/hooks/useCanvasNodes'
import { useCritTranscript } from '@/hooks/useCritTranscript'
import { useCritSummary } from '@/hooks/useCritSummary'
import { summariseLocally } from '@/lib/summary/localSummary'
import { critStage, stageLabel, zoneOf } from '@/lib/desk/zones'
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
export default function CritColumn({
  crit,
  isActive,
  onFocus,
  refreshKey,
  liveTranscript,
  composer,
  onComposerSubmit,
  onComposerCancel,
  onOpen,
  onPin,
  onPhoto,
  onNote,
  onStep,
  onToggleRecording,
  onRename,
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
   * Rename this crit. Omit to leave the title read-only.
   */
  onRename?: (title: string) => void
  /**
   * Delete this whole crit. Omit to hide the control — only the person who
   * owns the crit may delete it, and the API refuses anyone else.
   */
  onDelete?: () => void
  /** An open inline composer targeting this crit. */
  composer?: 'note' | 'step' | null
  onComposerSubmit?: (text: string) => void
  onComposerCancel?: () => void
  /** Open this crit at working size. The card is the overview; that is where
   *  boards get laid out, drawn over and annotated. */
  onOpen?: () => void
  /**
   * Per-card actions.
   *
   * These used to live on a tool rail down the left of the board, which acted
   * on whichever column was "focused". That indirection existed only because
   * the rail was shared — you had to click a column, then click a tool, and
   * hope the right one was armed. On the card the target is unambiguous.
   */
  onPin?: () => void
  onPhoto?: () => void
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
  const { nodes, deleteNode, reload: reloadNodes, loading: nodesLoading } = useCanvasNodes(
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

  /**
   * Delete a pinned sheet AND every mark made on it.
   *
   * There is no FK cascade for this — a mark points at its sheet through
   * `props.onNodeId`, which is JSON, not a reference the database enforces. So
   * the sweep has to happen here. Without it the marks survive their picture:
   * nothing renders them (the workspace keys them to a sheet that is gone) and
   * nothing can delete them, but the counter below still promises they are
   * there to see.
   */
  const removeSheet = useCallback(
    async (sheetId: string) => {
      const marks = nodes.filter(
        (n) => (n.props as { onNodeId?: unknown })?.onNodeId === sheetId
      )
      // Marks first. If the sheet went and this failed halfway, the leftovers
      // would be exactly the orphans this exists to prevent.
      for (const mark of marks) await deleteNode(mark.id)
      await deleteNode(sheetId)
    },
    [nodes, deleteNode]
  )

  const [titleDraft, setTitleDraft] = useState(crit.title)
  // Follow the crit if it is renamed somewhere else; a local draft that never
  // resyncs would quietly re-save the old name on the next blur.
  useEffect(() => {
    setTitleDraft(crit.title)
  }, [crit.title])

  /**
   * Set for exactly the blur that Escape causes.
   *
   * blur() dispatches focusout SYNCHRONOUSLY, so the setTitleDraft(crit.title)
   * beside it has not been flushed by the time onBlur runs — commitTitle read
   * the abandoned draft and renamed the crit to it, which is the opposite of
   * what Escape means. A ref lands immediately; state does not.
   */
  const abandonedRef = useRef(false)

  const commitTitle = useCallback(() => {
    if (abandonedRef.current) {
      abandonedRef.current = false
      setTitleDraft(crit.title)
      return
    }
    const next = titleDraft.trim()
    if (!next || next === crit.title) {
      setTitleDraft(crit.title)
      return
    }
    onRename?.(next)
  }, [titleDraft, crit.title, onRename])

  const { shared, notes } = useMemo(() => {
    const sharedNodes: Array<{ node: (typeof nodes)[number]; props: NodeProps }> = []
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
      // Only images render as pinned work. A sticky that somehow carried
      // zone:'shared' would otherwise come out as a broken tile; unreachable
      // today, since only uploads write that zone.
      if (zoneOf(node.props) === 'shared' && node.type === 'image') sharedNodes.push({ node, props })
      else privateNotes.push({ node, props })
    }
    return { shared: sharedNodes, notes: privateNotes, drawings: drawingCount }
  }, [nodes])

  const stage = critStage(crit.createdAt)
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
      onDoubleClick={() => onOpen?.()}
      className={`w-[420px] shrink-0 rounded-2xl border transition-colors ${
        isActive
          ? 'border-[#3B6EF6]/50 bg-white shadow-[0_8px_30px_rgba(59,110,246,0.10)]'
          : 'border-[#16181D]/[0.08] bg-white/70'
      }`}
    >
      {/* ---------------- header ---------------- */}
      <div className="px-5 pt-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {onRename ? (
              /* Edits in place rather than behind a pencil: the title is the
                 one thing on the card that is plainly yours to change, and a
                 dedicated control for one field is more chrome than it earns.
                 Committing on blur and on Enter means there is no Save to
                 forget. */
              <input
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onFocus={(e) => e.currentTarget.select()}
                onBlur={commitTitle}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    e.currentTarget.blur()
                  }
                  // Escape abandons the edit rather than saving a half-typed
                  // name, which is what blur-to-commit would otherwise do.
                  if (e.key === 'Escape') {
                    abandonedRef.current = true
                    setTitleDraft(crit.title)
                    e.currentTarget.blur()
                  }
                }}
                aria-label="Crit name"
                className="w-full bg-transparent text-lg font-bold text-[#16181D] truncate rounded-md -mx-1 px-1 py-0.5 outline-none hover:bg-[#16181D]/[0.04] focus:bg-white focus:ring-2 focus:ring-[#3B6EF6]/40"
              />
            ) : (
              <h2 className="text-lg font-bold text-[#16181D] truncate">{crit.title}</h2>
            )}
            <p className="text-[10px] font-bold tracking-[0.12em] uppercase text-[#8A8FA0] mt-0.5">
              {new Date(crit.createdAt).toLocaleDateString(undefined, {
                weekday: 'long',
                month: 'short',
                day: 'numeric',
              })}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span
              className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                stage === 'today'
                  ? 'bg-[#3B6EF6] text-white'
                  : 'bg-[#16181D]/[0.06] text-[#5A5E6B]'
              }`}
            >
              {stageLabel(stage)}
            </span>
            {/* Separate from the card's own click, which only focuses it for
                the tool rail. Opening is a navigation and should take a
                deliberate press, not every stray click on the card. */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onOpen?.()
              }}
              title="Open this crit to lay out and mark up the work"
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#16181D]/[0.12] text-[11px] font-semibold text-[#5A5E6B] hover:bg-[#16181D]/5"
            >
              Open
              <Maximize2 className="w-3 h-3" />
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
        <div className="rounded-xl border border-[#16181D]/[0.08] bg-[#F7F9FC] p-3 min-h-[132px]">
          {nodesLoading && shared.length === 0 ? (
            <div className="flex items-center gap-2 text-xs text-[#8A8FA0] h-[108px]">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Loading…
            </div>
          ) : shared.length === 0 ? (
            <p className="text-xs text-[#8A8FA0] leading-relaxed h-[108px] flex items-center">
              Pin the work you&rsquo;ll put in front of them.
            </p>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-1">
              {shared.map(({ node, props }) => (
                <PinnedWork
                  key={node.id}
                  name={props.name}
                  src={props.thumbUrl || props.url}
                  onRemove={() => void removeSheet(node.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

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
            {onPhoto && (
              <CardAction onClick={onPhoto} disabled={busy} icon={<ImageIcon className="w-3 h-3" />}>
                Ref
              </CardAction>
            )}
          </div>
        </div>

        {notes.map(({ node, props }) =>
          node.type === 'image' ? (
            <div key={node.id} className="rounded-xl border border-[#16181D]/[0.08] bg-white p-3">
              <div className="flex items-start justify-between gap-2 mb-2">
                <span className="text-[10px] font-bold tracking-[0.12em] uppercase text-[#8A8FA0]">
                  Photo / ref
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

function PinnedWork({
  name,
  src,
  onRemove,
}: {
  name?: string
  src?: string
  onRemove: () => void
}) {
  return (
    <figure className="group relative w-[120px] shrink-0">
      <div className="w-[120px] h-[108px] rounded-lg overflow-hidden bg-[#C8D6FC] border border-[#16181D]/[0.08]">
        {src ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={src} alt={name || 'Pinned work'} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full grid place-items-center text-[10px] text-[#8A8FA0]">
            missing
          </div>
        )}
      </div>
      <figcaption className="mt-1 text-[10px] text-[#5A5E6B] truncate">{name || 'Untitled'}</figcaption>
      <span className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <RemoveButton onClick={onRemove} label={name || 'pinned work'} />
      </span>
    </figure>
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
