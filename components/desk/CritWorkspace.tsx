'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  MousePointer2,
  Pin,
  PenLine,
  MessageSquarePlus,
  Mic,
  Loader2,
  ArrowLeft,
  Trash2,
  Undo2,
  X,
} from 'lucide-react'
import { useCanvasNodes } from '@/hooks/useCanvasNodes'
import { useCritTranscript } from '@/hooks/useCritTranscript'
import { useCritSummary } from '@/hooks/useCritSummary'
import { useSpeechTranscription } from '@/hooks/useSpeechTranscription'
import { useDirectUpload } from '@/lib/useDirectUpload'
import { summariseLocally } from '@/lib/summary/localSummary'
import { isPermanentFailure, unavailableMessage } from '@/lib/transcription/types'
import {
  fitPlacedSize,
  isCanvasImage,
  readImageSize,
  rejectionReason,
} from '@/lib/canvas/imageNode'
import { TRACE_COLORS, TRACE_WIDTHS, tracePx } from '@/lib/trace/pens'
import type { CanvasNode } from '@/lib/canvas/types'

/**
 * One desk crit at working size.
 *
 * This replaced the infinite canvas. A crit is not an unbounded whiteboard —
 * it is a handful of sheets you pinned up, talked over, and marked. The canvas
 * gave every one of those a free-floating x/y in a space you had to pan around
 * to find, which is a worse fit for "show me my work" than simply laying the
 * sheets out. So the sheets are laid out for you, and the marking happens on
 * one sheet at a time, the way it does in the 3D space.
 *
 * WHERE ANNOTATIONS LIVE. A trace stroke or a callout belongs to a SHEET, not
 * to the crit, so each one is a node carrying `props.onNodeId` — the id of the
 * image it sits on — and coordinates NORMALISED 0..1 within that image. That is
 * what lets a mark stay in the right place when the sheet is drawn at grid size
 * in the overview and full-bleed on the stage. It also means no migration:
 * `canvas_nodes.props` is JSON, and `ink` and `sticky` are already in migration
 * 036's type CHECK.
 */

/** Gap between pinned sheets in the stored layout, matching the desk board. */
const PIN_GAP = 40

type WorkTool = 'select' | 'pin' | 'trace' | 'callout'

interface ToolDef {
  id: WorkTool
  label: string
  icon: React.ReactNode
  /** Shown but inert, with the reason, when it needs a sheet on the stage. */
  needsSheet?: boolean
}

const TOOLS: ToolDef[] = [
  { id: 'select', label: 'Select', icon: <MousePointer2 className="w-4 h-4" /> },
  { id: 'pin', label: 'Pin work', icon: <Pin className="w-4 h-4" /> },
  { id: 'trace', label: 'Trace', icon: <PenLine className="w-4 h-4" />, needsSheet: true },
  {
    id: 'callout',
    label: 'Add callout',
    icon: <MessageSquarePlus className="w-4 h-4" />,
    needsSheet: true,
  },
]

/**
 * Stroke weight is stored as a FRACTION of the sheet, the same as the lightbox,
 * and converted to pixels only at paint time.
 *
 * The overlay is an SVG whose viewBox is 0..1 with
 * `vectorEffect="non-scaling-stroke"`, which reinterprets stroke-width in outer
 * pixel space. Passing the stored fraction straight through drew a 0.004px
 * hairline — invisible, while the rows saved perfectly, so trace looked like it
 * silently did nothing. `tracePx` is the conversion, and it needs the sheet's
 * rendered width, which is why the stage measures itself.
 */
/** A drag shorter than this was a tap, not a mark. */
const MIN_STROKE_POINTS = 3

interface Annotation {
  node: CanvasNode
  onNodeId: string
}

export default function CritWorkspace({ canvasId }: { canvasId: string }) {
  // realtime off, like the desk board's columns: a personal crit has one
  // viewer, so there is no peer whose edits need pushing at us.
  const { nodes, createNode, deleteNode, loading } = useCanvasNodes(canvasId, null, {
    realtime: false,
  })
  const transcript = useCritTranscript(canvasId)
  const summary = useCritSummary(canvasId)
  const speech = useSpeechTranscription()
  const { upload } = useDirectUpload()

  const [tool, setTool] = useState<WorkTool>('select')
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [panel, setPanel] = useState<'transcript' | 'summary' | 'notes' | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [summarising, setSummarising] = useState(false)
  /** An open callout composer, at normalised coordinates on the focused sheet. */
  const [draftCallout, setDraftCallout] = useState<{ nx: number; ny: number; text: string } | null>(
    null
  )
  const [stroke, setStroke] = useState<number[][] | null>(null)
  const [penColor, setPenColor] = useState<string>(TRACE_COLORS[0])
  const [penWidth, setPenWidth] = useState<number>(TRACE_WIDTHS[0].value)

  /** Ref and state together, always — see draftRef. */
  const setDraft = useCallback((next: { nx: number; ny: number; text: string } | null) => {
    draftRef.current = next
    setDraftCallout(next)
  }, [])

  const clearStroke = useCallback(() => {
    strokeRef.current = null
    setStroke(null)
  }, [])

  const fileRef = useRef<HTMLInputElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  /**
   * The stroke in progress, TAGGED with the sheet it was started on.
   *
   * The tag is load-bearing. A pointerup can arrive on the stage with no
   * matching pointerdown (press started on the rail, released over the
   * picture), and without knowing which sheet the points came from that
   * committed sheet A's stroke onto whichever sheet was open by then.
   */
  const strokeRef = useRef<{ sheetId: string; pts: number[][] } | null>(null)
  /**
   * The open callout, held in a ref so committing can TAKE it atomically.
   *
   * Reading it from the render closure lost notes: clicking to place a second
   * callout flushes React synchronously, so the blur that followed ran against
   * the new empty draft, hit the "no text" guard, and returned — having already
   * cleared the first one's text. Taking from a ref means the second call sees
   * null and does nothing, whichever order the two events arrive in.
   */
  const draftRef = useRef<{ nx: number; ny: number; text: string } | null>(null)

  // ---------------------------------------------------------------------------
  // Partition. Sheets are what you pinned; everything carrying `onNodeId` is a
  // mark ON a sheet and must never render as one.
  // ---------------------------------------------------------------------------

  const { sheets, marksBySheet, loose, orphanCount, legacyCount } = useMemo(() => {
    const sheetList: CanvasNode[] = []
    const marks = new Map<string, Annotation[]>()
    const looseNotes: CanvasNode[] = []
    let legacy = 0
    for (const node of nodes) {
      const onNodeId = node.props?.onNodeId
      if (typeof onNodeId === 'string' && onNodeId) {
        const list = marks.get(onNodeId) ?? []
        list.push({ node, onNodeId })
        marks.set(onNodeId, list)
        continue
      }
      if (node.type === 'image') sheetList.push(node)
      else if (node.type === 'sticky' || node.type === 'text') looseNotes.push(node)
      // ink / shape / frame / connector with no onNodeId: drawn on the old
      // infinite canvas, which had a free surface to put them on and this does
      // not. Counted rather than dropped silently — the desk card counts them
      // too, and a view that shows nothing while the card promises something is
      // worse than saying plainly that they are not displayable here.
      else legacy += 1
    }
    // Left to right, the order they were pinned in.
    sheetList.sort((a, b) => a.x - b.x)
    const sheetIds = new Set(sheetList.map((s) => s.id))
    let orphans = 0
    for (const [sheetId, list] of marks) if (!sheetIds.has(sheetId)) orphans += list.length
    return {
      sheets: sheetList,
      marksBySheet: marks,
      loose: looseNotes,
      orphanCount: orphans,
      legacyCount: legacy,
    }
  }, [nodes])

  const focused = focusedId ? (sheets.find((s) => s.id === focusedId) ?? null) : null
  const focusedMarks = focused ? (marksBySheet.get(focused.id) ?? []) : []

  // ---------------------------------------------------------------------------
  // Pin work.
  // ---------------------------------------------------------------------------

  const pinFiles = useCallback(
    async (files: File[]) => {
      const images = files.filter(isCanvasImage)
      const refused = files.filter((f) => !isCanvasImage(f))
      if (refused.length > 0) setProblem(rejectionReason(refused[0]))
      if (images.length === 0) return

      setBusy('pin')
      setProblem(null)
      try {
        // Continue the row rather than stacking on the last sheet.
        let cursorX = sheets.reduce((max, s) => Math.max(max, s.x + s.w), 0)
        if (sheets.length > 0) cursorX += PIN_GAP
        for (const file of images) {
          const size = await readImageSize(file)
          const box = size ? fitPlacedSize(size.width, size.height) : { w: 320, h: 320 }
          const result = await upload(file)
          await createNode({
            type: 'image',
            x: cursorX,
            y: 0,
            w: box.w,
            h: box.h,
            props: {
              url: result.fullUrl,
              thumbUrl: result.thumbnailUrl,
              storagePath: result.storagePath,
              thumbPath: result.thumbnailPath,
              name: file.name,
              // 'shared' is what the desk board's column reads as pinned work,
              // so a sheet added here shows up on the card too.
              zone: 'shared',
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
    [sheets, upload, createNode]
  )

  // ---------------------------------------------------------------------------
  // Marks on the focused sheet. Coordinates are normalised against the RENDERED
  // box, so they hold at any size the sheet is later drawn at.
  // ---------------------------------------------------------------------------

  const normalisedPoint = useCallback((e: React.PointerEvent): [number, number] | null => {
    const el = stageRef.current
    if (!el) return null
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return null
    return [
      Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    ]
  }, [])

  const commitStroke = useCallback(async () => {
    const held = strokeRef.current
    strokeRef.current = null
    setStroke(null)
    if (!focused || !held || held.pts.length < MIN_STROKE_POINTS) return
    // Points captured on a different sheet are discarded rather than written
    // onto this one. Losing a stroke the user has already lost track of beats
    // drawing it across someone else's work.
    if (held.sheetId !== focused.id) return
    const pts = held.pts
    await createNode({
      type: 'ink',
      // The node's own box is the sheet's, so anything that later reads raw
      // coordinates (an export, a cleanup scan) sees a mark sitting on its
      // sheet rather than at the origin. Rendering uses props.pts.
      x: focused.x,
      y: focused.y,
      w: focused.w,
      h: focused.h,
      props: {
        onNodeId: focused.id,
        // Deliberately `pts`, not the canvas's `points`: that one meant pixels
        // in a stroke-local bbox, these are 0..1 against the sheet. Same name,
        // different space, would be a trap.
        pts,
        color: penColor,
        size: penWidth,
      },
    })
  }, [focused, createNode, penColor, penWidth])

  const commitCallout = useCallback(async () => {
    // Taken, not read: whichever of Enter / blur / the next click gets here
    // first wins, and the others find nothing left to do.
    const draft = draftRef.current
    draftRef.current = null
    setDraftCallout(null)
    if (!focused || !draft) return
    const text = draft.text.trim()
    if (!text) return
    await createNode({
      type: 'sticky',
      x: focused.x,
      y: focused.y,
      w: 240,
      h: 120,
      props: {
        onNodeId: focused.id,
        callout: true,
        nx: draft.nx,
        ny: draft.ny,
        text,
        zone: 'private',
      },
    })
  }, [focused, createNode])

  const onStagePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!focused) return
      if (tool === 'trace') {
        const p = normalisedPoint(e)
        if (!p) return
        e.preventDefault()
        // Captured on the STAGE, not on e.target: a target that unmounts
        // mid-stroke (a callout bubble, the composer) takes the capture with
        // it and the pointerup never arrives.
        stageRef.current?.setPointerCapture?.(e.pointerId)
        strokeRef.current = { sheetId: focused.id, pts: [p] }
        setStroke([p])
        return
      }
      if (tool === 'callout') {
        const p = normalisedPoint(e)
        if (!p) return
        // Save the one already open before opening another, or placing a
        // second callout silently discards the first one's text.
        if (draftRef.current) void commitCallout()
        setDraft({ nx: p[0], ny: p[1], text: '' })
      }
    },
    [focused, tool, normalisedPoint, commitCallout, setDraft]
  )

  const onStagePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const held = strokeRef.current
      if (!held) return
      const p = normalisedPoint(e)
      if (!p) return
      // Deliberately NOT gated on `tool`. A stroke that began while Trace was
      // selected must be able to finish even if the tool changes under it —
      // an upload completing mid-drag used to do exactly that, and the points
      // were then stranded on screen with no way to commit or clear them.
      const next = { ...held, pts: [...held.pts, p] }
      strokeRef.current = next
      setStroke(next.pts)
    },
    [normalisedPoint]
  )

  // ---------------------------------------------------------------------------
  // Recording. The button opens the transcript panel as well as starting the
  // recogniser — you should be able to see the words landing.
  // ---------------------------------------------------------------------------

  const { listening, interim, committed, unavailable, start, stop, flush } = speech
  const { appendSegment } = transcript

  /**
   * True from Record until the words are written, NOT just while listening.
   *
   * The save effect below is guarded on it, so clearing it at Stop — which the
   * first version effectively did by saving inline — meant the recogniser's
   * final sentence, which Chrome delivers AFTER stop(), was never picked up. It
   * then leaked into the next recording instead. Same bug the desk board hit;
   * same fix.
   */
  const [recording, setRecording] = useState(false)

  /**
   * Words taken off the recogniser but not yet stored.
   *
   * flush() clears the recogniser's buffer, so a save that fails leaves them
   * nowhere else. Holding them means the next attempt carries them again
   * rather than dropping part of a crit on a flaky connection.
   */
  const unsavedRef = useRef('')

  const saveSpeech = useCallback(async () => {
    const text = [unsavedRef.current, flush()].filter(Boolean).join(' ').trim()
    if (!text) return
    unsavedRef.current = ''
    // appendSegment RETURNS false, it does not throw — a try/catch here would
    // be dead code and the failure would be silent.
    const ok = await appendSegment(text, 'web-speech')
    if (!ok) {
      unsavedRef.current = text
      setProblem('Could not save what was said. It is still here — try again.')
    }
  }, [flush, appendSegment])

  // Write down whatever settled once recording ends, however it ended: Stop, a
  // denied microphone, or the recogniser giving up. The delay is what lets the
  // final result land first.
  useEffect(() => {
    if (listening || !recording || !committed) return
    const timer = setTimeout(() => {
      void saveSpeech()
      setRecording(false)
    }, 500)
    return () => clearTimeout(timer)
  }, [listening, recording, committed, saveSpeech])

  // Periodic save through a long crit, so a crash costs at most twenty seconds.
  useEffect(() => {
    if (!listening) return
    const timer = setInterval(() => void saveSpeech(), 20000)
    return () => clearInterval(timer)
  }, [listening, saveSpeech])

  // Last resort: the tab closing, or this view unmounting, while words are
  // held. keepalive is what lets the request outlive the page.
  useEffect(() => {
    if (!recording) return
    const rescue = () => {
      const text = [unsavedRef.current, flush()].filter(Boolean).join(' ').trim()
      if (!text) return
      unsavedRef.current = ''
      void fetch(`/api/canvases/${canvasId}/transcript`, {
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
  }, [recording, flush, canvasId])

  const toggleRecording = useCallback(() => {
    if (listening) {
      // `recording` is deliberately LEFT SET; the save effect above needs it.
      stop()
      return
    }
    setProblem(null)
    setPanel('transcript')
    setRecording(true)
    start()
  }, [listening, stop, start])

  const handleSummarise = useCallback(async () => {
    const text = transcript.fullText
    if (!text.trim()) return
    setSummarising(true)
    try {
      const parsed = summariseLocally(text)
      // saveParsed reports failure by return value, like appendSegment.
      const ok = await summary.saveParsed(parsed.summary, parsed.deliverables, 'local')
      if (!ok) setProblem('Could not save the summary. Try again.')
      else setPanel('summary')
    } finally {
      setSummarising(false)
    }
  }, [transcript.fullText, summary])

  const live = [committed, interim].filter(Boolean).join(' ').trim()

  // Only a PERMANENT failure disables Record. 'network' is in the same union
  // but clears on its own, and greying the button out for it would leave the
  // user with no way to retry once the connection came back.
  const speechBlocked = unavailable !== null && isPermanentFailure(unavailable)

  // ---------------------------------------------------------------------------

  const pickTool = useCallback(
    (next: WorkTool) => {
      if (next === 'pin') {
        fileRef.current?.click()
        return
      }
      void commitCallout()
      // Trace and callout mark up ONE sheet, so they need one open. They used
      // to be disabled until you opened one yourself, which meant the button
      // did nothing at all when you pressed it — it read as broken rather than
      // as a precondition. Pressing it now opens the sheet for you.
      if ((next === 'trace' || next === 'callout') && !focused && sheets.length > 0) {
        setFocusedId(sheets[0].id)
      }
      setTool(next)
    },
    [commitCallout, focused, sheets]
  )

  return (
    <div className="flex h-full min-h-0">
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ''
          if (files.length > 0) void pinFiles(files)
        }}
      />

      {/* ---- Left tool rail ---- */}
      <aside className="w-[178px] shrink-0 px-3 py-4 border-r border-[#16181D]/8 flex flex-col">
        <div className="text-[10px] font-bold tracking-[0.16em] uppercase text-[#8A8FA0] mb-3 px-1">
          Tools
        </div>
        <div className="space-y-1">
          {TOOLS.map((t) => {
            const inert = Boolean(t.needsSheet && sheets.length === 0)
            const isActive = tool === t.id && !inert
            const isBusy = busy === t.id
            return (
              <button
                key={t.id}
                type="button"
                disabled={inert || Boolean(busy)}
                onClick={() => pickTool(t.id)}
                aria-pressed={isActive}
                title={inert ? 'Pin some work first — these mark up a sheet' : t.label}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-semibold text-left transition-colors ${
                  isActive
                    ? 'bg-[#16181D] text-white'
                    : inert
                      ? 'text-[#B6BAC6] cursor-default'
                      : 'text-[#5A5E6B] hover:bg-[#16181D]/5'
                }`}
              >
                <span className="shrink-0">
                  {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : t.icon}
                </span>
                <span className="truncate">{t.label}</span>
              </button>
            )
          })}
        </div>

        <div className="mt-auto pt-4">
          <button
            type="button"
            onClick={toggleRecording}
            disabled={speechBlocked}
            title={
              unavailable
                ? unavailableMessage(unavailable)
                : 'Record the crit and transcribe it'
            }
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-bold transition-colors ${
              listening
                ? 'bg-[#D64545] text-white'
                : speechBlocked
                  ? 'bg-[#16181D]/5 text-[#B6BAC6] cursor-default'
                  : 'bg-[#3B6EF6] text-white hover:bg-[#3361DD]'
            }`}
          >
            <Mic className="w-4 h-4 shrink-0" />
            {listening ? 'Stop' : 'Record'}
          </button>
          <p className="text-[11px] leading-relaxed text-[#8A8FA0] mt-3 px-1">
            {unavailable
              ? unavailableMessage(unavailable)
              : focused
                ? 'Trace and callouts land on the open sheet.'
                : 'Open a sheet to trace or add callouts.'}
          </p>
        </div>
      </aside>

      {/* ---- Stage ---- */}
      <div className="flex-1 min-w-0 flex flex-col">
        {(problem || transcript.error || summary.error) && (
          <div className="shrink-0 flex items-center gap-2 px-4 py-2 bg-[#D64545]/10 text-[#D64545] text-[13px] font-semibold">
            <span className="flex-1">{problem || transcript.error || summary.error}</span>
            <button
              type="button"
              onClick={() => {
                setProblem(null)
                transcript.clearError()
                summary.clearError()
              }}
              aria-label="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-auto bg-[#EDF1F9]">
          {loading && sheets.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-[#8A8FA0]">
              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Opening…
            </div>
          ) : focused ? (
            <FocusedSheet
              sheet={focused}
              marks={focusedMarks}
              tool={tool}
              stroke={stroke}
              penColor={penColor}
              penWidth={penWidth}
              onPenColor={setPenColor}
              onPenWidth={setPenWidth}
              draftCallout={draftCallout}
              stageRef={stageRef}
              onBack={() => {
                void commitCallout()
                clearStroke()
                setFocusedId(null)
                setTool('select')
              }}
              onPointerDown={onStagePointerDown}
              onPointerMove={onStagePointerMove}
              onPointerUp={() => void commitStroke()}
              onPointerCancel={clearStroke}
              onDraftChange={(text) =>
                setDraft(draftRef.current ? { ...draftRef.current, text } : null)
              }
              onDraftCommit={() => void commitCallout()}
              onDraftCancel={() => setDraft(null)}
              onDeleteMark={(id) => void deleteNode(id)}
            />
          ) : sheets.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-sm font-bold text-[#16181D]">Nothing pinned yet</p>
              <p className="text-[13px] text-[#5A5E6B] max-w-sm">
                Pin the work you want to talk through. Open a sheet to trace over it or drop
                callouts, and hit Record to transcribe the crit.
              </p>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="mt-1 px-4 py-2 rounded-xl bg-[#3B6EF6] text-white text-sm font-semibold"
              >
                Pin work
              </button>
            </div>
          ) : (
            <div className="p-5 grid gap-4 grid-cols-[repeat(auto-fill,minmax(240px,1fr))]">
              {sheets.map((sheet) => {
                const count = marksBySheet.get(sheet.id)?.length ?? 0
                return (
                  <button
                    key={sheet.id}
                    type="button"
                    onClick={() => setFocusedId(sheet.id)}
                    className="group relative bg-white rounded-xl border border-[#16181D]/10 overflow-hidden hover:border-[#3B6EF6] transition-colors"
                  >
                    <div className="aspect-[4/3] flex items-center justify-center bg-white">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={String(sheet.props?.thumbUrl || sheet.props?.url || '')}
                        alt={String(sheet.props?.name || 'Pinned work')}
                        className="max-w-full max-h-full object-contain"
                        loading="lazy"
                      />
                    </div>
                    {count > 0 && (
                      <span className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-[#3B6EF6] text-white text-[10px] font-bold">
                        {count}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* ---- Transcript / summary tab bar ---- */}
        <div className="shrink-0 border-t border-[#16181D]/10 bg-white">
          <div className="flex items-center gap-1 px-3">
            <TabButton
              label="Transcript"
              active={panel === 'transcript'}
              live={listening}
              onClick={() => setPanel((p) => (p === 'transcript' ? null : 'transcript'))}
            />
            <TabButton
              label="Summary"
              active={panel === 'summary'}
              onClick={() => setPanel((p) => (p === 'summary' ? null : 'summary'))}
            />
            {loose.length > 0 && (
              <TabButton
                label={`Notes (${loose.length})`}

                active={panel === 'notes'}
                onClick={() => setPanel((p) => (p === 'notes' ? null : 'notes'))}
              />
            )}
            {(legacyCount > 0 || orphanCount > 0) && (
              <span
                className="ml-auto pr-1 text-[11px] text-[#8A8FA0]"
                title={
                  'Marks whose sheet was deleted, and drawings from the old canvas ' +
                  'surface. Neither can be shown here; they are listed so the count ' +
                  'on your desk card is not a promise this view breaks.'
                }
              >
                {[
                  legacyCount > 0 ? `${legacyCount} old drawing${legacyCount === 1 ? '' : 's'}` : '',
                  orphanCount > 0 ? `${orphanCount} orphaned mark${orphanCount === 1 ? '' : 's'}` : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            )}
          </div>

          {panel === 'transcript' && (
            <div className="max-h-56 overflow-y-auto px-4 py-3 border-t border-[#16181D]/8">
              {transcript.segments.length === 0 && !live ? (
                <p className="text-[13px] text-[#8A8FA0]">
                  Nothing recorded yet. Hit Record and talk through the work.
                </p>
              ) : (
                <div className="space-y-2">
                  {transcript.segments.map((seg) => (
                    <p key={seg.id} className="text-[13px] leading-relaxed text-[#16181D]">
                      {seg.text}
                    </p>
                  ))}
                  {live && (
                    <p className="text-[13px] leading-relaxed text-[#3B6EF6] italic">{live}</p>
                  )}
                </div>
              )}
              {transcript.fullText.trim() && (
                <button
                  type="button"
                  onClick={() => void handleSummarise()}
                  disabled={summarising}
                  className="mt-3 px-3 py-1.5 rounded-lg bg-[#16181D] text-white text-[12px] font-semibold disabled:opacity-60"
                >
                  {summarising ? 'Summarising…' : 'Summarise'}
                </button>
              )}
            </div>
          )}

          {panel === 'notes' && (
            <div className="max-h-56 overflow-y-auto px-4 py-3 border-t border-[#16181D]/8 space-y-2">
              {loose.map((n) => (
                <div
                  key={n.id}
                  className="flex items-start gap-2 rounded-lg bg-[#FFF8DC] border border-[#16181D]/8 px-3 py-2"
                >
                  <p className="flex-1 text-[13px] leading-snug text-[#16181D] whitespace-pre-wrap">
                    {String(n.props?.text ?? '')}
                  </p>
                  <button
                    type="button"
                    onClick={() => void deleteNode(n.id)}
                    title="Delete note"
                    className="shrink-0 p-1 rounded hover:bg-[#16181D]/6"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-[#D64545]" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {panel === 'summary' && (
            <div className="max-h-56 overflow-y-auto px-4 py-3 border-t border-[#16181D]/8">
              {summary.summary?.text ? (
                <ul className="space-y-1">
                  {summary.summary.text
                    .split('\n')
                    .map((l) => l.trim())
                    .filter(Boolean)
                    .map((line, i) => (
                      <li key={i} className="flex gap-2 text-[13px] leading-snug text-[#16181D]">
                        <span className="text-[#3B6EF6] shrink-0">•</span>
                        <span>{line}</span>
                      </li>
                    ))}
                </ul>
              ) : (
                <p className="text-[13px] text-[#8A8FA0]">
                  No summary yet. Record the crit, then Summarise from the transcript tab.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function TabButton({
  label,
  active,
  live,
  onClick,
}: {
  label: string
  active: boolean
  live?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-1.5 px-3 py-2 text-[12px] font-bold border-b-2 -mb-px transition-colors ${
        active
          ? 'border-[#3B6EF6] text-[#16181D]'
          : 'border-transparent text-[#8A8FA0] hover:text-[#5A5E6B]'
      }`}
    >
      {label}
      {live && <span className="w-1.5 h-1.5 rounded-full bg-[#D64545] animate-pulse" />}
    </button>
  )
}

/**
 * One sheet, full size, with its marks on top.
 *
 * The overlay is sized to the IMAGE, not to the stage, because a normalised
 * coordinate only means anything against the picture itself — letterboxing the
 * image inside a wider stage and then measuring against the stage would put
 * every mark at an offset that changed with the window.
 */
function FocusedSheet({
  sheet,
  marks,
  tool,
  stroke,
  penColor,
  penWidth,
  onPenColor,
  onPenWidth,
  draftCallout,
  stageRef,
  onBack,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onDraftChange,
  onDraftCommit,
  onDraftCancel,
  onDeleteMark,
}: {
  sheet: CanvasNode
  marks: Annotation[]
  tool: WorkTool
  stroke: number[][] | null
  penColor: string
  penWidth: number
  onPenColor: (c: string) => void
  onPenWidth: (w: number) => void
  draftCallout: { nx: number; ny: number; text: string } | null
  stageRef: React.RefObject<HTMLDivElement>
  onBack: () => void
  onPointerDown: (e: React.PointerEvent) => void
  onPointerMove: (e: React.PointerEvent) => void
  onPointerUp: () => void
  onPointerCancel: () => void
  onDraftChange: (text: string) => void
  onDraftCommit: () => void
  onDraftCancel: () => void
  onDeleteMark: (id: string) => void
}) {
  const strokes = marks.filter((m) => m.node.type === 'ink')
  const callouts = marks.filter((m) => m.node.type === 'sticky')
  const drawing = tool === 'trace' || tool === 'callout'

  /**
   * The sheet's rendered width, for converting stored fractional pen weights
   * into the pixels the SVG strokes in. Observed rather than measured once:
   * the box changes with the window and with the tab panel opening beneath it,
   * and a stale width would draw every stroke at the wrong weight.
   */
  const [boxW, setBoxW] = useState(0)
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    setBoxW(el.getBoundingClientRect().width)
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (typeof w === 'number') setBoxW(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [stageRef, sheet.id])

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 flex items-center gap-2 px-4 py-2">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold text-[#5A5E6B] hover:bg-[#16181D]/6"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          All work
        </button>
        <span className="text-[12px] font-semibold text-[#16181D] truncate">
          {String(sheet.props?.name || 'Sheet')}
        </span>
        {drawing && (
          <span className="text-[11px] text-[#8A8FA0]">
            {tool === 'trace' ? 'Drag to draw' : 'Click where the note goes'}
          </span>
        )}
        {/* The pen, laid out like the lightbox's: four colours, two weights,
            undo, clear. Same palette module, so the red is the same red. */}
        {tool === 'trace' && (
          <div className="ml-auto flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              {TRACE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => onPenColor(c)}
                  aria-label={`Pen colour ${c}`}
                  aria-pressed={penColor === c}
                  className={`w-5 h-5 rounded-full transition-transform hover:scale-110 ${
                    penColor === c ? 'ring-2 ring-offset-1 ring-[#16181D]' : ''
                  }`}
                  style={{ background: c }}
                />
              ))}
            </div>
            <div className="flex items-center rounded-lg bg-[#16181D]/6 p-0.5">
              {TRACE_WIDTHS.map((w) => (
                <button
                  key={w.label}
                  type="button"
                  onClick={() => onPenWidth(w.value)}
                  aria-pressed={penWidth === w.value}
                  className={`px-2 py-1 rounded text-[10px] font-bold ${
                    penWidth === w.value ? 'bg-white text-[#16181D] shadow-sm' : 'text-[#5A5E6B]'
                  }`}
                >
                  {w.label}
                </button>
              ))}
            </div>
            {strokes.length > 0 && (
              <button
                type="button"
                // Newest by createdAt, not last in the array: the list comes
                // back in whatever order the API gives, so "last" is not
                // reliably the one just drawn.
                onClick={() => {
                  const newest = [...strokes].sort((a, b) =>
                    a.node.createdAt < b.node.createdAt ? 1 : -1
                  )[0]
                  if (newest) onDeleteMark(newest.node.id)
                }}
                title="Undo the last stroke"
                className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-semibold text-[#5A5E6B] hover:bg-[#16181D]/6"
              >
                <Undo2 className="w-3.5 h-3.5" />
                Undo
              </button>
            )}
          </div>
        )}
        {strokes.length > 0 && (
          <button
            type="button"
            onClick={() => strokes.forEach((m) => onDeleteMark(m.node.id))}
            title="Remove every trace stroke on this sheet"
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-[#5A5E6B] hover:bg-[#16181D]/6 ${
              tool === 'trace' ? '' : 'ml-auto'
            }`}
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 flex items-center justify-center p-5">
        {/* aspect-ratio is what makes this box EXACTLY the picture.
            It used to shrink-wrap an <img> capped at a hardcoded
            calc(100vh-260px) — a number that knew nothing about the tab panel
            below. Open the transcript (which Record does automatically) and the
            available space dropped ~224px while the image's cap did not, so the
            picture overflowed a shorter box: every saved mark shifted up and
            compressed, and new points normalised against the wrong height.
            Sizing from the sheet's own aspect keeps box and picture identical
            at any container size, with no measurement to go stale. */}
        <div
          ref={stageRef}
          className="relative max-w-full max-h-full"
          style={{
            aspectRatio: `${sheet.w} / ${sheet.h}`,
            touchAction: drawing ? 'none' : undefined,
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          // Cancel ABORTS. Routing it to commit meant a stroke interrupted by
          // the OS (a gesture, a context menu) was written as if finished.
          onPointerCancel={onPointerCancel}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={String(sheet.props?.url || sheet.props?.thumbUrl || '')}
            alt={String(sheet.props?.name || 'Pinned work')}
            className="block w-full h-full object-contain select-none"
            draggable={false}
          />

          {/* Strokes. viewBox 0..1 with a non-uniform aspect so normalised
              points map straight onto the picture at any rendered size. */}
          <svg
            viewBox="0 0 1 1"
            preserveAspectRatio="none"
            className="absolute inset-0 w-full h-full pointer-events-none"
          >
            {strokes.map((m) => (
              <StrokePath key={m.node.id} node={m.node} boxW={boxW} />
            ))}
            {stroke && stroke.length > 1 && (
              <polyline
                points={stroke.map(([x, y]) => `${x},${y}`).join(' ')}
                fill="none"
                stroke={penColor}
                strokeWidth={tracePx(penWidth, boxW)}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>

          {callouts.map((m, i) => {
            const nx = Number(m.node.props?.nx ?? 0)
            const ny = Number(m.node.props?.ny ?? 0)
            return (
              <div
                key={m.node.id}
                className="absolute group"
                style={{ left: `${nx * 100}%`, top: `${ny * 100}%` }}
              >
                <div className="-translate-x-1/2 -translate-y-1/2 flex items-start gap-1.5">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-[#3B6EF6] text-white text-[10px] font-bold flex items-center justify-center shadow">
                    {i + 1}
                  </span>
                  <span className="max-w-[220px] px-2 py-1 rounded-lg bg-white/95 border border-[#16181D]/10 text-[11px] leading-snug text-[#16181D] shadow-sm">
                    {String(m.node.props?.text ?? '')}
                  </span>
                  <button
                    type="button"
                    // pointerdown too, not just click: the stage's handler
                    // runs on pointerdown, so deleting a callout while Trace or
                    // Callout was active also began a stroke or opened a stray
                    // composer underneath the button.
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      onDeleteMark(m.node.id)
                    }}
                    title="Delete callout"
                    className="opacity-0 group-hover:opacity-100 shrink-0 p-1 rounded bg-white border border-[#16181D]/10"
                  >
                    <Trash2 className="w-3 h-3 text-[#D64545]" />
                  </button>
                </div>
              </div>
            )
          })}

          {draftCallout && (
            <div
              className="absolute z-10"
              style={{ left: `${draftCallout.nx * 100}%`, top: `${draftCallout.ny * 100}%` }}
            >
              <div className="-translate-x-1/2 -translate-y-1/2">
                <textarea
                  autoFocus
                  value={draftCallout.text}
                  onChange={(e) => onDraftChange(e.target.value)}
                  onPointerDown={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    // Enter commits; Shift+Enter is a newline. isComposing
                    // guards an IME candidate selection, which also sends Enter.
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault()
                      onDraftCommit()
                    }
                    if (e.key === 'Escape') onDraftCancel()
                    e.stopPropagation()
                  }}
                  onBlur={onDraftCommit}
                  rows={2}
                  placeholder="What about this?"
                  className="w-56 px-2 py-1.5 rounded-lg border border-[#3B6EF6] bg-white text-[12px] text-[#16181D] outline-none resize-none shadow-lg"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function StrokePath({ node, boxW }: { node: CanvasNode; boxW: number }) {
  const pts = node.props?.pts
  if (!Array.isArray(pts) || pts.length < MIN_STROKE_POINTS) return null
  const d = (pts as number[][])
    .map(([x, y]) => `${x},${y}`)
    .join(' ')
  return (
    <polyline
      points={d}
      fill="none"
      stroke={String(node.props?.color ?? TRACE_COLORS[0])}
      strokeWidth={tracePx(Number(node.props?.size ?? TRACE_WIDTHS[0].value), boxW)}
      strokeLinecap="round"
      strokeLinejoin="round"
      vectorEffect="non-scaling-stroke"
    />
  )
}
