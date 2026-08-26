'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  MousePointer2,
  Pin,
  PenLine,
  MessageSquarePlus,
  Mic,
  Loader2,
  Trash2,
  X,
  Eraser,
  Plus,
  Minus,
  PanelRightClose,
  PanelRightOpen,
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
import type { CanvasNodeInput } from '@/hooks/useCanvasNodes'
import {
  IDENTITY_VIEWPORT,
  clampZoom,
  toScreen,
  fitBounds,
  panBy,
  zoomAt,
  type Viewport,
} from '@/lib/canvas/viewport'

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
/** Smallest a sheet may be scaled to, as a fraction of its pinned size. */
const MIN_SHEET_SCALE = 0.15
/** ...and an absolute floor in canvas units, so a tiny source image stays grabbable. */
const MIN_SHEET_PX = 80
/** How many steps of history to keep. Deep enough for a crit, bounded so a long
 *  session cannot grow it without limit. */
const HISTORY_LIMIT = 50

/* ---- Wheel zoom feel ----------------------------------------------------
 * deltaY arrives in whatever unit deltaMode names, so lines and pages are
 * converted to pixels first. 16 is a normal line-height; a page is treated as
 * a large but bounded scroll rather than the viewport, which would make one
 * page-scroll swallow the whole zoom range.
 */
const WHEEL_LINE_PX = 16
const WHEEL_PAGE_PX = 400
/** Cap on one event's contribution, so a flung wheel steps rather than leaps. */
const WHEEL_MAX_STEP_PX = 120
/**
 * Feel dial. zoom multiplies by exp(-delta / this), so a ~100px notch lands
 * near 1.09 — about a 9% step, which is roughly what Miro and Figma give you.
 * The old value was 100, i.e. exp(-1) ≈ 0.37, a 63% jump per click.
 */
const WHEEL_ZOOM_DIVISOR = 1150
/** How much of the remaining distance to cover per frame. */
const ZOOM_EASE = 0.22
/** Within this fraction of the target, snap and stop. */
const ZOOM_SETTLE_EPSILON = 0.001

/** Composer size, used to keep it clamped inside the surface. */
const COMPOSER_W = 240
const COMPOSER_H = 132

/** "Just now" / "12m" / "3h" / "5d" — the panel wants an age, not a date. */
function relativeTime(iso: string): string {
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return ''
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (secs < 60) return 'Just now'
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

/**
 * One reversible action. `create` covers anything that added a node — a
 * stroke, a callout, a pinned sheet; `layout` covers a move or a resize.
 */
type HistoryEntry =
  | { kind: 'create'; id: string; input: CanvasNodeInput }
  /** A node that was removed. Undo re-creates it; redo removes it again. */
  | { kind: 'delete'; id: string; input: CanvasNodeInput }
  | {
      kind: 'layout'
      id: string
      before: { x: number; y: number; w: number; h: number }
      after: { x: number; y: number; w: number; h: number }
    }

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
  const { nodes, createNode, deleteNode, loading, beginGesture, endGesture, previewNode, commitNode } = useCanvasNodes(canvasId, null, {
    realtime: false,
  })
  const transcript = useCritTranscript(canvasId)
  const summary = useCritSummary(canvasId)
  const speech = useSpeechTranscription()
  const { upload } = useDirectUpload()

  const [tool, setTool] = useState<WorkTool>('select')
  const [focusedId, setFocusedId] = useState<string | null>(null)
  // Defaults to the transcript now that the panel is a permanent column — an
  // always-present aside with nothing in it would just be a blank margin.
  const [panel, setPanel] = useState<'transcript' | 'summary' | 'notes'>('transcript')
  /**
   * Whether the right-hand column is open. Separate from `panel`: which tab you
   * were reading survives a close, so reopening puts you back where you were
   * rather than resetting to the transcript.
   */
  const [panelOpen, setPanelOpen] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [summarising, setSummarising] = useState(false)
  /** An open callout composer, at normalised coordinates on the focused sheet. */
  const [draftCallout, setDraftCallout] = useState<{ sheetId: string; nx: number; ny: number; text: string } | null>(
    null
  )
  const [stroke, setStroke] = useState<number[][] | null>(null)
  const [penColor, setPenColor] = useState<string>(TRACE_COLORS[0])
  const [penWidth, setPenWidth] = useState<number>(TRACE_WIDTHS[0].value)
  /**
   * Draw or erase. A mode on the Trace tool rather than a fifth tool in the
   * rail: erasing is something you do WHILE tracing, and putting it up there
   * would have implied it does something on its own.
   */
  const [penMode, setPenMode] = useState<'draw' | 'erase'>('draw')

  /** Ref and state together, always — see draftRef. */
  const setDraft = useCallback((next: { sheetId: string; nx: number; ny: number; text: string } | null) => {
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
   * Latest nodes, for reading a sheet's live box when a drag ends. The gesture
   * writes through previewNode, so the committed value has to come from state
   * rather than from the sheet captured when the drag began.
   */
  const nodesRef = useRef<CanvasNode[]>([])
  useEffect(() => {
    nodesRef.current = nodes
  }, [nodes])

  /**
   * Undo / redo over the things you can do to the stage.
   *
   * A stack of inverses rather than snapshots of the whole crit: the nodes are
   * server-owned and a refetch can land at any moment, so replaying a stored
   * copy of "how it used to look" would happily resurrect something a
   * collaborator deleted. Each entry instead knows how to undo ITSELF, and
   * every one of those is an ordinary write through the same API the original
   * action used.
   *
   * Creates are not inverted by re-creating: a node's id is assigned by the
   * server, so redoing a delete makes a NEW node. Marks carry their sheet in
   * props, so it lands back on the right sheet, but its id changes — which is
   * why redo re-reads from the entry rather than caching ids.
   */
  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([])
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([])

  const pushHistory = useCallback((entry: HistoryEntry) => {
    setUndoStack((prev) => [...prev.slice(-HISTORY_LIMIT + 1), entry])
    // A new action forks the timeline; anything redone from here on would be
    // from a history that no longer happened.
    setRedoStack([])
  }, [])

  const [editingCallout, setEditingCallout] = useState(false)
  const [editText, setEditText] = useState('')

  /**
   * Resolve / unresolve. Stored on the node's own props rather than a column:
   * canvas_nodes.props is JSON, so this needs no migration, and a resolved
   * callout is a property OF the mark rather than a separate record about it.
   */
  const toggleResolved = useCallback(
    (node: CanvasNode) => {
      const next = !node.props?.resolved
      void commitNode(node.id, { props: { ...(node.props ?? {}), resolved: next } })
    },
    [commitNode]
  )

  const saveCalloutText = useCallback(
    (node: CanvasNode, text: string) => {
      const next = text.trim()
      setEditingCallout(false)
      if (!next || next === String(node.props?.text ?? '')) return
      void commitNode(node.id, { props: { ...(node.props ?? {}), text: next } })
    },
    [commitNode]
  )

  /**
   * Delete a node and keep it undoable.
   *
   * The payload is rebuilt from the node itself so undo can re-create it. Its
   * id will differ afterwards — ids are server-assigned — which is fine for
   * marks, since a mark finds its sheet through props.onNodeId rather than
   * through its own identity.
   */
  const deleteTracked = useCallback(
    async (id: string) => {
      const node = nodesRef.current.find((n) => n.id === id)
      const ok = await deleteNode(id)
      if (ok && node) {
        pushHistory({
          kind: 'delete',
          id,
          input: {
            type: node.type,
            x: node.x,
            y: node.y,
            w: node.w,
            h: node.h,
            props: node.props ?? {},
          } as CanvasNodeInput,
        })
      }
      return ok
    },
    [deleteNode, pushHistory]
  )

  const createTracked = useCallback(
    async (input: CanvasNodeInput) => {
      const made = await createNode(input)
      if (made) pushHistory({ kind: 'create', id: made.id, input })
      return made
    },
    [createNode, pushHistory]
  )

  const applyEntry = useCallback(
    async (entry: HistoryEntry, direction: 'undo' | 'redo'): Promise<HistoryEntry | null> => {
      if (entry.kind === 'layout') {
        const to = direction === 'undo' ? entry.before : entry.after
        const ok = await commitNode(entry.id, to)
        return ok ? entry : null
      }
      // 'create' undone is a delete and redone is a fresh create; 'delete' is
      // the same two operations the other way round.
      const creating = entry.kind === 'create' ? direction === 'redo' : direction === 'undo'
      if (creating) {
        const made = await createNode(entry.input)
        return made ? { ...entry, id: made.id } : null
      }
      const ok = await deleteNode(entry.id)
      return ok ? entry : null
    },
    [commitNode, createNode, deleteNode]
  )

  const undo = useCallback(async () => {
    const entry = undoStack[undoStack.length - 1]
    if (!entry) return
    setUndoStack((prev) => prev.slice(0, -1))
    const settled = await applyEntry(entry, 'undo')
    if (settled) setRedoStack((prev) => [...prev, settled])
  }, [undoStack, applyEntry])

  const redo = useCallback(async () => {
    const entry = redoStack[redoStack.length - 1]
    if (!entry) return
    setRedoStack((prev) => prev.slice(0, -1))
    const settled = await applyEntry(entry, 'redo')
    if (settled) setUndoStack((prev) => [...prev, settled])
  }, [redoStack, applyEntry])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      const k = e.key.toLowerCase()
      if (k !== 'z' && k !== 'y') return
      // Never steal the shortcut from a field the user is typing in — the
      // callout composer and the transcript are both live text surfaces.
      const el = e.target as HTMLElement | null
      if (el && (el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName))) return
      e.preventDefault()
      // Ctrl+Y and Ctrl+Shift+Z are both redo; Windows and mac each expect one.
      if (k === 'y' || e.shiftKey) void redo()
      else void undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  /**
   * An in-flight move or resize of a sheet.
   *
   * Sheets carry a real x/y/w/h — they always have, from the canvas this view
   * replaced — and the overview grid simply ignored them and drew uniform
   * cards. Honouring them is what lets you lay the work out and mark it in
   * place instead of clicking into one sheet at a time.
   *
   * Aspect is locked on resize: marks are normalised 0..1 against the sheet, so
   * stretching one would keep every mark in the right RELATIVE place while the
   * picture itself distorted. Scaling is what was asked for; stretching is not.
   */
  const layoutRef = useRef<
    | {
        id: string
        mode: 'move' | 'resize'
        startX: number
        startY: number
        origin: { x: number; y: number; w: number; h: number }
      }
    | null
  >(null)
  const [layoutBusy, setLayoutBusy] = useState(false)
  /** endLayout, reachable from moveLayout which is declared before it. */
  const endLayoutRef = useRef<(() => void) | null>(null)

  const beginLayout = useCallback(
    (sheet: CanvasNode, mode: 'move' | 'resize', e: React.PointerEvent) => {
      e.stopPropagation()
      e.preventDefault()
      ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
      layoutRef.current = {
        id: sheet.id,
        mode,
        startX: e.clientX,
        startY: e.clientY,
        origin: { x: sheet.x, y: sheet.y, w: sheet.w, h: sheet.h },
      }
      // Suspends realtime reconciliation for this node so an in-flight refetch
      // can't yank it back mid-drag.
      beginGesture([sheet.id])
      setLayoutBusy(true)
    },
    [beginGesture]
  )

  const moveLayout = useCallback(
    (e: React.PointerEvent) => {
      const g = layoutRef.current
      if (!g) return
      // No button held means the press that started this is gone — end rather
      // than keep dragging. Cheap insurance against a lost pointerup.
      if (e.buttons === 0) {
        endLayoutRef.current?.()
        return
      }
      // Screen pixels -> canvas units. Without dividing by zoom a sheet
      // dragged while zoomed out would race the cursor, and while zoomed in
      // would crawl behind it.
      const zoom = viewportRef.current.zoom || 1
      const dx = (e.clientX - g.startX) / zoom
      const dy = (e.clientY - g.startY) / zoom
      if (g.mode === 'move') {
        previewNode(g.id, { x: g.origin.x + dx, y: g.origin.y + dy })
      } else {
        // Drive the scale off whichever axis the pointer moved further on, so
        // a diagonal drag does not fight itself.
        const byW = (g.origin.w + dx) / g.origin.w
        const byH = (g.origin.h + dy) / g.origin.h
        const scale = Math.max(MIN_SHEET_SCALE, Math.abs(dx) > Math.abs(dy) ? byW : byH)
        previewNode(g.id, {
          w: Math.max(MIN_SHEET_PX, Math.round(g.origin.w * scale)),
          h: Math.max(MIN_SHEET_PX, Math.round(g.origin.h * scale)),
        })
      }
    },
    [previewNode]
  )

  const endLayout = useCallback(() => {
    const g = layoutRef.current
    layoutRef.current = null
    setLayoutBusy(false)
    if (!g) return
    const live = nodesRef.current.find((n) => n.id === g.id)
    endGesture([g.id])
    if (!live) return
    const moved =
      live.x !== g.origin.x || live.y !== g.origin.y ||
      live.w !== g.origin.w || live.h !== g.origin.h
    // A click that never moved is a selection, not a layout change; writing it
    // would be a pointless round trip on every tap.
    if (!moved) return
    const after = { x: live.x, y: live.y, w: live.w, h: live.h }
    pushHistory({ kind: 'layout', id: g.id, before: g.origin, after })
    void commitNode(g.id, after)
  }, [endGesture, commitNode, pushHistory])
  endLayoutRef.current = endLayout
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
  const draftRef = useRef<{ sheetId: string; nx: number; ny: number; text: string } | null>(null)

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


  /**
   * The sheet the mark handlers are currently pointed at.
   *
   * A ref, not the `focusedId` state, because both are set from the SAME
   * pointerdown: StageSheet claims the sheet, then the shared handler runs
   * immediately after in the same tick, and state has not re-rendered yet.
   * Reading the state there would bind the first stroke on a newly-touched
   * sheet to whichever sheet was touched before it. focusedId still exists —
   * it drives the ring on the active sheet — but nothing correctness-critical
   * reads it.
   */
  const [selectedCalloutId, setSelectedCalloutId] = useState<string | null>(null)

  /**
   * Pan and zoom, back from the infinite canvas this view replaced.
   *
   * The canvas was dropped because free-floating sheets in an unbounded space
   * were something you had to go hunting for. That was about the LAYOUT, not
   * the viewport — being able to push the work around and zoom into a corner of
   * a drawing is the part that was worth keeping, and a fixed scroller is a
   * poor substitute for it. The tools stay as they are; only the surface they
   * act on moves.
   *
   * Shared math, not a second copy: lib/canvas/viewport.ts already owns the
   * transform, its zoom limits and the anchor-preserving zoom, and it is what
   * the infinite canvas itself used.
   */
  const [viewport, setViewport] = useState<Viewport>(IDENTITY_VIEWPORT)
  const viewportRef = useRef(viewport)
  useEffect(() => {
    viewportRef.current = viewport
  }, [viewport])

  const surfaceRef = useRef<HTMLDivElement | null>(null)
  /** In-flight eased zoom: where it is heading, about which point. */
  const zoomAnimRef = useRef<{
    target: number
    anchor: { x: number; y: number }
    raf: number | null
  } | null>(null)
  /** True while the surface itself is being dragged, as opposed to a sheet. */
  const panRef = useRef<{ x: number; y: number } | null>(null)
  const [panning, setPanning] = useState(false)

  const zoomBy = useCallback((factor: number) => {
    const el = surfaceRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setViewport((vp) => zoomAt(vp, { x: r.width / 2, y: r.height / 2 }, factor))
  }, [])

  const zoomFit = useCallback(() => {
    const el = surfaceRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const live = nodesRef.current.filter((n) => n.type === 'image' && !n.props?.onNodeId)
    if (live.length === 0) {
      setViewport(IDENTITY_VIEWPORT)
      return
    }
    setViewport(
      fitBounds(
        {
          minX: Math.min(...live.map((n) => n.x)),
          minY: Math.min(...live.map((n) => n.y)),
          maxX: Math.max(...live.map((n) => n.x + n.w)),
          maxY: Math.max(...live.map((n) => n.y + n.h)),
        },
        r.width,
        r.height
      )
    )
  }, [])

  /**
   * Wheel zoom, anchored on the cursor and eased into place.
   *
   * Bound natively rather than through React's onWheel because React attaches
   * wheel passively, and a passive listener cannot preventDefault — so the page
   * would scroll underneath every zoom.
   *
   * Three things this has to get right, and the naive version got none of them:
   *
   * 1. deltaY IS NOT IN PIXELS. deltaMode says whether it counts pixels, LINES
   *    or PAGES, and a mouse wheel on Windows commonly reports lines. Reading
   *    the raw number treats "3 lines" and "3 pixels" as the same gesture.
   * 2. ONE NOTCH IS ALREADY A BIG NUMBER. A pixel-mode wheel notch is ~100, and
   *    exp(-100/100) is 0.37 — a 63% zoom-out from one click. The divisor sets
   *    the feel, and it wants to be far gentler than the delta is large.
   * 3. A WHEEL IS DISCRETE. Applying each notch immediately is a jump-cut per
   *    click; what reads as smooth is a target the view eases toward, so a
   *    fast scroll becomes one continuous move rather than a stack of steps.
   */
  useEffect(() => {
    const el = surfaceRef.current
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()

      // Normalise to pixels, then cap: a single violent notch (or a
      // momentum-scroll spike) should still only be one step's worth.
      const perUnit = e.deltaMode === 1 ? WHEEL_LINE_PX : e.deltaMode === 2 ? WHEEL_PAGE_PX : 1
      const raw = e.deltaY * perUnit
      const delta = Math.max(-WHEEL_MAX_STEP_PX, Math.min(WHEEL_MAX_STEP_PX, raw))

      const anim = zoomAnimRef.current
      const from = anim ? anim.target : viewportRef.current.zoom
      zoomAnimRef.current = {
        target: clampZoom(from * Math.exp(-delta / WHEEL_ZOOM_DIVISOR)),
        // Latest cursor wins: if you scroll, move, and scroll again, the zoom
        // should follow the pointer rather than stay pinned where it started.
        anchor: { x: e.clientX - r.left, y: e.clientY - r.top },
        raf: anim?.raf ?? null,
      }
      if (!zoomAnimRef.current.raf) {
        zoomAnimRef.current.raf = requestAnimationFrame(step)
      }
    }

    const step = () => {
      const anim = zoomAnimRef.current
      if (!anim) return
      const current = viewportRef.current.zoom
      const remaining = anim.target - current
      // Close enough: land exactly on the target and stop, so the loop does not
      // idle forever chasing a fraction of a percent.
      if (Math.abs(remaining) < current * ZOOM_SETTLE_EPSILON) {
        if (current !== anim.target) {
          setViewport((vp) => zoomAt(vp, anim.anchor, anim.target / vp.zoom))
        }
        zoomAnimRef.current = null
        return
      }
      const next = current + remaining * ZOOM_EASE
      setViewport((vp) => zoomAt(vp, anim.anchor, next / vp.zoom))
      anim.raf = requestAnimationFrame(step)
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
      if (zoomAnimRef.current?.raf) cancelAnimationFrame(zoomAnimRef.current.raf)
      zoomAnimRef.current = null
    }
  }, [])


  /**
   * Callouts by id, carrying the number their pin shows.
   *
   * Numbering runs per sheet so "3" in the panel is the "3" you can see on the
   * work — the panel is a reading of one mark, not an entry in a separate
   * register with its own ordering.
   */
  const calloutIndex = useMemo(() => {
    const byId = new Map<string, { node: CanvasNode; n: number }>()
    for (const sheet of sheets) {
      const marks = (marksBySheet.get(sheet.id) ?? []).filter((m) => m.node.type === 'sticky')
      marks.forEach((m, i) => byId.set(m.node.id, { node: m.node, n: i + 1 }))
    }
    return byId
  }, [sheets, marksBySheet])

  const selectedCallout = selectedCalloutId ? calloutIndex.get(selectedCalloutId) ?? null : null

  const activeSheetRef = useRef<CanvasNode | null>(null)
  const claimSheet = useCallback((sheet: CanvasNode, el: HTMLDivElement | null) => {
    activeSheetRef.current = sheet
    stageRef.current = el
    setFocusedId(sheet.id)
  }, [])


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
          await createTracked({
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
    const focused = activeSheetRef.current
    if (!focused || !held || held.pts.length < MIN_STROKE_POINTS) return
    // Points captured on a different sheet are discarded rather than written
    // onto this one. Losing a stroke the user has already lost track of beats
    // drawing it across someone else's work.
    if (held.sheetId !== focused.id) return
    const pts = held.pts
    await createTracked({
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
  }, [createNode, penColor, penWidth])

  const commitCallout = useCallback(async () => {
    // Taken, not read: whichever of Enter / blur / the next click gets here
    // first wins, and the others find nothing left to do.
    const draft = draftRef.current
    draftRef.current = null
    setDraftCallout(null)
    const focused = activeSheetRef.current
    if (!focused || !draft) return
    const text = draft.text.trim()
    if (!text) return
    await createTracked({
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
  }, [createNode])

  const onStagePointerDown = useCallback(
    (e: React.PointerEvent) => {
      const focused = activeSheetRef.current
      if (!focused) return
      // Erasing is handled by the strokes' own hit lines; starting a stroke
      // here as well would draw a new mark under the one being rubbed out.
      if (tool === 'trace' && penMode === 'erase') return
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
      // Callout is deliberately NOT handled here — see onStageClick.
    },
    [tool, penMode, normalisedPoint]
  )

  /**
   * Place a callout. On CLICK, not pointerdown.
   *
   * Opening it on pointerdown destroyed it within the same gesture: the
   * textarea mounts and autofocuses mid-click, then the rest of that click
   * moves focus away, firing onBlur — which committed an empty draft and closed
   * the composer. The bubble never appeared, so the button looked dead. By
   * click time focus has settled and the composer survives being opened.
   */
  const onStageClick = useCallback(
    (e: React.MouseEvent) => {
      if (!activeSheetRef.current || tool !== 'callout') return
      const el = stageRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return
      // Save the one already open before opening another, or placing a second
      // callout silently discards the first one's text.
      if (draftRef.current) void commitCallout()
      setDraft({
        sheetId: activeSheetRef.current.id,
        nx: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
        ny: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
        text: '',
      })
    },
    [tool, commitCallout, setDraft]
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
      // No sheet to "open" any more: a mark claims whichever sheet it lands
      // on, so Trace and Callout only need SOMETHING pinned, which is what the
      // rail already gates them on.
      setTool(next)
    },
    [commitCallout]
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

        {/* The pen lived in the focused sheet's header, which no longer exists —
            and it never belonged to a sheet anyway, it belongs to the Trace
            tool. Same palette module the lightbox uses, so the red is the same
            red. */}
        {tool === 'trace' && (
          <div className="mt-4 px-1">
            <div className="text-[10px] font-bold tracking-[0.16em] uppercase text-[#8A8FA0] mb-2">
              Pen
            </div>
            <div className="flex items-center gap-1.5 mb-2">
              {TRACE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    setPenColor(c)
                    // Picking a colour means you want to draw with it.
                    setPenMode('draw')
                  }}
                  aria-label={`Pen colour ${c}`}
                  aria-pressed={penColor === c}
                  className={`w-5 h-5 rounded-full transition-transform hover:scale-110 ${
                    penColor === c ? 'ring-2 ring-offset-1 ring-[#16181D]' : ''
                  }`}
                  style={{ background: c }}
                />
              ))}
              <button
                type="button"
                onClick={() => setPenMode((m) => (m === 'erase' ? 'draw' : 'erase'))}
                title="Erase strokes — click or drag across them"
                aria-label="Eraser"
                aria-pressed={penMode === 'erase'}
                className={`ml-auto p-1 rounded-md border transition-colors ${
                  penMode === 'erase'
                    ? 'bg-[#16181D] border-[#16181D] text-white'
                    : 'border-[#16181D]/12 text-[#5A5E6B] hover:bg-[#16181D]/6'
                }`}
              >
                <Eraser className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex items-center rounded-lg bg-[#16181D]/6 p-0.5">
              {TRACE_WIDTHS.map((w) => (
                <button
                  key={w.label}
                  type="button"
                  onClick={() => {
                    setPenWidth(w.value)
                    setPenMode('draw')
                  }}
                  aria-pressed={penWidth === w.value}
                  className={`flex-1 px-2 py-1 rounded text-[10px] font-bold ${
                    penWidth === w.value ? 'bg-white text-[#16181D] shadow-sm' : 'text-[#5A5E6B]'
                  }`}
                >
                  {w.label}
                </button>
              ))}
            </div>
          </div>
        )}

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
              : sheets.length === 0
                ? 'Pin some work to trace over it or add callouts.'
                : tool === 'select'
                  ? 'Drag the grip to move a sheet, the corner to scale it.'
                  : 'Marks land on whichever sheet you draw on.'}
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

        <div
          ref={surfaceRef}
          className="flex-1 min-h-0 relative overflow-hidden bg-[#EDF1F9]"
          style={{
            cursor: panning ? 'grabbing' : undefined,
            // The canvas's own paper: a grid that moves and scales with the
            // work, so panning reads as moving over a surface rather than as
            // content sliding under a static background.
            backgroundImage:
              'linear-gradient(to right, rgba(22,24,29,0.05) 1px, transparent 1px),' +
              'linear-gradient(to bottom, rgba(22,24,29,0.05) 1px, transparent 1px)',
            backgroundSize: `${24 * viewport.zoom}px ${24 * viewport.zoom}px`,
            backgroundPosition: `${viewport.tx}px ${viewport.ty}px`,
          }}
          // Right-drag pans, from anywhere — including from on top of a sheet,
          // which is the point: the left button now moves sheets, so pan needed
          // a button of its own that never competes with it.
          onContextMenu={(e) => e.preventDefault()}
          onPointerDown={(e) => {
            if (e.button !== 2 && e.button !== 1) {
              // A plain left click on bare surface just clears the selection.
              if (e.button === 0 && e.target === e.currentTarget) setSelectedCalloutId(null)
              return
            }
            // Never start a pan on top of a gesture already holding the pointer.
            // A second button pressed mid-drag still bubbles here, and taking
            // capture for the surface orphaned the sheet's (or the stroke's)
            // pointerup: the gesture never ended, beginGesture never closed, and
            // the sheet kept following the cursor with no button held.
            if (layoutRef.current || strokeRef.current) return
            e.preventDefault()
            ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
            panRef.current = { x: e.clientX, y: e.clientY }
            setPanning(true)
          }}
          onPointerMove={(e) => {
            const from = panRef.current
            if (!from) return
            panRef.current = { x: e.clientX, y: e.clientY }
            setViewport((vp) => panBy(vp, e.clientX - from.x, e.clientY - from.y))
          }}
          onPointerUp={() => {
            panRef.current = null
            setPanning(false)
          }}
          onPointerCancel={() => {
            panRef.current = null
            setPanning(false)
          }}
        >
          {loading && sheets.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-[#8A8FA0]">
              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Opening…
            </div>
          ) : sheets.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-sm font-bold text-[#16181D]">Nothing pinned yet</p>
              <p className="text-[13px] text-[#5A5E6B] max-w-sm">
                Pin the work you want to talk through, drag it where you want it, then trace
                over it or drop callouts. Hit Record to transcribe the crit.
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
            /* Every sheet at its own size and place, marked where it sits.
               There is no longer an overview of cards you click into: opening
               one sheet at a time meant the work you were comparing was never
               on screen together, and the extra step bought nothing the layout
               does not already give you. */
            <div
              className="absolute top-0 left-0 origin-top-left"
              style={{
                transform: `translate(${viewport.tx}px, ${viewport.ty}px) scale(${viewport.zoom})`,
              }}
              onPointerMove={moveLayout}
              onPointerUp={endLayout}
              onPointerCancel={endLayout}
            >
              {sheets.map((sheet) => (
                <StageSheet
                  key={sheet.id}
                  sheet={sheet}
                  marks={marksBySheet.get(sheet.id) ?? []}
                  tool={tool}
                  active={focusedId === sheet.id}
                  stroke={focusedId === sheet.id ? stroke : null}
                  penColor={penColor}
                  penWidth={penWidth}
                  layoutBusy={layoutBusy}
                  selectedCalloutId={selectedCalloutId}
                  onSelectCallout={setSelectedCalloutId}
                  erasing={tool === 'trace' && penMode === 'erase'}
                  // Whichever sheet the gesture began on becomes the one the
                  // shared handlers normalise against and commit to.
                  onMarkStart={(el) => claimSheet(sheet, el)}
                  onMoveStart={(e) => beginLayout(sheet, 'move', e)}
                  onResizeStart={(e) => beginLayout(sheet, 'resize', e)}
                  onPointerDown={onStagePointerDown}
                  onClick={onStageClick}
                  onPointerMove={onStagePointerMove}
                  onPointerUp={() => void commitStroke()}
                  onPointerCancel={clearStroke}
                  onDeleteMark={(id) => void deleteTracked(id)}
                />
              ))}
            </div>
          )}

          {/* The composer, in SCREEN space rather than on the sheet.
              It used to live inside the sheet's box, which meant two things
              wrong at once: the box is overflow-hidden for its rounded corners,
              so a callout near an edge was clipped in half, and it sat inside
              the zoom transform, so at 152% the card and its buttons rendered
              half again too big. It is transient UI about the work, not part of
              it, so it belongs above the canvas at a fixed size — and it is
              clamped to stay fully on screen wherever you click. */}
          {draftCallout && (() => {
            const sheet = sheets.find((sh) => sh.id === draftCallout.sheetId)
            if (!sheet) return null
            const pt = toScreen(viewport, {
              x: sheet.x + draftCallout.nx * sheet.w,
              y: sheet.y + draftCallout.ny * sheet.h,
            })
            const el = surfaceRef.current
            const bounds = el?.getBoundingClientRect()
            const w = COMPOSER_W
            // Prefer sitting to the lower-right of the click, the way a
            // context menu does; flip or clamp only when that would overflow.
            let left = pt.x + 12
            let top = pt.y + 12
            if (bounds) {
              left = Math.min(Math.max(8, left), Math.max(8, bounds.width - w - 8))
              top = Math.min(Math.max(8, top), Math.max(8, bounds.height - COMPOSER_H - 8))
            }
            return (
              <div
                className="absolute z-30 rounded-xl bg-white border border-[#16181D]/10 shadow-2xl overflow-hidden"
                style={{ left, top, width: w }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                <textarea
                  autoFocus
                  value={draftCallout.text}
                  onChange={(e) =>
                    setDraft(draftRef.current ? { ...draftRef.current, text: e.target.value } : null)
                  }
                  onKeyDown={(e) => {
                    // Enter commits; Shift+Enter is a newline. isComposing
                    // guards an IME candidate selection, which also sends Enter.
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault()
                      void commitCallout()
                    }
                    if (e.key === 'Escape') setDraft(null)
                    e.stopPropagation()
                  }}
                  rows={3}
                  placeholder="What about this?"
                  className="w-full px-3 py-2.5 text-[12px] text-[#16181D] outline-none resize-none"
                />
                <div className="flex justify-end gap-2 px-2.5 pb-2.5">
                  <button
                    type="button"
                    onClick={() => setDraft(null)}
                    className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-[#5A5E6B] hover:bg-[#16181D]/6"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void commitCallout()}
                    disabled={!draftCallout.text.trim()}
                    className="px-3 py-1.5 rounded-lg bg-[#3B6EF6] text-white text-[11px] font-semibold disabled:opacity-40"
                  >
                    Add callout
                  </button>
                </div>
              </div>
            )
          })()}

          {/* The open callout, as a panel beside the work rather than a bubble
              on top of it — the shape a board callout opens in. It is anchored
              to the STAGE, not to the pin, so it does not move or get clipped
              when you pan and zoom underneath it. */}
          {selectedCallout && (
            <div className="absolute top-3 right-3 w-[300px] rounded-xl bg-white border border-[#16181D]/10 shadow-2xl overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[#16181D]/8">
                <span className="shrink-0 w-5 h-5 rounded-full bg-[#3B6EF6] text-white text-[10px] font-bold flex items-center justify-center">
                  {selectedCallout.n}
                </span>
                <span className="flex-1 text-[13px] font-bold text-[#16181D]">Callout</span>
                <button
                  type="button"
                  onClick={() => toggleResolved(selectedCallout.node)}
                  className={`px-2 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
                    selectedCallout.node.props?.resolved
                      ? 'bg-[#3B6EF6] text-white'
                      : 'text-[#3B6EF6] hover:bg-[#3B6EF6]/8'
                  }`}
                >
                  {selectedCallout.node.props?.resolved ? 'Resolved' : 'Resolve'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingCallout(false)
                    setSelectedCalloutId(null)
                  }}
                  aria-label="Close callout"
                  className="p-1 rounded-lg text-[#8A8FA0] hover:text-[#16181D] hover:bg-[#16181D]/6"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="px-3 py-2.5">
                <div className="flex items-center gap-2 mb-1">
                  <span className="flex-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#8A8FA0]">
                    {relativeTime(selectedCallout.node.createdAt)}
                  </span>
                  {!editingCallout && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditText(String(selectedCallout.node.props?.text ?? ''))
                        setEditingCallout(true)
                      }}
                      className="text-[11px] font-semibold text-[#5A5E6B] hover:text-[#16181D]"
                    >
                      Edit
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCalloutId(null)
                      void deleteTracked(selectedCallout.node.id)
                    }}
                    className="text-[11px] font-semibold text-[#D64545] hover:underline"
                  >
                    Delete
                  </button>
                </div>

                {editingCallout ? (
                  <>
                    <textarea
                      autoFocus
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                          e.preventDefault()
                          saveCalloutText(selectedCallout.node, editText)
                        }
                        if (e.key === 'Escape') setEditingCallout(false)
                      }}
                      rows={3}
                      className="w-full px-2 py-1.5 rounded-lg border border-[#3B6EF6] text-[12px] text-[#16181D] outline-none resize-none"
                    />
                    <div className="flex justify-end gap-2 mt-2">
                      <button
                        type="button"
                        onClick={() => setEditingCallout(false)}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-[#5A5E6B] hover:bg-[#16181D]/6"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => saveCalloutText(selectedCallout.node, editText)}
                        className="px-2.5 py-1 rounded-lg bg-[#3B6EF6] text-white text-[11px] font-semibold"
                      >
                        Save
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="text-[12px] leading-relaxed text-[#16181D] whitespace-pre-wrap">
                    {String(selectedCallout.node.props?.text ?? '') || (
                      <span className="text-[#8A8FA0] italic">Empty callout</span>
                    )}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Zoom controls, bottom-right of the surface — the canvas's own
              placement. Fit is what gets you back when a pan has taken the work
              off screen, which is the failure mode an unbounded surface has and
              a scroller does not. */}
          {sheets.length > 0 && (
            <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-xl bg-white/95 border border-[#16181D]/10 shadow-lg p-1">
              <button
                type="button"
                onClick={() => zoomBy(1 / 1.2)}
                title="Zoom out"
                aria-label="Zoom out"
                className="p-1.5 rounded-lg text-[#5A5E6B] hover:bg-[#16181D]/6"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <span className="w-11 text-center text-[11px] font-bold tabular-nums text-[#5A5E6B]">
                {Math.round(viewport.zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() => zoomBy(1.2)}
                title="Zoom in"
                aria-label="Zoom in"
                className="p-1.5 rounded-lg text-[#5A5E6B] hover:bg-[#16181D]/6"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
              <span aria-hidden className="w-px self-stretch my-1 bg-[#16181D]/10" />
              <button
                type="button"
                onClick={zoomFit}
                title="Fit every sheet in view"
                className="px-2 py-1.5 rounded-lg text-[11px] font-semibold text-[#5A5E6B] hover:bg-[#16181D]/6"
              >
                Fit
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ---- Transcript / summary / notes ----

           A right-hand column rather than the strip this used to be along the
           bottom. Transcript is a run of speech and a summary is a list of
           points; both are read down a narrow measure, and as a full-width
           band they were long lines in a 56px-tall window. Vertical gives them
           the whole height of the workspace and a sane line length, and the
           stage loses width it was not using. */}
      {!panelOpen ? (
        // Collapsed to a rail rather than removed outright, so there is
        // somewhere to click to get it back.
        <aside className="w-10 shrink-0 border-l border-[#16181D]/10 bg-white flex flex-col items-center py-3">
          <button
            type="button"
            onClick={() => setPanelOpen(true)}
            title="Show transcript and summary"
            aria-label="Show transcript and summary"
            aria-expanded={false}
            className="p-1.5 rounded-lg text-[#5A5E6B] hover:bg-[#16181D]/6 transition-colors"
          >
            <PanelRightOpen className="w-4 h-4" />
          </button>
          {listening && (
            // The one thing worth surfacing while closed: recording is still
            // running and words are still landing in a panel you cannot see.
            <span
              className="mt-2 w-1.5 h-1.5 rounded-full bg-[#3B6EF6] animate-pulse"
              title="Recording"
              aria-label="Recording"
            />
          )}
        </aside>
      ) : (
      <aside className="w-[340px] shrink-0 border-l border-[#16181D]/10 bg-white flex flex-col min-h-0">
        <div className="shrink-0 flex items-center gap-1 px-3 border-b border-[#16181D]/8">
          <TabButton
            label="Transcript"
            active={panel === 'transcript'}
            live={listening}
            onClick={() => setPanel('transcript')}
          />
          <TabButton
            label="Summary"
            active={panel === 'summary'}
            onClick={() => setPanel('summary')}
          />
          {loose.length > 0 && (
            <TabButton
              label={`Notes (${loose.length})`}

              active={panel === 'notes'}
              onClick={() => setPanel('notes')}
            />
          )}
          {(legacyCount > 0 || orphanCount > 0) && (
            <span
              className="ml-auto pr-1 text-[10px] text-[#8A8FA0] truncate max-w-[120px]"
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
          <button
            type="button"
            onClick={() => setPanelOpen(false)}
            title="Hide transcript and summary"
            aria-label="Hide transcript and summary"
            aria-expanded
            className="ml-auto shrink-0 p-1.5 rounded-lg text-[#8A8FA0] hover:text-[#16181D] hover:bg-[#16181D]/6 transition-colors"
          >
            <PanelRightClose className="w-4 h-4" />
          </button>
        </div>

        {panel === 'transcript' && (
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
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
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-2">
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
                  onClick={() => void deleteTracked(n.id)}
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
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
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
      </aside>
      )}
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
/**
 * One sheet, at the size and place you put it, with its marks on top.
 *
 * This was FocusedSheet — a single sheet blown up to fill the stage, reached by
 * clicking a card. The full-bleed chrome (a Back button, the sheet's name, the
 * pen bar) is gone: there is nothing to go back to now, every sheet is on the
 * stage at once, and the pen belongs to the TOOL rather than to whichever sheet
 * happens to be open, so it moved to the rail.
 */
function StageSheet({
  sheet,
  marks,
  tool,
  active,
  stroke,
  penColor,
  penWidth,
  layoutBusy,
  selectedCalloutId,
  onSelectCallout,
  erasing,
  onMarkStart,
  onMoveStart,
  onResizeStart,
  onPointerDown,
  onClick,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onDeleteMark,
}: {
  sheet: CanvasNode
  marks: Annotation[]
  tool: WorkTool
  /** True while this is the sheet the shared mark handlers are pointed at. */
  active: boolean
  stroke: number[][] | null
  penColor: string
  penWidth: number
  /** A move or resize is running somewhere on the stage. */
  layoutBusy: boolean
  /** The callout showing its message in the rail, if any. */
  selectedCalloutId: string | null
  onSelectCallout: (id: string | null) => void
  /** Trace is active with the eraser chosen. */
  erasing: boolean
  /** Claim the shared mark handlers for this sheet's box. */
  onMarkStart: (el: HTMLDivElement | null) => void
  onMoveStart: (e: React.PointerEvent) => void
  onResizeStart: (e: React.PointerEvent) => void
  onPointerDown: (e: React.PointerEvent) => void
  onClick: (e: React.MouseEvent) => void
  onPointerMove: (e: React.PointerEvent) => void
  onPointerUp: () => void
  onPointerCancel: () => void
  onDeleteMark: (id: string) => void
}) {
  const strokes = marks.filter((m) => m.node.type === 'ink')
  const callouts = marks.filter((m) => m.node.type === 'sticky')
  const drawing = tool === 'trace' || tool === 'callout'

  const boxRef = useRef<HTMLDivElement | null>(null)
  /**
   * The sheet's rendered width, for converting stored fractional pen weights
   * into the pixels the SVG strokes in. Observed rather than measured once: the
   * box changes every time the sheet is resized, and a stale width would draw
   * every stroke at the wrong weight.
   */
  const [boxW, setBoxW] = useState(0)
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    setBoxW(el.getBoundingClientRect().width)
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (typeof w === 'number') setBoxW(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div
      className="absolute"
      style={{ left: sheet.x, top: sheet.y, width: sheet.w, height: sheet.h }}
    >
      <div
        ref={boxRef}
        className={`relative w-full h-full bg-white rounded-lg overflow-hidden transition-shadow ${
          active ? 'ring-2 ring-[#3B6EF6]' : 'ring-1 ring-[#16181D]/10'
        }`}
        style={{
          // Marking needs the raw pointer stream; moving is handled by the
          // grip, so the picture itself never swallows a drag in select mode.
          touchAction: 'none',
          cursor: drawing ? 'crosshair' : layoutBusy ? 'grabbing' : 'grab',
        }}
        onPointerDown={(e) => {
          if (drawing) {
            // Left button only. Right has to fall through to the surface so a
            // pan still works while Trace or Callout is the active tool.
            if (e.button !== 0) return
            onMarkStart(boxRef.current)
            onPointerDown(e)
            return
          }
          // Select: the picture IS the handle. Left button only — right is
          // reserved for panning, and it has to keep working over a sheet.
          if (e.button === 0) onMoveStart(e)
        }}
        onClick={(e) => {
          if (!drawing) return
          onMarkStart(boxRef.current)
          onClick(e)
        }}
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
            // The layer stays inert; only the strokes' own hit lines opt in
            // while erasing, so the picture underneath keeps taking marks.
            className={`absolute inset-0 w-full h-full ${erasing ? '' : 'pointer-events-none'}`}
            style={erasing ? { pointerEvents: 'none' } : undefined}
          >
            {strokes.map((m) => (
              <StrokePath
                key={m.node.id}
                node={m.node}
                boxW={boxW}
                erasing={erasing}
                onErase={() => onDeleteMark(m.node.id)}
              />
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

          {/* Just the pin. The message lives in the Callouts list on the rail,
              the way a callout on a board opens its thread in a panel rather
              than printing itself over the drawing. An inline bubble buried the
              work under its own comments and overlapped its neighbours as soon
              as two marks landed near each other. */}
          {callouts.map((m, i) => {
            const nx = Number(m.node.props?.nx ?? 0)
            const ny = Number(m.node.props?.ny ?? 0)
            const isSelected = selectedCalloutId === m.node.id
            return (
              <button
                key={m.node.id}
                type="button"
                // pointerdown as well as click: the stage begins a stroke or
                // opens a composer on pointerdown, so without this, tapping a
                // pin while Trace or Callout is active also starts a mark
                // underneath it.
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  onSelectCallout(isSelected ? null : m.node.id)
                }}
                title={String(m.node.props?.text ?? '') || 'Empty callout'}
                aria-pressed={isSelected}
                className={`absolute -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full border-2 border-white text-[10px] font-bold flex items-center justify-center shadow-md transition-transform hover:scale-110 ${
                  m.node.props?.resolved
                    ? 'bg-slate-400 text-white/90 opacity-60'
                    : 'bg-[#3B6EF6] text-white'
                } ${isSelected ? 'ring-2 ring-[#3B6EF6] scale-110' : ''}`}
                style={{ left: `${nx * 100}%`, top: `${ny * 100}%`, zIndex: isSelected ? 20 : 10 }}
              >
                {i + 1}
              </button>
            )
          })}

      </div>

      {/* Only the corner. The grip is gone — dragging the sheet itself is the
          obvious gesture, and a separate handle to move something you can
          already see and touch was a step that bought nothing. Shown in Select
          only: while Trace or Callout is active the sheet belongs to the
          pointer, and a stray grab would move the work instead of marking it. */}
      {tool === 'select' && (
        <div
          onPointerDown={onResizeStart}
          title="Drag to scale this sheet"
          role="presentation"
          className="absolute -bottom-1.5 -right-1.5 w-4 h-4 rounded-sm bg-white border-2 border-[#3B6EF6] cursor-nwse-resize"
          style={{ touchAction: 'none' }}
        />
      )}

      {/* Blocks pointer events on every OTHER sheet while one is being dragged,
          so the gesture cannot be stolen by a sheet passing underneath. */}
      {layoutBusy && <div className="absolute inset-0" style={{ cursor: 'inherit' }} />}
    </div>
  )
}

function StrokePath({
  node,
  boxW,
  erasing,
  onErase,
}: {
  node: CanvasNode
  boxW: number
  /** Eraser is active, so this stroke is a target. */
  erasing?: boolean
  onErase?: () => void
}) {
  const pts = node.props?.pts
  if (!Array.isArray(pts) || pts.length < MIN_STROKE_POINTS) return null
  const d = (pts as number[][])
    .map(([x, y]) => `${x},${y}`)
    .join(' ')
  const width = tracePx(Number(node.props?.size ?? TRACE_WIDTHS[0].value), boxW)
  return (
    <g>
      <polyline
        points={d}
        fill="none"
        stroke={String(node.props?.color ?? TRACE_COLORS[0])}
        strokeWidth={width}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        className={erasing ? 'opacity-60' : undefined}
      />
      {/* Fat transparent hit line, the same trick the plan's wall clicks use:
          a 2px stroke is near-impossible to hit, and thickening the visible one
          to compensate would change the drawing. */}
      {erasing && (
        <polyline
          points={d}
          fill="none"
          stroke="transparent"
          strokeWidth={Math.max(width * 3, 14)}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
          onPointerDown={(e) => {
            // Left button only: right-drag has to fall through to the surface
            // so panning still works with the eraser selected — it used to
            // delete the stroke and swallow the pan.
            if (e.button !== 0) return
            // Erase on POINTERDOWN, so dragging across several strokes wipes
            // each as you cross it rather than needing a click per stroke.
            e.stopPropagation()
            onErase?.()
          }}
          onPointerEnter={(e) => {
            // buttons is a bitmask; 1 is the primary button specifically.
            if ((e.buttons & 1) === 1) onErase?.()
          }}
        />
      )}
    </g>
  )
}
