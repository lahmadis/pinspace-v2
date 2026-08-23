'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import { Comment, Board, BoardComment, BoardTrace, TraceStroke } from '@/types'
import { validateLinkUrl } from '@/lib/linkUrl'
import {
  getBoardSizeDisplay,
  fitBoardWithinSheet,
  SHEET_SIZE_PRESETS,
  type SheetSizePreset,
} from '@/lib/boardDimensions'
import { useImageViewport } from '@/components/useImageViewport'
import type { TraceStreamEntry } from '@/components/3d/CameraController'
import { toast } from '@/lib/toast'
import { Download, ExternalLink } from 'lucide-react'

// Trace ink palette + brush widths (width = fraction of image width). A
// deliberate multi-option picker (like a real 4-marker set), not an
// identity/accent color, so it keeps four distinguishable hues rather than
// collapsing to the one blue accent — but pulled into the same muted
// warm-paper/cool-blue family as the rest of the room instead of bright
// saturated primaries. Red matches ROOM.redline (lib/room/palette.ts).
// Shared with the desk crit workspace, which draws over work too. The two
// store their marks differently and always will; the pen should still be the
// same pen. See lib/trace/pens.ts.
import { TRACE_COLORS, TRACE_WIDTHS } from '@/lib/trace/pens'
import type { Session, AuthChangeEvent, User } from '@supabase/supabase-js'

interface LightboxModalProps {
  board: Board | null
  allBoards: Board[] // For navigation
  compareBoards?: Board[]
  autoEnterPresentCompare?: boolean
  onClose: () => void
  onNavigate: (direction: 'prev' | 'next') => void
  /** True when rendered on the edit-mode studio page; enables inline author name editing. */
  isEditMode?: boolean
  /**
   * View-mode opt-in — set ONLY by app/studio/[id]/view/page.tsx. When true, the
   * read-only presentation surface hides ALL callout + trace UI: the numbered
   * pins, the "N callouts"/"Show resolved" header, the inline composer + placement
   * layer, the Add-callout and Trace tool-dock buttons (and their separator), and
   * the trace canvas/layers/tools. Editor (via StudioRoom) and guest crit pass
   * nothing, so this defaults false and their behavior is unchanged. NOT the same
   * as isEditMode — both view and guest crit pass isEditMode={false}, so gating on
   * isEditMode would wrongly strip guest crit's callout/trace UI.
   */
  hideCallouts?: boolean
  /** Role of the currently authenticated user in this workspace. Instructors may resolve/delete any callout. */
  currentUserRole?: 'instructor' | 'student' | null
  /**
   * Phase 2: turns the leading number of the "06 / 07" counter into a
   * click-to-edit slideshow position. Default false, and when false the counter
   * renders EXACTLY as before — no affordance, no markup change. Only the
   * member studio surfaces (edit via StudioRoom, and the view page) opt in;
   * share/crit/gallery are read-only and leave it default.
   *
   * Affordance-only: /api/boards/reorder re-checks owner/superadmin server-side,
   * so a stale flag just round-trips to a 403 and the number reverts.
   */
  canReorder?: boolean
  /**
   * Persists a new 1-based slideshow position for a board. Resolve true on
   * success, false to revert the displayed number and toast. The caller is
   * expected to refetch its boards so the sorted allBoards recomputes.
   */
  onReorder?: (boardId: string, targetPosition: number) => Promise<boolean>
  /**
   * Called after a video link save persists (PUT ok). The parent uses it to
   * write the new linkUrl into its local boards cache (and the open-lightbox
   * snapshot) so reopening the lightbox shows the link without a refresh —
   * the PUT alone only updates the server, not the local board the lightbox
   * re-reads on open. null = link cleared.
   */
  onLinkSaved?: (boardId: string, linkUrl: string | null) => void
  /**
   * Called after a manual board-size save persists (PATCH ok). Lets the parent
   * mirror board_width_in / board_height_in into its local boards cache and the
   * open-lightbox snapshot so the 3D room re-renders at the new size without a
   * refresh. Mirrors onLinkSaved.
   */
  onBoardSizeSaved?: (boardId: string, widthIn: number, heightIn: number) => void
  /**
   * Called after a board-title save persists (PATCH ok). Lets the parent mirror
   * the new title into its local boards cache and the open-lightbox snapshot so
   * reopening/navigating shows it without a refetch. Mirrors onLinkSaved.
   */
  onTitleSaved?: (boardId: string, title: string) => void
  // ---- Guest-critic mode (Phase A.5) ----
  /** When set, critique requests carry this token and writes are attributed to the guest. */
  guestToken?: string | null
  /** The guest's entered display name, attached to their comments/traces. */
  guestName?: string | null
  /** The resolved guest_tokens.id, used to tell which rows are the guest's own. */
  guestTokenId?: string | null
  /** Capabilities from the guest token. */
  guestCanComment?: boolean
  guestCanTrace?: boolean
  // ---- Lightbox follow (Phase B.3.1) — member studio page only ----
  /** Live broadcast channel (shared studio-live). Presenter broadcasts "lbv". */
  liveChannelRef?: React.MutableRefObject<ReturnType<typeof supabase.channel> | null>
  /** When true, this client is the presenter — broadcast its lightbox viewport. */
  isPresenter?: boolean
  /** When true, this client is a follower whose viewport is driven by the presenter (local zoom/pan disabled). */
  viewportDriven?: boolean
  /** Latest received presenter viewport (written per "lbv" message; smooth-applied, never via state). */
  viewportTargetRef?: React.MutableRefObject<{ z: number; cx: number; cy: number } | null>
  /** Phase B.3.2: latest received presenter pointer-over-image (written per "lbc" message; positioned imperatively, never via state). */
  lbCursorRef?: React.MutableRefObject<{ cx: number; cy: number; seq: number } | null>
  /** Phase B.3.2: presenter's deterministic color for the lightbox cursor dot (matches the 3D dot). */
  cursorColor?: string
  /** Phase B.5: debounced peer-edit signal — refetch traces/callouts for boardId when seq changes. */
  critDirty?: { boardId: string; trace: boolean; callout: boolean; seq: number } | null
  /** Phase B.5.1: shared map of peers' in-progress (ephemeral) trace strokes, keyed `${boardId}|${authorKey}`. Written by the page's trace-pt/trace-end handlers; rendered here. */
  traceStreamRef?: React.MutableRefObject<Map<string, TraceStreamEntry>>
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  
  return date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

// Marks a direct public-bucket URL. board-images is public, so full_image_url is
// a plain CDN URL and Supabase turns ?download=<name> into a
// Content-Disposition: attachment — the browser saves the file with no auth and
// no fetch. Demo/sample boards point at placeholder hosts instead and take the
// blob path in handleDownload.
const SUPABASE_PUBLIC_MARKER = '/storage/v1/object/public/'

// Extension of the stored object, NOT of whatever was originally uploaded: the
// upload pipeline re-encodes every image to JPEG (useDirectUpload.ts), so a
// PNG upload is .jpg bytes in storage and must download as .jpg.
function extFromUrl(url: string): string {
  const path = url.split('?')[0].split('#')[0]
  const m = path.match(/\.([a-z0-9]{2,5})$/i)
  return m ? m[1].toLowerCase() : 'jpg'
}

// The board title IS the original filename minus its extension (the upload route
// derives it that way via deriveDefaultTitle), so title + real extension gets us
// back to the uploaded name. Falls back to board-<id> for an empty/renamed-away
// title. Mirrors the sanitize() rules in the workspace-export route.
function downloadFileName(title: string | null | undefined, boardId: string, url: string): string {
  const ext = extFromUrl(url)
  const base = (title ?? '')
    .trim()
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^\.+/, '') // never produce a dotfile
    .slice(0, 80)
  const safe = base || `board-${boardId}`
  // Don't double up when the title already carries the extension (renamed board).
  return new RegExp(`\\.${ext}$`, 'i').test(safe) ? safe : `${safe}.${ext}`
}

function triggerAnchorDownload(href: string, filename: string) {
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  // The download attribute is ignored cross-origin, so the Supabase save rides
  // entirely on Content-Disposition: attachment. _blank keeps a missing header
  // from navigating the studio/crit page away — which would tear down the
  // lightbox and any trace still inside its 600ms save debounce. With the
  // header present (the normal path) no tab is ever shown.
  a.target = '_blank'
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map(word => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

// Same 8-hue palette as colorFor in components/3d/PresenceBar.tsx (see that
// export's comment for why these specific values/spread), expressed as
// Tailwind arbitrary-value classes since callers here want a className, not
// an inline style. Was raw Tailwind primaries (purple/blue/green/yellow/pink/
// indigo/red/teal) — unrelated to, and much louder than, the room's palette.
function getAvatarColor(name: string): string {
  const colors = [
    'bg-[#4E9F8F]',
    'bg-[#8A7BD8]',
    'bg-[#E0935A]',
    'bg-[#C2708A]',
    'bg-[#7FA06B]',
    'bg-[#5B93C7]',
    'bg-[#9C7BAE]',
    'bg-[#6B7FA6]',
  ]
  const hash = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
  return colors[hash % colors.length]
}

export default function LightboxModal({ board, allBoards, compareBoards = [], autoEnterPresentCompare = false, onClose, onNavigate, isEditMode = false, hideCallouts = false, currentUserRole = null, canReorder = false, onReorder, onLinkSaved, onBoardSizeSaved, onTitleSaved, guestToken = null, guestName = null, guestTokenId = null, guestCanComment = false, guestCanTrace = false, liveChannelRef, isPresenter = false, viewportDriven = false, viewportTargetRef, lbCursorRef, cursorColor = '#22d3ee', critDirty, traceStreamRef }: LightboxModalProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [user, setUser] = useState<User | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Mirrors calloutsAccessible: legacy comments are now private to workspace
  // members too. false until a non-403 fetch confirms access; gates the
  // Comments button + panel so public/unauthenticated viewers see nothing.
  const [commentsAccessible, setCommentsAccessible] = useState(false)
  const [newComment, setNewComment] = useState('')
  const [posting, setPosting] = useState(false)
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [editingContent, setEditingContent] = useState('')
  const [savingCommentId, setSavingCommentId] = useState<string | null>(null)
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null)
  const [pendingDeleteCommentId, setPendingDeleteCommentId] = useState<string | null>(null)
  const [isVisible, setIsVisible] = useState(false)
  const [isPresentMode, setIsPresentMode] = useState(false)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Author name inline edit
  const [editingAuthorName, setEditingAuthorName] = useState(false)
  const [authorNameInput, setAuthorNameInput] = useState('')
  const [displayedAuthorName, setDisplayedAuthorName] = useState<string | null>(null)
  const [isSavingAuthorName, setIsSavingAuthorName] = useState(false)
  const authorSaveInFlightRef = useRef(false)
  // Optional video link editing (edit mode). linkOverride is a sentinel that
  // holds the optimistic post-save value (including null when cleared) so the
  // UI reflects the edit without waiting for a parent refetch; null sentinel =
  // "use board.linkUrl". Reset on board change.
  const [linkOverride, setLinkOverride] = useState<{ value: string | null } | null>(null)
  const [editingLink, setEditingLink] = useState(false)
  const [linkInput, setLinkInput] = useState('')
  const [linkError, setLinkError] = useState<string | null>(null)
  const [savingLink, setSavingLink] = useState(false)
  const linkSaveInFlightRef = useRef(false)

  // Manual board-size control (edit mode, owner/instructor). sizeOverride holds
  // the optimistic post-save inches so the header/label update without waiting
  // for a parent refetch; null = "use the board's stored size". Reset on board
  // change. Mirrors linkOverride.
  const [sizeOverride, setSizeOverride] = useState<{ widthIn: number; heightIn: number } | null>(null)
  const [editingSize, setEditingSize] = useState(false)
  const [sizeWidthInput, setSizeWidthInput] = useState('')
  const [sizeHeightInput, setSizeHeightInput] = useState('')
  const [sizeError, setSizeError] = useState<string | null>(null)
  const [savingSize, setSavingSize] = useState(false)
  const sizeSaveInFlightRef = useRef(false)

  // Inline board-title edit (view + edit mode, uploader/owner/superadmin — see
  // canEditTitle below). titleOverride holds the optimistic post-save value so
  // the header updates without waiting for a refetch; null = "use board.title".
  // Reset on board change. Mirrors linkOverride.
  const [titleOverride, setTitleOverride] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleInput, setTitleInput] = useState('')
  const [savingTitle, setSavingTitle] = useState(false)
  const titleSaveInFlightRef = useRef(false)
  // Set true by an Esc keypress so the ensuing unmount-blur cancels instead of
  // saving (Enter/blur save; Esc cancels).
  const titleEditCancelRef = useRef(false)

  // Inline slideshow-position edit on the nav counter (Phase 2, gated on
  // canReorder). pendingPosition holds the typed value while the write is in
  // flight so the counter shows the destination immediately; it clears on
  // settle, which is also what "reverts" the number on failure — the real
  // index comes back from allBoards either way. Mirrors the title edit,
  // including the Esc-cancel ref that stops the unmount-blur from committing.
  const [editingPosition, setEditingPosition] = useState(false)
  const [positionInput, setPositionInput] = useState('')
  const [pendingPosition, setPendingPosition] = useState<number | null>(null)
  const [savingPosition, setSavingPosition] = useState(false)
  const positionSaveInFlightRef = useRef(false)
  const positionEditCancelRef = useRef(false)

  // Single-image zoom/pan + image-rect measurement (Phase A.2). Only the
  // single-image branch below consumes it; PDF/compare are untouched. The board's
  // rotation is threaded in so the pin/trace mapping composes it the same way the
  // <img> CSS transform does (keeps callouts + traces glued on a rotated board).
  const viewport = useImageViewport(undefined, board?.position?.rotation ?? 0)
  const {
    reset: resetViewport,
    scaleRef: viewportScaleRef,
    getViewportFraction,
    applyViewportFraction,
    setInteractionEnabled,
    imageFractionToContainerPoint: viewportImageFractionToContainerPoint,
  } = viewport
  // Phase B.3.2: presenter pointer-over-image (image fraction or null=off), read
  // by the lbc broadcast interval; and the follower's 2D dot div, positioned
  // imperatively in the smooth-apply loop.
  const presenterCursorFracRef = useRef<{ cx: number; cy: number } | null>(null)
  const lbCursorDotRef = useRef<HTMLDivElement>(null)
  // Phase B.5: last crit-dirty seq we refetched for, so deferred re-runs don't refetch twice.
  const handledCritSeqRef = useRef(0)

  // Phase B.5: ping peers (members + guests) that this board's traces/callouts
  // changed, so their open lightbox refetches. Fire-and-forget on the shared
  // studio-live channel after a successful save; no logging.
  const sendCritDirty = (kind: 'trace' | 'callout') => {
    const ch = liveChannelRef?.current
    if (!ch || !board) return
    ch.send({ type: 'broadcast', event: 'crit-dirty', payload: { boardId: board.id, kind } })
  }

  // ---- Anchored callouts (Phase A.3) -------------------------------------
  // A NEW overlay system, fully separate from the legacy unanchored comment
  // panel above. Uses the board-comments API (A.1) and the viewport mapping
  // functions (A.2). No realtime this phase — fetched on board open only.
  const [boardComments, setBoardComments] = useState<BoardComment[]>([])
  const [calloutError, setCalloutError] = useState<string | null>(null)
  // True only after a successful (200) board-comments fetch — i.e. the viewer
  // is a workspace member/owner/superadmin. Public/unauthenticated viewers get
  // 403 and the entire callout layer (pins, Add-callout, overlay) stays hidden.
  const [calloutsAccessible, setCalloutsAccessible] = useState(false)
  const [calloutMode, setCalloutMode] = useState(false)            // placing a new pin
  const [composer, setComposer] = useState<{ fx: number; fy: number } | null>(null)
  const [composerText, setComposerText] = useState('')
  const [composerPosting, setComposerPosting] = useState(false)
  const [activeThreadRootId, setActiveThreadRootId] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const [replyPosting, setReplyPosting] = useState(false)
  const [showResolved, setShowResolved] = useState(true)
  const [editingCalloutId, setEditingCalloutId] = useState<string | null>(null)
  const [editingCalloutText, setEditingCalloutText] = useState('')
  const [savingCalloutId, setSavingCalloutId] = useState<string | null>(null)
  const [deletingCalloutId, setDeletingCalloutId] = useState<string | null>(null)
  // Refs mirror open-state so the global keydown handler can read them without
  // re-subscribing on every keystroke / pin click.
  const calloutModeRef = useRef(false)
  const composerOpenRef = useRef(false)
  const activeThreadRef = useRef(false)
  useEffect(() => { calloutModeRef.current = calloutMode }, [calloutMode])
  useEffect(() => { composerOpenRef.current = composer != null }, [composer])
  useEffect(() => { activeThreadRef.current = activeThreadRootId != null }, [activeThreadRootId])

  // ---- Trace layer (Phase A.4) -------------------------------------------
  // Per-author freehand drawing over the board image. Same accessibility gate
  // as callouts (calloutsAccessible). Strokes live in image-fraction coords and
  // render through the A.2 viewport mapping, so they stay glued at any zoom/pan.
  const [boardTraces, setBoardTraces] = useState<BoardTrace[]>([])   // every author's layer
  const [traceMode, setTraceMode] = useState(false)                  // drawing active
  const [myStrokes, setMyStrokes] = useState<TraceStroke[]>([])      // local authoritative copy of MY strokes
  const [drawingPoints, setDrawingPoints] = useState<[number, number][] | null>(null) // in-progress stroke
  const [hiddenTraceAuthors, setHiddenTraceAuthors] = useState<Set<string>>(new Set())
  const [traceColor, setTraceColor] = useState(TRACE_COLORS[0])
  const [traceWidth, setTraceWidth] = useState(TRACE_WIDTHS[0].value)
  const [pendingClearTrace, setPendingClearTrace] = useState(false)
  const [tracesLoaded, setTracesLoaded] = useState(false)
  const traceCanvasRef = useRef<HTMLCanvasElement>(null)
  const traceModeRef = useRef(false)
  const saveTimerRef = useRef<number | null>(null)
  const traceSaveFailedRef = useRef(false)
  const tracesInitedForBoardRef = useRef<string | null>(null)
  // Phase B.5.1: live trace streaming (ephemeral). liveStrokeRef mirrors the
  // current stroke's points synchronously (drawingPoints is async state);
  // streamSentCountRef tracks how many points were already broadcast (delta
  // sends); lastStreamTsRef throttles to ~10Hz. Additive — the debounced SAVE
  // path is unchanged.
  const liveStrokeRef = useRef<[number, number][]>([])
  const streamSentCountRef = useRef(0)
  const lastStreamTsRef = useRef(0)
  useEffect(() => { traceModeRef.current = traceMode }, [traceMode])
  // Clear any pending debounced save on unmount.
  useEffect(() => () => { if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current) }, [])

  const isOpen = board !== null
  const [profileFullName, setProfileFullName] = useState<string | null>(null)
  // Platform superadmin flag for the signed-in user, read from their own
  // user_profiles row via /api/user-profile (already fetched below for the
  // display name). Affordance-only — the PATCH route re-checks superadmin
  // server-side, so this never grants anything.
  const [isSuperadminViewer, setIsSuperadminViewer] = useState(false)
  // Guest-critic mode: no session user; identity comes from the token + name.
  const isGuest = !!guestToken
  const canComment = isGuest ? !!guestCanComment : !!user
  const canTrace = isGuest ? !!guestCanTrace : !!user
  const authorName = isGuest
    ? (guestName || 'Guest')
    : (profileFullName || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Anonymous')
  // Attach the guest token header to critique requests when in guest mode.
  const guestHeader = (): Record<string, string> =>
    isGuest && guestToken ? { 'X-Guest-Token': guestToken } : {}
  const isDemoMode = searchParams.get('demo') === 'true' || (typeof window !== 'undefined' && window.location.pathname.includes('demo-studio-'))

  useEffect(() => {
    supabase.auth.getSession().then(
      ({ data: { session } }: { data: { session: Session | null } }) => {
        setUser(session?.user || null)
      }
    )

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event: AuthChangeEvent, session: Session | null) => {
        setUser(session?.user || null)
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!user?.id) {
      setProfileFullName(null)
      setIsSuperadminViewer(false)
      return
    }
    fetch('/api/user-profile', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const fullName = typeof data?.full_name === 'string' ? data.full_name.trim() : ''
        setProfileFullName(fullName || null)
        setIsSuperadminViewer(data?.is_superadmin === true)
      })
      .catch(() => {
        setProfileFullName(null)
        setIsSuperadminViewer(false)
      })
  }, [user?.id])

  // Current board index for navigation
  const currentIndex = board ? allBoards.findIndex(b => b.id === board.id) : -1
  const hasPrev = currentIndex > 0
  const hasNext = currentIndex < allBoards.length - 1
  const compareCount = compareBoards.length
  const isComparePresentMode = isPresentMode && compareBoards.length > 1
  const compareGapPx = compareCount <= 2 ? 24 : compareCount <= 4 ? 16 : 12
  const compareCardMinPx = compareCount <= 2 ? 320 : compareCount <= 4 ? 260 : 220
  const compareCardMaxPx = compareCount <= 2 ? 760 : compareCount <= 4 ? 560 : 420
  const compareCardWidth = `clamp(${compareCardMinPx}px, calc((100vw - 64px - ${(Math.max(compareCount, 1) - 1) * compareGapPx}px) / ${Math.max(compareCount, 1)}), ${compareCardMaxPx}px)`
  const compareJustifyClass = compareCount <= 3 ? 'justify-center' : 'justify-start'

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => setIsVisible(true), 10)
    } else {
      setIsVisible(false)
      setIsPresentMode(false)
      setCommentsOpen(false)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    if (autoEnterPresentCompare && compareBoards.length > 1) {
      setIsPresentMode(true)
    }
  }, [isOpen, autoEnterPresentCompare, compareBoards.length])

  useEffect(() => {
    // Reset zoom/pan whenever the board changes (covers arrow-key navigation).
    resetViewport()
    setEditingAuthorName(false)
    setAuthorNameInput('')
    setDisplayedAuthorName(null)
    setLinkOverride(null)
    setEditingLink(false)
    setLinkInput('')
    setLinkError(null)
    setSizeOverride(null)
    setEditingSize(false)
    setSizeError(null)
    setTitleOverride(null)
    setEditingTitle(false)
    setTitleInput('')
    titleEditCancelRef.current = false
    setEditingPosition(false)
    setPositionInput('')
    setPendingPosition(null)
    positionEditCancelRef.current = false
    // Reset the callout overlay on every board change (covers arrow nav).
    setCalloutMode(false)
    setComposer(null)
    setComposerText('')
    setActiveThreadRootId(null)
    setReplyText('')
    setEditingCalloutId(null)
    setEditingCalloutText('')
    setCalloutError(null)
    setCalloutsAccessible(false)
    setCommentsAccessible(false)
    setBoardComments([])
    // Reset the trace layer on board change.
    setTraceMode(false)
    setBoardTraces([])
    setMyStrokes([])
    setDrawingPoints(null)
    setHiddenTraceAuthors(new Set())
    setPendingClearTrace(false)
    setTracesLoaded(false)
    tracesInitedForBoardRef.current = null
    traceSaveFailedRef.current = false
    if (saveTimerRef.current) { window.clearTimeout(saveTimerRef.current); saveTimerRef.current = null }
    if (!board) {
      setComments([])
      setNewComment('')
      setCommentsOpen(false)
      setEditingCommentId(null)
      setEditingContent('')
      return
    }
    fetchComments()
    fetchBoardComments()
    fetchBoardTraces()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board?.id])

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Tracing mode closes first, then the callout/zoom/close chain.
        if (traceModeRef.current) { setTraceMode(false); return }
        // Callout overlays close next, in priority order.
        if (composerOpenRef.current) { setComposer(null); setComposerText(''); return }
        if (activeThreadRef.current) { setActiveThreadRootId(null); return }
        if (calloutModeRef.current) { setCalloutMode(false); return }
        // While zoomed, ESC then resets zoom; only close once at fit.
        if (viewportScaleRef.current > 1) {
          resetViewport()
          return
        }
        if (isPresentMode) {
          if (isComparePresentMode) {
            handleClose()
          } else {
            setIsPresentMode(false)
          }
        } else {
          handleClose()
        }
      } else if (!isComparePresentMode && e.key === 'ArrowLeft' && hasPrev) {
        onNavigate('prev')
      } else if (!isComparePresentMode && e.key === 'ArrowRight' && hasNext) {
        onNavigate('next')
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, hasPrev, hasNext, isPresentMode, isComparePresentMode, onNavigate, resetViewport, viewportScaleRef])

  const handleSaveAuthorName = useCallback(async () => {
    if (authorSaveInFlightRef.current || !board) {
      setEditingAuthorName(false)
      return
    }
    const name = authorNameInput.trim()
    const currentName = displayedAuthorName ?? board.studentName ?? ''
    if (!name || name === currentName) {
      setEditingAuthorName(false)
      return
    }
    authorSaveInFlightRef.current = true
    setIsSavingAuthorName(true)
    try {
      const res = await fetch('/api/boards', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: board.id,
          workspaceId: board.workspaceId || board.studioId,
          studentName: name,
        }),
        credentials: 'include',
      })
      if (res.ok) setDisplayedAuthorName(name)
    } catch {
      // silent — user sees no change, can retry
    } finally {
      authorSaveInFlightRef.current = false
      setIsSavingAuthorName(false)
      setEditingAuthorName(false)
    }
  }, [board, authorNameInput, displayedAuthorName])

  const handleSaveLink = useCallback(async () => {
    if (linkSaveInFlightRef.current || !board) {
      setEditingLink(false)
      return
    }
    const { value, error } = validateLinkUrl(linkInput)
    if (error) {
      setLinkError(error)
      return
    }
    const current = linkOverride ? linkOverride.value : board.linkUrl ?? null
    if (value === current) {
      setEditingLink(false)
      setLinkError(null)
      return
    }
    linkSaveInFlightRef.current = true
    setSavingLink(true)
    setLinkError(null)
    try {
      const res = await fetch('/api/boards', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: board.id,
          workspaceId: board.workspaceId || board.studioId,
          // null clears the link; the server re-validates with the same rules.
          linkUrl: value,
        }),
        credentials: 'include',
      })
      if (res.ok) {
        setLinkOverride({ value })
        setEditingLink(false)
        // Push the persisted value up so the parent's boards cache (and the
        // open-lightbox snapshot) stay current — otherwise reopening the
        // lightbox re-reads a stale board and the link disappears until refresh.
        onLinkSaved?.(board.id, value)
      } else {
        const data = await res.json().catch(() => ({}))
        setLinkError(data?.error || 'Failed to save link.')
      }
    } catch {
      setLinkError('Failed to save link.')
    } finally {
      linkSaveInFlightRef.current = false
      setSavingLink(false)
    }
  }, [board, linkInput, linkOverride, onLinkSaved])

  // Persist an inline board-title rename via PATCH /api/boards/[id]. Optimistic:
  // titleOverride updates the header immediately and the input closes; on
  // failure we revert to the prior value and toast once. Enter/blur call this;
  // Esc sets titleEditCancelRef so the unmount-blur cancels without saving.
  const handleSaveTitle = useCallback(async () => {
    if (titleEditCancelRef.current) {
      titleEditCancelRef.current = false
      setEditingTitle(false)
      setTitleInput('')
      return
    }
    if (titleSaveInFlightRef.current || !board) {
      setEditingTitle(false)
      return
    }
    const value = titleInput.trim().slice(0, 120)
    const current = titleOverride ?? board.title ?? ''
    // Empty or unchanged: cancel the edit; never persist an empty title.
    if (!value || value === current) {
      setEditingTitle(false)
      setTitleInput('')
      return
    }
    const prevOverride = titleOverride
    titleSaveInFlightRef.current = true
    setSavingTitle(true)
    // Optimistic: show the new title and close the input.
    setTitleOverride(value)
    setEditingTitle(false)
    try {
      const res = await fetch(`/api/boards/${board.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: value }),
        credentials: 'include',
      })
      if (res.ok) {
        onTitleSaved?.(board.id, value)
      } else {
        // Revert to the pre-save value and surface a single toast.
        setTitleOverride(prevOverride)
        toast.error('Couldn’t rename this board.')
      }
    } catch {
      setTitleOverride(prevOverride)
      toast.error('Couldn’t rename this board.')
    } finally {
      titleSaveInFlightRef.current = false
      setSavingTitle(false)
    }
  }, [board, titleInput, titleOverride, onTitleSaved])

  // Commit a typed slideshow position. Enter/blur call this; Esc sets
  // positionEditCancelRef so the unmount-blur cancels without writing.
  //
  // Junk, out-of-range and no-op values close the editor WITHOUT a request —
  // there is nothing to persist and a 1..N clamp server-side would silently do
  // something the user didn't type. Only a real move round-trips.
  const handleCommitPosition = useCallback(async () => {
    if (positionEditCancelRef.current) {
      positionEditCancelRef.current = false
      setEditingPosition(false)
      setPositionInput('')
      return
    }
    if (positionSaveInFlightRef.current || !board) {
      setEditingPosition(false)
      return
    }
    const raw = positionInput.trim()
    const total = allBoards.length
    const parsed = Number.parseInt(raw, 10)
    const isValid =
      /^\d+$/.test(raw) &&
      Number.isInteger(parsed) &&
      parsed >= 1 &&
      parsed <= total &&
      parsed !== currentIndex + 1
    if (!isValid) {
      setEditingPosition(false)
      setPositionInput('')
      return
    }

    positionSaveInFlightRef.current = true
    setSavingPosition(true)
    // Optimistic: show the destination slot and close the input while the
    // write is in flight.
    setPendingPosition(parsed)
    setEditingPosition(false)
    try {
      const ok = await onReorder?.(board.id, parsed)
      if (ok === false) toast.error('Couldn’t move this board.')
    } catch {
      toast.error('Couldn’t move this board.')
    } finally {
      positionSaveInFlightRef.current = false
      setSavingPosition(false)
      // Clearing the optimistic value hands the counter back to allBoards: the
      // new slot on success, the unchanged old one on failure.
      setPendingPosition(null)
      setPositionInput('')
    }
  }, [board, positionInput, allBoards.length, currentIndex, onReorder])

  // Persist a manual board size (inches) through the EXISTING position PATCH,
  // which already accepts boardWidthIn/boardHeightIn. Sends the board's current
  // wall position unchanged (the route requires wallIndex/x/y). Optimistic:
  // sizeOverride updates the header immediately; onBoardSizeSaved lets the
  // parent mirror it into the 3D room. Mirrors handleSaveLink.
  const handleSaveSize = useCallback(async (widthIn: number, heightIn: number) => {
    if (sizeSaveInFlightRef.current || !board) return
    if (!board.position || board.position.wallIndex == null) {
      setSizeError('This board isn’t placed on a wall yet.')
      return
    }
    if (!Number.isFinite(widthIn) || !Number.isFinite(heightIn) || widthIn <= 0 || heightIn <= 0) {
      setSizeError('Enter a width and height in inches.')
      return
    }
    // Clamp to sane real-world bounds (1"–600" = 50 ft).
    const w = Math.min(600, Math.max(1, widthIn))
    const h = Math.min(600, Math.max(1, heightIn))
    sizeSaveInFlightRef.current = true
    setSavingSize(true)
    setSizeError(null)
    try {
      const res = await fetch(`/api/boards/${board.id}/position`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({
          wallIndex: board.position.wallIndex,
          x: board.position.x,
          y: board.position.y,
          side: board.position.side,
          boardWidthIn: w,
          boardHeightIn: h,
        }),
        credentials: 'include',
      })
      if (res.ok) {
        setSizeOverride({ widthIn: w, heightIn: h })
        setEditingSize(false)
        onBoardSizeSaved?.(board.id, w, h)
      } else {
        const data = await res.json().catch(() => ({}))
        setSizeError(data?.error || data?.message || 'Failed to save size.')
      }
    } catch {
      setSizeError('Failed to save size.')
    } finally {
      sizeSaveInFlightRef.current = false
      setSavingSize(false)
    }
  }, [board, onBoardSizeSaved])

  const fetchComments = async () => {
    if (!board) return
    // Guests get no legacy (unanchored) comments panel at all.
    if (isGuest) {
      setComments([])
      setCommentsAccessible(false)
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      setError(null)
      const url = isDemoMode
        ? `/api/boards/${board.id}/comments?demo=true`
        : `/api/boards/${board.id}/comments`
      const response = await fetch(url, { credentials: 'include' })

      // Comments are private to workspace members. A 401/403 (public or
      // unauthenticated viewer) degrades silently — the Comments button/panel
      // are hidden via commentsAccessible; no error is shown.
      if (response.status === 401 || response.status === 403) {
        setCommentsAccessible(false)
        setComments([])
        setError(null)
        return
      }
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        const message = data?.error === 'Board not found'
          ? 'Board not found'
          : (data?.details || data?.error || 'Failed to load comments')
        // Genuine error (not an access denial): keep the panel visible to show it.
        setCommentsAccessible(true)
        setError(message)
        setComments([])
        return
      }

      setComments(data.comments || [])
      setCommentsAccessible(true)
    } catch (err) {
      console.error('Error fetching comments:', err)
      // Transient failure (not an access denial): keep the panel available.
      setCommentsAccessible(true)
      setError('Failed to load comments')
      setComments([])
    } finally {
      setLoading(false)
    }
  }

  // ---- Callout (anchored board-comment) handlers -------------------------
  const fetchBoardComments = async () => {
    if (!board) return
    // No board-comments API for demo/sample boards — skip cleanly.
    if (isDemoMode || board.id.startsWith('sample-')) {
      setBoardComments([])
      setCalloutsAccessible(false)
      return
    }
    try {
      setCalloutError(null)
      // Cookie auth: the session is sent regardless of client-side `user`
      // hydration, so members get 200 even before auth state settles.
      const res = await fetch(`/api/boards/${board.id}/board-comments`, { credentials: 'include', headers: guestHeader() })
      // Callouts are private to workspace members. A 401/403 (public or
      // unauthenticated viewer) degrades silently: no pins, no Add-callout,
      // no error, no console noise.
      if (res.status === 401 || res.status === 403) {
        setBoardComments([])
        setCalloutsAccessible(false)
        setCalloutError(null)
        return
      }
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setBoardComments([])
        setCalloutsAccessible(false)
        setCalloutError(data?.error || 'Failed to load callouts')
        return
      }
      setBoardComments(data.comments || [])
      setCalloutsAccessible(true)
    } catch {
      // Network blip — degrade quietly (no toast, no console spam).
      setBoardComments([])
      setCalloutsAccessible(false)
      setCalloutError(null)
    }
  }

  // Create a root pin at an image-fraction anchor. Optimistic, reconciled with
  // the server row on success.
  const handleSubmitCallout = async () => {
    if (!board || !composer || composerPosting) return
    const text = composerText.trim()
    if (!text) return
    if (!canComment) { setCalloutError('You don’t have comment access'); return }
    const fx = composer.fx
    const fy = composer.fy
    const tempId = `temp-bc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const optimistic: BoardComment = {
      id: tempId, boardId: board.id, roomId: '', parentId: null,
      anchorX: fx, anchorY: fy, body: text,
      authorId: isGuest ? null : (user?.id ?? null), guestTokenId: isGuest ? guestTokenId : null, authorName,
      resolved: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }
    setComposerPosting(true)
    setCalloutError(null)
    setBoardComments((prev) => [...prev, optimistic])
    try {
      const res = await fetch(`/api/boards/${board.id}/board-comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...guestHeader() },
        body: JSON.stringify({ anchorX: fx, anchorY: fy, body: text, guestName: isGuest ? authorName : undefined }),
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.comment) {
        setBoardComments((prev) => prev.filter((c) => c.id !== tempId))
        setCalloutError(data?.error || 'Failed to add callout')
        return
      }
      setBoardComments((prev) => prev.map((c) => (c.id === tempId ? data.comment : c)))
      setComposer(null)
      setComposerText('')
      setActiveThreadRootId(data.comment.id)
      sendCritDirty('callout')
    } catch (err) {
      console.error('Error adding callout:', err)
      setBoardComments((prev) => prev.filter((c) => c.id !== tempId))
      setCalloutError('Failed to add callout')
    } finally {
      setComposerPosting(false)
    }
  }

  // Reply to a root thread (no anchors). Optimistic.
  const handleSubmitReply = async (rootId: string) => {
    if (!board || replyPosting) return
    const text = replyText.trim()
    if (!text) return
    if (!canComment) { setCalloutError('You don’t have comment access'); return }
    const tempId = `temp-bc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const optimistic: BoardComment = {
      id: tempId, boardId: board.id, roomId: '', parentId: rootId,
      anchorX: null, anchorY: null, body: text,
      authorId: isGuest ? null : (user?.id ?? null), guestTokenId: isGuest ? guestTokenId : null, authorName,
      resolved: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }
    setReplyPosting(true)
    setCalloutError(null)
    setBoardComments((prev) => [...prev, optimistic])
    try {
      const res = await fetch(`/api/boards/${board.id}/board-comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...guestHeader() },
        body: JSON.stringify({ parentId: rootId, body: text, guestName: isGuest ? authorName : undefined }),
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.comment) {
        setBoardComments((prev) => prev.filter((c) => c.id !== tempId))
        setCalloutError(data?.error || 'Failed to reply')
        return
      }
      setBoardComments((prev) => prev.map((c) => (c.id === tempId ? data.comment : c)))
      setReplyText('')
      sendCritDirty('callout')
    } catch (err) {
      console.error('Error replying to callout:', err)
      setBoardComments((prev) => prev.filter((c) => c.id !== tempId))
      setCalloutError('Failed to reply')
    } finally {
      setReplyPosting(false)
    }
  }

  const handleEditCallout = async (id: string) => {
    const text = editingCalloutText.trim()
    if (!text || savingCalloutId) return
    setSavingCalloutId(id)
    setCalloutError(null)
    try {
      const res = await fetch(`/api/board-comments/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...guestHeader() },
        body: JSON.stringify({ body: text }),
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.comment) {
        setCalloutError(data?.error || 'Failed to edit callout')
        return
      }
      setBoardComments((prev) => prev.map((c) => (c.id === id ? data.comment : c)))
      setEditingCalloutId(null)
      setEditingCalloutText('')
      sendCritDirty('callout')
    } catch (err) {
      console.error('Error editing callout:', err)
      setCalloutError('Failed to edit callout')
    } finally {
      setSavingCalloutId(null)
    }
  }

  // Delete a callout. If it's a root, its replies cascade server-side; mirror
  // that locally by dropping the root + any replies.
  const handleDeleteCallout = async (id: string) => {
    if (deletingCalloutId) return
    setDeletingCalloutId(id)
    setCalloutError(null)
    try {
      const res = await fetch(`/api/board-comments/${id}`, {
        method: 'DELETE',
        headers: guestHeader(),
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setCalloutError(data?.error || 'Failed to delete callout')
        return
      }
      setBoardComments((prev) => prev.filter((c) => c.id !== id && c.parentId !== id))
      if (activeThreadRootId === id) setActiveThreadRootId(null)
      sendCritDirty('callout')
    } catch (err) {
      console.error('Error deleting callout:', err)
      setCalloutError('Failed to delete callout')
    } finally {
      setDeletingCalloutId(null)
    }
  }

  const handleToggleResolved = async (rootId: string, nextResolved: boolean) => {
    setCalloutError(null)
    // Optimistic flip.
    setBoardComments((prev) => prev.map((c) => (c.id === rootId ? { ...c, resolved: nextResolved } : c)))
    try {
      const res = await fetch(`/api/board-comments/${rootId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...guestHeader() },
        body: JSON.stringify({ resolved: nextResolved }),
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.comment) {
        // Roll back.
        setBoardComments((prev) => prev.map((c) => (c.id === rootId ? { ...c, resolved: !nextResolved } : c)))
        setCalloutError(data?.error || 'Failed to update callout')
        return
      }
      setBoardComments((prev) => prev.map((c) => (c.id === rootId ? data.comment : c)))
      sendCritDirty('callout')
    } catch (err) {
      console.error('Error resolving callout:', err)
      setBoardComments((prev) => prev.map((c) => (c.id === rootId ? { ...c, resolved: !nextResolved } : c)))
      setCalloutError('Failed to update callout')
    }
  }

  // Convert a click on the capture layer (which fills the viewport container)
  // into an image fraction and open the composer there. Ignores clicks that
  // land in the letterbox (outside the image bounds).
  const handleCalloutPlace = (e: React.MouseEvent) => {
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    const frac = viewport.containerPointToImageFraction(e.clientX - rect.left, e.clientY - rect.top)
    if (!frac) return
    if (frac.x < 0 || frac.x > 1 || frac.y < 0 || frac.y > 1) return
    setComposer({ fx: frac.x, fy: frac.y })
    setComposerText('')
    setCalloutMode(false)
  }

  // ---- Trace handlers ----------------------------------------------------
  const fetchBoardTraces = async () => {
    if (!board) return
    if (isDemoMode || board.id.startsWith('sample-')) {
      setBoardTraces([])
      setTracesLoaded(true)
      return
    }
    try {
      const res = await fetch(`/api/boards/${board.id}/traces`, { credentials: 'include', headers: guestHeader() })
      // 401/403 (non-member) degrades silently — the layer is gated on
      // calloutsAccessible, which the board-comments fetch already resolved.
      if (res.status === 401 || res.status === 403) {
        setBoardTraces([])
        setTracesLoaded(true)
        return
      }
      const data = await res.json().catch(() => ({}))
      setBoardTraces(res.ok ? (data.traces || []) : [])
      setTracesLoaded(true)
    } catch {
      setBoardTraces([])
      setTracesLoaded(true)
    }
  }

  // Persist MY trace (debounced via scheduleSaveTrace). Optimistic: on failure
  // we keep local strokes and toast once so nothing is lost.
  const putTrace = async (strokes: TraceStroke[]) => {
    if (!board || !canTrace) return
    try {
      const res = await fetch(`/api/boards/${board.id}/traces`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...guestHeader() },
        body: JSON.stringify({ strokes, authorColor: traceColor, guestName: isGuest ? authorName : undefined }),
        credentials: 'include',
      })
      if (!res.ok) {
        if (!traceSaveFailedRef.current) {
          traceSaveFailedRef.current = true
          toast.error('Couldn’t save your trace — your drawing is kept locally.')
        }
        return
      }
      traceSaveFailedRef.current = false
      sendCritDirty('trace')
    } catch {
      if (!traceSaveFailedRef.current) {
        traceSaveFailedRef.current = true
        toast.error('Couldn’t save your trace — your drawing is kept locally.')
      }
    }
  }

  const scheduleSaveTrace = (strokes: TraceStroke[]) => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => { void putTrace(strokes) }, 600)
  }

  const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

  // Phase B.5.1: live trace streaming. authorKey matches the persisted layer key
  // (member: user id; guest: guest-token id) so the receiver clears the ephemeral
  // overlay once this author's saved layer refetches. Fire-and-forget; no logging.
  const traceAuthorKey = (): string | null => (isGuest ? (guestTokenId ?? null) : (user?.id ?? null))
  const streamTracePts = (pts: [number, number][]) => {
    const ch = liveChannelRef?.current
    const authorKey = traceAuthorKey()
    if (!ch || !board || !authorKey || pts.length === 0) return
    const r = (n: number) => Math.round(n * 1000) / 1000
    ch.send({
      type: 'broadcast',
      event: 'trace-pt',
      payload: { boardId: board.id, authorKey, color: traceColor, pts: pts.map((p) => [r(p[0]), r(p[1])]) },
    })
  }
  const streamTraceEnd = () => {
    const ch = liveChannelRef?.current
    const authorKey = traceAuthorKey()
    if (!ch || !board || !authorKey) return
    ch.send({ type: 'broadcast', event: 'trace-end', payload: { boardId: board.id, authorKey } })
  }

  const handleTracePointerDown = (e: React.PointerEvent) => {
    if (!traceMode) return
    e.stopPropagation()
    const canvas = traceCanvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const frac = viewport.containerPointToImageFraction(e.clientX - rect.left, e.clientY - rect.top)
    if (!frac) return
    try { (e.target as Element).setPointerCapture(e.pointerId) } catch { /* noop */ }
    const pt: [number, number] = [clamp01(frac.x), clamp01(frac.y)]
    // Reset the stream buffer for the new stroke (B.5.1).
    liveStrokeRef.current = [pt]
    streamSentCountRef.current = 0
    lastStreamTsRef.current = 0
    setDrawingPoints([pt])
  }

  const handleTracePointerMove = (e: React.PointerEvent) => {
    if (!traceMode || !drawingPoints) return
    const canvas = traceCanvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const frac = viewport.containerPointToImageFraction(e.clientX - rect.left, e.clientY - rect.top)
    if (!frac) return
    const pt: [number, number] = [clamp01(frac.x), clamp01(frac.y)]
    // Stream the new points (delta) at ~10Hz so peers see the stroke as it's drawn (B.5.1).
    liveStrokeRef.current.push(pt)
    const now = Date.now()
    if (now - lastStreamTsRef.current >= 100) {
      lastStreamTsRef.current = now
      const delta = liveStrokeRef.current.slice(streamSentCountRef.current)
      if (delta.length) {
        streamTracePts(delta)
        streamSentCountRef.current = liveStrokeRef.current.length
      }
    }
    setDrawingPoints((prev) => (prev ? [...prev, pt] : prev))
  }

  const handleTracePointerUp = (e: React.PointerEvent) => {
    if (!traceMode) return
    try { (e.target as Element).releasePointerCapture(e.pointerId) } catch { /* noop */ }
    if (drawingPoints && drawingPoints.length > 0) {
      const stroke: TraceStroke = { color: traceColor, width: traceWidth, points: drawingPoints }
      const next = [...myStrokes, stroke]
      setMyStrokes(next)
      scheduleSaveTrace(next)
    }
    // Flush any unsent tail of the just-finished stroke, then mark it ended (B.5.1).
    const tail = liveStrokeRef.current.slice(streamSentCountRef.current)
    if (tail.length) streamTracePts(tail)
    if (liveStrokeRef.current.length) streamTraceEnd()
    liveStrokeRef.current = []
    streamSentCountRef.current = 0
    setDrawingPoints(null)
  }

  const handleTraceUndo = () => {
    if (myStrokes.length === 0) return
    const next = myStrokes.slice(0, -1)
    setMyStrokes(next)
    scheduleSaveTrace(next)
  }

  const handleTraceClear = async () => {
    setPendingClearTrace(false)
    setMyStrokes([])
    if (saveTimerRef.current) { window.clearTimeout(saveTimerRef.current); saveTimerRef.current = null }
    setBoardTraces((prev) => prev.filter((t) => (isGuest ? t.guestTokenId !== guestTokenId : t.authorId !== user?.id)))
    if (!board || !canTrace) return
    try {
      const res = await fetch(`/api/boards/${board.id}/traces`, { method: 'DELETE', headers: guestHeader(), credentials: 'include' })
      if (!res.ok && !traceSaveFailedRef.current) {
        traceSaveFailedRef.current = true
        toast.error('Couldn’t clear your trace.')
      } else if (res.ok) {
        traceSaveFailedRef.current = false
        sendCritDirty('trace')
      }
    } catch {
      // Local already cleared; leave it cleared.
    }
  }

  // Initialize MY local strokes from my server row, once per board, after BOTH
  // the traces have loaded and the client user id is known (cookie auth means
  // the fetch can resolve before client `user` hydrates).
  useEffect(() => {
    const haveTraceIdentity = isGuest ? !!guestTokenId : !!user?.id
    if (!board || !haveTraceIdentity || !tracesLoaded) return
    if (tracesInitedForBoardRef.current === board.id) return
    const mine = boardTraces.find((t) => (isGuest ? t.guestTokenId === guestTokenId : t.authorId === user?.id))
    setMyStrokes(mine && Array.isArray(mine.strokes) ? mine.strokes : [])
    if (mine?.authorColor) setTraceColor(mine.authorColor)
    tracesInitedForBoardRef.current = board.id
  }, [board, boardTraces, user?.id, tracesLoaded, isGuest, guestTokenId])

  // Redraw the trace canvas. Points map through imageFractionToContainerPoint
  // each call, so strokes stay glued to the image at any zoom/pan. Stroke width
  // is scaled by the rendered image width so it tracks zoom too.
  const mapFracToPt = viewport.imageFractionToContainerPoint
  const redrawTraces = useCallback(() => {
    const canvas = traceCanvasRef.current
    if (!canvas) return
    const parent = canvas.parentElement
    if (!parent) return
    const w = parent.clientWidth
    const h = parent.clientHeight
    if (w <= 0 || h <= 0) return
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1
    const bw = Math.round(w * dpr)
    const bh = Math.round(h * dpr)
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    const p0 = mapFracToPt(0, 0)
    const p1 = mapFracToPt(1, 0)
    if (!p0 || !p1) return
    const imgW = Math.max(1, p1.x - p0.x)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    const drawStroke = (s: TraceStroke) => {
      if (!s.points || s.points.length === 0) return
      ctx.strokeStyle = s.color
      ctx.fillStyle = s.color
      ctx.lineWidth = Math.max(1, s.width * imgW)
      if (s.points.length === 1) {
        const pt = mapFracToPt(s.points[0][0], s.points[0][1])
        if (pt) { ctx.beginPath(); ctx.arc(pt.x, pt.y, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill() }
        return
      }
      ctx.beginPath()
      s.points.forEach((p, i) => {
        const pt = mapFracToPt(p[0], p[1])
        if (!pt) return
        if (i === 0) ctx.moveTo(pt.x, pt.y)
        else ctx.lineTo(pt.x, pt.y)
      })
      ctx.stroke()
    }
    const myKey = isGuest ? (guestTokenId ?? 'guest') : (user?.id ?? 'me')
    for (const t of boardTraces) {
      const isMine = isGuest
        ? (t.guestTokenId != null && t.guestTokenId === guestTokenId)
        : (!!user?.id && t.authorId === user.id)
      if (isMine) continue // mine drawn from myStrokes
      if (hiddenTraceAuthors.has(t.authorId ?? t.guestTokenId ?? t.id)) continue
      ;(Array.isArray(t.strokes) ? t.strokes : []).forEach(drawStroke)
    }
    if (!hiddenTraceAuthors.has(myKey)) {
      myStrokes.forEach(drawStroke)
      if (drawingPoints && drawingPoints.length) {
        drawStroke({ color: traceColor, width: traceWidth, points: drawingPoints })
      }
    }
    // Phase B.5.1: peers' in-progress (ephemeral) strokes, streamed live before
    // their save lands. Drawn on top of the persisted layer; cleared per author
    // once their saved layer refetches (so no duplication). Never draw my own
    // (self:false means I don't receive it anyway) or a hidden author. Width
    // isn't streamed — use the default for the preview; the refetch converges
    // it to the real width.
    const stream = traceStreamRef?.current
    if (stream && board) {
      const STREAM_WIDTH = TRACE_WIDTHS[0].value
      for (const e of stream.values()) {
        if (e.boardId !== board.id || e.authorKey === myKey) continue
        if (hiddenTraceAuthors.has(e.authorKey)) continue
        const color = e.color || '#94a3b8'
        for (const pts of e.completed) drawStroke({ color, width: STREAM_WIDTH, points: pts })
        if (e.live && e.live.length) drawStroke({ color, width: STREAM_WIDTH, points: e.live })
      }
    }
  }, [mapFracToPt, boardTraces, myStrokes, drawingPoints, hiddenTraceAuthors, traceColor, traceWidth, user?.id, isGuest, guestTokenId, board?.id, traceStreamRef])

  // Redraw on stroke/layer changes AND on every zoom/pan transform change.
  // Phase B.5.1 (BUG 2): also key on calloutsAccessible + tracesLoaded. The trace
  // <canvas> only mounts behind the calloutsAccessible gate, and redrawTraces
  // early-returns on a null canvas / unmeasured image. A trace (re)fetch can set
  // boardTraces before the canvas is mounted (open/follow race); without these
  // deps no redraw re-fires when the canvas later mounts, so the layer stayed
  // blank until a layer toggle. These deps fire a redraw on mount/load so a
  // refetched author appears without toggling.
  useEffect(() => {
    redrawTraces()
  }, [redrawTraces, viewport.scale, viewport.offsetX, viewport.offsetY, calloutsAccessible, tracesLoaded])

  // Phase B.5.1: latest redrawTraces, read by the streaming frame loop without
  // restarting it on every stroke/layer change.
  const redrawTracesRef = useRef(redrawTraces)
  redrawTracesRef.current = redrawTraces

  // Phase B.5.1: while peers are mid-stroke, drive the trace canvas from a frame
  // loop so streamed (ephemeral) strokes paint live — no setState per message.
  // Idle (no redraw) when there's no ephemeral activity for this board; one final
  // redraw fires when the last ephemeral clears so the persisted layer shows clean.
  useEffect(() => {
    if (!isOpen) return
    let raf = 0
    let hadEphemeral = false
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const stream = traceStreamRef?.current
      let hasEphemeral = false
      if (stream && board) {
        for (const e of stream.values()) {
          if (e.boardId === board.id && ((e.live?.length ?? 0) > 0 || e.completed.length > 0)) {
            hasEphemeral = true
            break
          }
        }
      }
      if (hasEphemeral || hadEphemeral) redrawTracesRef.current()
      hadEphemeral = hasEphemeral
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [isOpen, board?.id, traceStreamRef])

  // Phase B.5.1: once a refetch's persisted layer includes an author, drop their
  // ephemeral overlay — the saved strokes supersede it (convergence, no
  // duplication). Keyed on boardTraces so it runs after each (re)fetch; ref
  // mutation only (no setState). The frame loop above repaints the result.
  useEffect(() => {
    const stream = traceStreamRef?.current
    if (!stream || !board) return
    const present = new Set(boardTraces.map((t) => t.authorId ?? t.guestTokenId ?? t.id))
    for (const [k, e] of stream) {
      if (e.boardId === board.id && present.has(e.authorKey)) stream.delete(k)
    }
  }, [boardTraces, board?.id, traceStreamRef])

  // ---- Lightbox follow (Phase B.3.1) -------------------------------------
  // Presenter: broadcast the lightbox viewport (~10Hz, only when changed) so
  // followers mirror zoom/pan. The first interval tick (≤100ms) syncs newly-
  // opened followers. Single raster image only — PDFs/compare have no viewport.
  // channel.send only; no setState, no logging.
  useEffect(() => {
    if (!isPresenter || !isOpen || !board) return
    const url = board.fullImageUrl || board.thumbnailUrl
    if (url?.toLowerCase().endsWith('.pdf') || compareBoards.length > 1) return
    const channel = liveChannelRef?.current
    if (!channel) return
    let lastZ = NaN, lastCx = NaN, lastCy = NaN
    const tick = () => {
      const v = getViewportFraction()
      if (!v) return
      const r = (n: number) => Math.round(n * 1000) / 1000
      const z = r(v.z), cx = r(v.cx), cy = r(v.cy)
      if (z === lastZ && cx === lastCx && cy === lastCy) return
      lastZ = z; lastCx = cx; lastCy = cy
      channel.send({ type: 'broadcast', event: 'lbv', payload: { z, cx, cy } })
    }
    const id = window.setInterval(tick, 100)
    return () => window.clearInterval(id)
  }, [isPresenter, isOpen, board, compareBoards.length, liveChannelRef, getViewportFraction])

  // Phase B.3.2 — presenter pointer-over-image tracking. Wired onto the image
  // container's pointer handlers (below); writes the latest image-fraction (or
  // null when over the letterbox / off the image) into a ref. No-op for non-
  // presenters. The lbc interval reads this ref.
  const handlePresenterCursorMove = (e: React.PointerEvent) => {
    if (!isPresenter) return
    const rect = e.currentTarget.getBoundingClientRect()
    const frac = viewport.containerPointToImageFraction(e.clientX - rect.left, e.clientY - rect.top)
    presenterCursorFracRef.current =
      frac && frac.x >= 0 && frac.x <= 1 && frac.y >= 0 && frac.y <= 1
        ? { cx: frac.x, cy: frac.y }
        : null
  }
  const handlePresenterCursorLeave = () => {
    if (!isPresenter) return
    presenterCursorFracRef.current = null
  }

  // Presenter: broadcast the pointer position over the image (~15Hz) as a sibling
  // "lbc" event so followers render a 2D cursor dot. Sends continuously while over
  // the image (so a still pointer stays visible — same as the 3D cursor) and one
  // { off:true } when it leaves. Single raster image only. channel.send only; no
  // setState, no logging.
  useEffect(() => {
    if (!isPresenter || !isOpen || !board) return
    const url = board.fullImageUrl || board.thumbnailUrl
    if (url?.toLowerCase().endsWith('.pdf') || compareBoards.length > 1) return
    const channel = liveChannelRef?.current
    if (!channel) return
    let wasOff = false
    const tick = () => {
      const f = presenterCursorFracRef.current
      if (!f) {
        if (wasOff) return
        wasOff = true
        channel.send({ type: 'broadcast', event: 'lbc', payload: { off: true } })
        return
      }
      wasOff = false
      const r = (n: number) => Math.round(n * 1000) / 1000
      channel.send({ type: 'broadcast', event: 'lbc', payload: { cx: r(f.cx), cy: r(f.cy) } })
    }
    const id = window.setInterval(tick, 66)
    return () => window.clearInterval(id)
  }, [isPresenter, isOpen, board, compareBoards.length, liveChannelRef])

  // Follower: while the viewport is presenter-driven, disable local zoom/pan.
  // Restored on break-away / not-following / unmount.
  useEffect(() => {
    setInteractionEnabled(!viewportDriven)
    return () => setInteractionEnabled(true)
  }, [viewportDriven, setInteractionEnabled])

  // Follower: smooth-apply the presenter's viewport. Per-"lbv"-message writes
  // land in viewportTargetRef (page handler); here we lerp the local viewport
  // toward it each frame so 10Hz packets render continuously. applyViewportFraction
  // (→ setState) fires ONLY while actually converging, then idles — so there is
  // no per-message and no steady-state per-frame setState. Frame-rate-independent.
  useEffect(() => {
    if (!viewportDriven || !isOpen) return
    let raf = 0
    let lastTs = 0
    let cursorSeqSeen = -1
    let cursorIdle = 0
    const tick = (ts: number) => {
      raf = requestAnimationFrame(tick)
      const dt = lastTs ? Math.min((ts - lastTs) / 1000, 0.1) : 0
      lastTs = ts

      // Phase B.3.2: position the presenter cursor dot over the image, mapped
      // through the follower's CURRENT (mid-lerp) viewport transform so it lands
      // on the same drawing spot at any zoom. Imperative (no setState). Hidden on
      // null ref (off image / closed) or ~2s stale (same rule as the 3D dot).
      const dot = lbCursorDotRef.current
      if (dot) {
        const c = lbCursorRef?.current
        if (c && c.seq !== cursorSeqSeen) { cursorSeqSeen = c.seq; cursorIdle = 0 }
        else cursorIdle += dt
        const pt = c ? viewportImageFractionToContainerPoint(c.cx, c.cy) : null
        if (c && cursorIdle <= 2 && pt) {
          dot.style.left = `${pt.x}px`
          dot.style.top = `${pt.y}px`
          dot.style.display = 'block'
        } else {
          dot.style.display = 'none'
        }
      }

      // Viewport lerp toward the presenter's framing (unchanged from B.3.1).
      const target = viewportTargetRef?.current
      if (!target) return
      const cur = getViewportFraction()
      if (!cur) return
      const dz = target.z - cur.z
      const dcx = target.cx - cur.cx
      const dcy = target.cy - cur.cy
      if (Math.abs(dz) < 1e-3 && Math.abs(dcx) < 1e-4 && Math.abs(dcy) < 1e-4) return
      const a = 1 - Math.exp(-dt * 12)
      applyViewportFraction(cur.z + dz * a, cur.cx + dcx * a, cur.cy + dcy * a)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [viewportDriven, isOpen, getViewportFraction, applyViewportFraction, viewportTargetRef, viewportImageFractionToContainerPoint, lbCursorRef])

  // Phase B.5: a peer changed traces/callouts on a board. The page debounced the
  // "crit-dirty" pings into this signal; here we refetch the matching kind(s) via
  // the EXISTING fetch path (member API or guest-token API, same fns used on open)
  // — but only for the board we're showing. Deferred while local work is in flight
  // so a refetch can't clobber it: an active stroke (drawingPoints), or an in-
  // flight callout post/reply/edit/delete. These are in the deps, so when they
  // clear the effect re-runs and handles the pending signal. Trace refetch is
  // itself non-clobbering — my own strokes live in myStrokes (gated by
  // tracesInitedForBoardRef, untouched by fetchBoardTraces); in-progress reply
  // text / composer are separate state, also untouched by fetchBoardComments.
  useEffect(() => {
    if (!critDirty || !board || critDirty.boardId !== board.id) return
    if (handledCritSeqRef.current === critDirty.seq) return
    if (drawingPoints !== null || composerPosting || replyPosting || savingCalloutId || deletingCalloutId) return
    handledCritSeqRef.current = critDirty.seq
    if (critDirty.trace) fetchBoardTraces()
    if (critDirty.callout) fetchBoardComments()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [critDirty, board?.id, drawingPoints !== null, composerPosting, replyPosting, savingCalloutId, deletingCalloutId])

  const handlePost = async () => {
    if (!board || !newComment.trim() || posting) return
    if (!user) {
      setError('Sign in to post a comment')
      return
    }

    try {
      setPosting(true)
      setError(null)
      const url = isDemoMode
        ? `/api/boards/${board.id}/comments?demo=true`
        : `/api/boards/${board.id}/comments`
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: newComment.trim(),
          authorName: authorName,
        }),
        credentials: 'include',
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        const message = response.status === 401
          ? 'Sign in to post a comment'
          : (data?.details || data?.error || 'Failed to post comment')
        setError(message)
        return
      }

      setComments(prev => [...prev, data.comment])
      setNewComment('')
      textareaRef.current?.focus()
    } catch (err) {
      console.error('Error posting comment:', err)
      setError('Failed to post comment')
    } finally {
      setPosting(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handlePost()
    }
  }

  const canManageComment = (comment: Comment) => {
    if (!user) return false
    if (comment.authorId && comment.authorId === user.id) return true
    return comment.authorName === authorName
  }

  const handleStartEdit = (comment: Comment) => {
    setEditingCommentId(comment.id)
    setEditingContent(comment.content)
  }

  const handleCancelEdit = () => {
    setEditingCommentId(null)
    setEditingContent('')
  }

  const handleSaveEdit = async (commentId: string) => {
    if (!board || !editingContent.trim() || savingCommentId) return
    try {
      setSavingCommentId(commentId)
      setError(null)
      const url = isDemoMode
        ? `/api/boards/${board.id}/comments?demo=true`
        : `/api/boards/${board.id}/comments`
      const response = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commentId, content: editingContent.trim() }),
        credentials: 'include',
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(data?.details || data?.error || 'Failed to edit comment')
        return
      }
      setComments((prev) => prev.map((c) => (c.id === commentId ? { ...c, content: data.comment.content } : c)))
      handleCancelEdit()
    } catch (err) {
      console.error('Error editing comment:', err)
      setError('Failed to edit comment')
    } finally {
      setSavingCommentId(null)
    }
  }

  const handleDeleteComment = async (commentId: string) => {
    if (!board || deletingCommentId) return
    if (pendingDeleteCommentId !== commentId) {
      setPendingDeleteCommentId(commentId)
      // Auto-clear after 4 seconds if user doesn't confirm
      setTimeout(() => setPendingDeleteCommentId((prev) => prev === commentId ? null : prev), 4000)
      return
    }
    setPendingDeleteCommentId(null)
    try {
      setDeletingCommentId(commentId)
      setError(null)
      const url = isDemoMode
        ? `/api/boards/${board.id}/comments?demo=true`
        : `/api/boards/${board.id}/comments`
      const response = await fetch(url, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commentId }),
        credentials: 'include',
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(data?.details || data?.error || 'Failed to delete comment')
        return
      }
      setComments((prev) => prev.filter((c) => c.id !== commentId))
      if (editingCommentId === commentId) handleCancelEdit()
    } catch (err) {
      console.error('Error deleting comment:', err)
      setError('Failed to delete comment')
    } finally {
      setDeletingCommentId(null)
    }
  }

  const handleClose = () => {
    setIsVisible(false)
    
    // Check if we should return to gallery
    const returnTo = searchParams.get('returnTo')
    if (returnTo === 'gallery') {
      // Navigate back to gallery after a short delay for animation
      setTimeout(() => {
        // Check if we're in demo mode
        const isDemo = searchParams.get('demo') === 'true' || window.location.pathname.includes('demo-studio-')
        
        // Preserve gallery params from current URL (they should be there from the E key handler)
        const urlParams = new URLSearchParams()
        const department = searchParams.get('department')
        const year = searchParams.get('year')
        const color = searchParams.get('color')
        const appearance = searchParams.get('appearance')
        
        // Also try to get params from referrer as fallback
        if (document.referrer) {
          try {
            const referrerUrl = new URL(document.referrer)
            referrerUrl.searchParams.forEach((value, key) => {
              if (['color', 'department', 'year', 'appearance'].includes(key)) {
                // Only use referrer value if not already in current URL
                if (!urlParams.has(key)) {
                  urlParams.set(key, value)
                }
              }
            })
          } catch {
            // Ignore referrer parsing errors
          }
        }
        
        // Use current URL params if available (they're more reliable)
        if (department) urlParams.set('department', department)
        if (year) urlParams.set('year', year)
        if (color) urlParams.set('color', color)
        if (appearance) urlParams.set('appearance', appearance)
        
        if (isDemo) {
          urlParams.set('demo', 'true')
        }
        
        router.push(`/gallery?${urlParams.toString()}`)
      }, 200)
    } else {
      // Just close the modal normally
      setTimeout(onClose, 200)
    }
  }

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      handleClose()
    }
  }

  if (!isOpen || !board) return null

  const imageUrl = board.fullImageUrl || board.thumbnailUrl
  const isPDF = imageUrl?.toLowerCase().endsWith('.pdf')
  // Resolved video link: optimistic override (incl. cleared = null) wins over
  // the board's stored value so the UI updates immediately after an edit.
  const resolvedLinkUrl = linkOverride ? linkOverride.value : board.linkUrl ?? null

  const openVideo = () => {
    if (resolvedLinkUrl) window.open(resolvedLinkUrl, '_blank', 'noopener,noreferrer')
  }

  // ---- Callout derivations (recomputed each render so pins track zoom/pan) --
  const isInstructor = currentUserRole === 'instructor'
  const rootCallouts = boardComments.filter((c) => c.parentId == null)
  const calloutNumber = new Map(rootCallouts.map((r, i) => [r.id, i + 1] as const))
  const visibleRoots = showResolved ? rootCallouts : rootCallouts.filter((r) => !r.resolved)
  const repliesFor = (rootId: string) =>
    boardComments
      .filter((c) => c.parentId === rootId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const activeRoot = activeThreadRootId
    ? rootCallouts.find((r) => r.id === activeThreadRootId) ?? null
    : null
  const isCalloutAuthor = (c: BoardComment) =>
    isGuest ? (!!guestTokenId && c.guestTokenId === guestTokenId) : (!!user && c.authorId === user.id)
  // Callouts only make sense on a single raster image the viewport can map.
  const calloutsEnabled = !isPDF && compareBoards.length <= 1 && !isDemoMode && !board.id.startsWith('sample-')

  // ---- Header / tool-dock derivations (Pass A: layout only) --------------
  // Nav counter "03 / 05" from the existing index/total; null when the current
  // board isn't in allBoards (e.g. a compare selection) so no state is invented.
  const navTotalLabel = String(allBoards.length).padStart(2, '0')
  const navPositionLabel =
    currentIndex >= 0 && allBoards.length > 0
      ? String((pendingPosition ?? currentIndex + 1)).padStart(2, '0')
      : null
  const navCounter = navPositionLabel ? `${navPositionLabel} / ${navTotalLabel}` : null
  // Reserve the input at the widest the position can get, so entering and
  // leaving edit mode never reflows the header. +1ch of breathing room.
  const navPositionWidthCh = Math.max(2, navTotalLabel.length) + 1
  // Title-block board size + provenance. Honors an optimistic override from a
  // just-saved manual size. TRUE/SET show the plain size; ASSUMED (aspect-ratio
  // 36" default — no measurement) is flagged so a test-fit stays honest.
  const sizeDisplay = sizeOverride
    ? {
        widthIn: sizeOverride.widthIn,
        heightIn: sizeOverride.heightIn,
        provenance: 'set' as const,
        label: `${Math.round(sizeOverride.widthIn)} × ${Math.round(sizeOverride.heightIn)} IN`,
      }
    : getBoardSizeDisplay(board)
  // Manual board-size control: edit mode, owner or instructor, and only for a
  // board actually placed on a wall (the position PATCH needs its wall position).
  const isBoardOwner = !board.ownerId || (!!user && board.ownerId === user.id)
  const canEditSize = isEditMode && !!board.position && (currentUserRole === 'instructor' || isBoardOwner)
  // Inline title edit — unlike author-name/size (edit-mode only), this is offered
  // in BOTH view and edit mode to exactly who the PATCH /api/boards/[id] route
  // accepts: the board's uploader, the workspace/room owner (surfaced as the
  // 'instructor' role — /api/workspaces guarantees the owner appears as
  // instructor), ANY workspace member, or a platform superadmin. Guests and
  // logged-out viewers see plain static text — no affordance, no cursor change.
  // The server re-checks, so a stale affordance just round-trips to a 403 →
  // revert + toast. NB: a STRICT uploader match, not isBoardOwner — its no-owner
  // fallback would over-grant to any viewer of an owner-less board now that this
  // is no longer edit-gated.
  //
  // `currentUserRole !== null` IS the membership test: it is resolved from the
  // workspace members list (app/studio/[id]/page.tsx:396-401) and stays null for
  // anyone not in it — which is what the share/crit/gallery callers pass. Widened
  // in step with the route; the two must not drift apart again.
  const isBoardUploader = !!user && !!board.ownerId && board.ownerId === user.id
  const canEditTitle = isBoardUploader || currentUserRole !== null || isSuperadminViewer
  // Optimistic override wins over the stored value so a rename shows instantly.
  const resolvedTitle = titleOverride ?? board.title

  // Save the board image to disk. Read-only — never writes to Storage. The
  // public-bucket path hands the browser a ?download= URL and lets it stream the
  // bytes directly (works for guests on a crit link: no auth, no CORS, no fetch).
  // Anything else (demo/sample placeholder hosts) falls back to fetch→blob.
  const handleDownload = async () => {
    const filename = downloadFileName(resolvedTitle, board.id, imageUrl)
    if (imageUrl.includes(SUPABASE_PUBLIC_MARKER)) {
      try {
        const u = new URL(imageUrl)
        u.searchParams.set('download', filename)
        triggerAnchorDownload(u.toString(), filename)
        return
      } catch {
        // Unparseable URL — fall through to the blob path.
      }
    }
    try {
      const res = await fetch(imageUrl)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const objectUrl = URL.createObjectURL(await res.blob())
      triggerAnchorDownload(objectUrl, filename)
      // Revoking in the same tick can abort the download in Firefox/Safari.
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
    } catch {
      toast.error('Couldn’t download this board.')
    }
  }
  // Zoom controls surface the EXISTING viewport hook — step scale about the
  // current center via getViewportFraction→applyViewportFraction (which clamps
  // to MIN_SCALE..maxScale internally). Fit = reset. No zoom math reimplemented.
  const ZOOM_STEP = 1.4
  const MAX_ZOOM = 8 // mirrors useImageViewport DEFAULT_MAX_SCALE (maxScale left at default)
  const stepZoom = (dir: 1 | -1) => {
    const v = getViewportFraction()
    if (!v) return
    applyViewportFraction(v.z * (dir > 0 ? ZOOM_STEP : 1 / ZOOM_STEP), v.cx, v.cy)
  }
  const zoomPct = Math.round(viewport.scale * 100)
  const atMinZoom = viewport.scale <= 1.001
  const atMaxZoom = viewport.scale >= MAX_ZOOM - 0.001

  return (
    <div 
      className={`fixed inset-0 bg-slate-950/85 z-50 transition-opacity duration-300 ${
        isVisible ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={handleBackdropClick}
    >
      {/* Top Header Bar (hidden in present mode) */}
      {!isPresentMode && (
      <div className="absolute top-3 left-3 right-3 rounded-2xl bg-slate-900/75 backdrop-blur-xl border border-slate-700/70 shadow-[0_10px_30px_rgba(2,6,23,0.45)] flex items-center justify-between gap-3 px-4 sm:px-5 py-2.5 z-20">
        {/* Title block — title + author · sheet size (title-block feel) */}
        <div className="flex-1 min-w-0">
          {compareBoards.length > 1 ? (
            <h2 className="text-slate-50 font-semibold text-sm sm:text-[15px] truncate">
              {`Compare selection (${compareBoards.length})`}
            </h2>
          ) : editingTitle && canEditTitle ? (
            <input
              type="text"
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                // Swallow every key so Esc / arrows don't reach the lightbox's
                // window-level close + prev/next handlers while editing.
                e.stopPropagation()
                if (e.key === 'Enter') { e.preventDefault(); handleSaveTitle() }
                else if (e.key === 'Escape') {
                  e.preventDefault()
                  titleEditCancelRef.current = true
                  setEditingTitle(false)
                  setTitleInput('')
                }
              }}
              onBlur={handleSaveTitle}
              autoFocus
              maxLength={120}
              disabled={savingTitle}
              className="w-full text-slate-900 bg-white/95 border border-indigo-400 rounded px-2 py-0.5 text-sm sm:text-[15px] font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-60"
              placeholder="Board title"
            />
          ) : canEditTitle ? (
            <h2
              className="text-slate-50 font-semibold text-sm sm:text-[15px] flex items-center gap-1 min-w-0 group/title cursor-pointer hover:text-white"
              onClick={(e) => {
                e.stopPropagation()
                // Clear a cancel flag left set by a prior Esc: the unmount that
                // followed it may never have fired blur, and a stale true would
                // silently cancel THIS edit's commit.
                titleEditCancelRef.current = false
                setTitleInput(resolvedTitle)
                setEditingTitle(true)
              }}
              title="Rename board"
            >
              <span className="truncate">{resolvedTitle}</span>
              <svg className="w-3.5 h-3.5 opacity-0 group-hover/title:opacity-60 transition-opacity flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.232-6.232a2.5 2.5 0 113.536 3.536L12.536 16.5H9V13z" />
              </svg>
            </h2>
          ) : (
            <h2 className="text-slate-50 font-semibold text-sm sm:text-[15px] truncate">
              {resolvedTitle}
            </h2>
          )}
          {(() => {
            const resolvedName = displayedAuthorName ?? board.studentName ?? 'Unknown'

            if (isEditMode && editingAuthorName) {
              return (
                <div className="flex items-center gap-1.5 mt-0.5" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="text"
                    value={authorNameInput}
                    onChange={(e) => setAuthorNameInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); handleSaveAuthorName() }
                      else if (e.key === 'Escape') { setEditingAuthorName(false) }
                    }}
                    onBlur={handleSaveAuthorName}
                    autoFocus
                    disabled={isSavingAuthorName}
                    className="text-[11px] text-slate-900 bg-white/95 border border-indigo-400 rounded px-1.5 py-0.5 w-36 focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-60"
                    placeholder="Author name"
                  />
                  {isSavingAuthorName && (
                    <div className="w-3 h-3 rounded-full border border-slate-400 border-t-white animate-spin flex-shrink-0" />
                  )}
                </div>
              )
            }

            return (
              <p className="text-[11px] text-slate-300/90 truncate mt-0.5 flex items-center gap-1.5">
                <span
                  className={`inline-flex items-center gap-1 ${isEditMode ? 'group/author cursor-pointer hover:text-white' : ''}`}
                  onClick={isEditMode ? () => {
                    setAuthorNameInput(resolvedName === 'Unknown' ? '' : resolvedName)
                    setEditingAuthorName(true)
                  } : undefined}
                >
                  {resolvedName}
                  {isEditMode && (
                    <svg className="w-3 h-3 opacity-0 group-hover/author:opacity-60 transition-opacity flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.232-6.232a2.5 2.5 0 113.536 3.536L12.536 16.5H9V13z" />
                    </svg>
                  )}
                </span>
                <span className="font-mono uppercase tracking-wider text-[10px] text-slate-400/80 flex-shrink-0">
                  · {sizeDisplay.label}
                  {sizeDisplay.provenance === 'assumed' && (
                    <span className="text-slate-500/70"> (assumed)</span>
                  )}
                </span>
              </p>
            )
          })()}
        </div>

        {/* Actions — nav · Present (primary) · secondary · close */}
        <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
          {/* Nav cluster: chevron · counter · chevron (single responsive treatment) */}
          <div className="flex items-center gap-1">
            <button
              onClick={(e) => { e.stopPropagation(); onNavigate('prev') }}
              disabled={!hasPrev}
              className="w-8 h-8 flex items-center justify-center rounded-full border border-white/20 bg-white/5 text-white/90 hover:bg-white/15 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              aria-label="Previous"
            >
              <svg className="w-3.5 h-3.5" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
                <path d="M15 19l-7-7 7-7"></path>
              </svg>
            </button>
            {navCounter && (
              canReorder && navPositionLabel ? (
                // Editable slideshow position. Same shell/typography as the
                // read-only counter below, so the header is pixel-identical
                // apart from the hover affordance.
                <span className="px-1 text-[11px] font-mono tabular-nums text-slate-300/80 select-none whitespace-nowrap inline-flex items-center gap-1">
                  {editingPosition ? (
                    <input
                      type="text"
                      inputMode="numeric"
                      value={positionInput}
                      onChange={(e) => setPositionInput(e.target.value.replace(/[^\d]/g, ''))}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        // Swallow every key: unhandled arrows would reach the
                        // lightbox's window-level prev/next handler and navigate
                        // away mid-edit, and Esc would close the modal.
                        e.stopPropagation()
                        if (e.key === 'Enter') { e.preventDefault(); handleCommitPosition() }
                        else if (e.key === 'Escape') {
                          e.preventDefault()
                          positionEditCancelRef.current = true
                          setEditingPosition(false)
                          setPositionInput('')
                        }
                      }}
                      onBlur={handleCommitPosition}
                      autoFocus
                      onFocus={(e) => e.currentTarget.select()}
                      maxLength={navTotalLabel.length + 1}
                      disabled={savingPosition}
                      style={{ width: `${navPositionWidthCh}ch` }}
                      className="text-slate-900 bg-white/95 border border-indigo-400 rounded px-1 py-0 text-[11px] font-mono tabular-nums text-center focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-60"
                      aria-label="Slideshow position"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        if (savingPosition) return
                        // Clear a cancel flag left set by a prior Esc: the
                        // unmount that followed it may never have fired blur,
                        // and a stale true would silently cancel THIS edit's
                        // commit.
                        positionEditCancelRef.current = false
                        setPositionInput(String(currentIndex + 1))
                        setEditingPosition(true)
                      }}
                      disabled={savingPosition}
                      style={{ width: `${navPositionWidthCh}ch` }}
                      className="text-center rounded hover:bg-white/15 hover:text-white transition-colors disabled:opacity-60 disabled:cursor-wait"
                      title="Set slideshow position"
                    >
                      {navPositionLabel}
                    </button>
                  )}
                  <span>/ {navTotalLabel}</span>
                </span>
              ) : (
                <span className="px-1 text-[11px] font-mono tabular-nums text-slate-300/80 select-none whitespace-nowrap">
                  {navCounter}
                </span>
              )
            )}
            <button
              onClick={(e) => { e.stopPropagation(); onNavigate('next') }}
              disabled={!hasNext}
              className="w-8 h-8 flex items-center justify-center rounded-full border border-white/20 bg-white/5 text-white/90 hover:bg-white/15 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              aria-label="Next"
            >
              <svg className="w-3.5 h-3.5" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
                <path d="M9 5l7 7-7 7"></path>
              </svg>
            </button>
          </div>

          {/* Present — PRIMARY (filled accent). Full-screen board only. */}
          {compareBoards.length <= 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                setIsPresentMode(true)
              }}
              className="flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-semibold bg-indigo-500 text-white hover:bg-indigo-400 border border-indigo-400/50 shadow-sm transition-colors"
              title="Present (board fills screen)"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2">
                <path d="M4 8V6a2 2 0 012-2h2M4 16v2a2 2 0 002 2h2M20 8V6a2 2 0 00-2-2h-2M20 16v2a2 2 0 002 2h-2M14 6v12" />
              </svg>
              <span className="hidden sm:inline">Present</span>
            </button>
          )}

          {/* Open link — viewer-facing icon button when a link is attached */}
          {resolvedLinkUrl && (
            <button
              onClick={(e) => { e.stopPropagation(); openVideo() }}
              className="w-8 h-8 flex items-center justify-center rounded-full border border-white/20 bg-white/5 text-white/90 hover:bg-white/15 transition-colors"
              title="Open link in a new tab"
              aria-label="Open link in a new tab"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Add / Edit link — compact icon button that opens the existing editor (edit mode only) */}
          {isEditMode && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                if (editingLink) { setEditingLink(false); setLinkError(null) }
                else { setEditingSize(false); setLinkInput(resolvedLinkUrl ?? ''); setEditingLink(true); setLinkError(null) }
              }}
              className={`w-8 h-8 flex items-center justify-center rounded-full border transition-colors ${
                editingLink
                  ? 'border-indigo-300 bg-indigo-500/30 text-white'
                  : 'border-white/20 bg-white/5 text-white/90 hover:bg-white/15'
              }`}
              title={resolvedLinkUrl ? 'Edit link' : 'Add link'}
              aria-label={resolvedLinkUrl ? 'Edit link' : 'Add link'}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 010 5.656l-3 3a4 4 0 01-5.656-5.656l1.5-1.5M10.172 13.828a4 4 0 010-5.656l3-3a4 4 0 015.656 5.656l-1.5 1.5" />
              </svg>
            </button>
          )}

          {/* Board size — real-world sheet size / custom inches (owner/instructor,
              placed board). Opens the size popover below. */}
          {canEditSize && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                if (editingSize) { setEditingSize(false); setSizeError(null) }
                else {
                  setEditingLink(false)
                  setSizeWidthInput(String(Math.round(sizeDisplay.widthIn * 10) / 10))
                  setSizeHeightInput(String(Math.round(sizeDisplay.heightIn * 10) / 10))
                  setSizeError(null)
                  setEditingSize(true)
                }
              }}
              className={`w-8 h-8 flex items-center justify-center rounded-full border transition-colors ${
                editingSize
                  ? 'border-indigo-300 bg-indigo-500/30 text-white'
                  : 'border-white/20 bg-white/5 text-white/90 hover:bg-white/15'
              }`}
              title="Set real-world board size"
              aria-label="Set board size"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4" />
              </svg>
            </button>
          )}

          {/* Comments — legacy panel toggle (icon + count badge). Members only. */}
          {commentsAccessible && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                setCommentsOpen(prev => !prev)
              }}
              className={`relative w-8 h-8 flex items-center justify-center rounded-full border transition-colors ${
                commentsOpen
                  ? 'border-indigo-300 bg-indigo-500/30 text-white'
                  : 'border-white/20 bg-white/5 text-white/90 hover:bg-white/15'
              }`}
              title="Toggle comments panel"
              aria-label="Toggle comments panel"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4-.8L3 20l1.3-3.9A7.6 7.6 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              {comments.length > 0 && (
                <span className="absolute -top-1 -right-1 inline-flex items-center justify-center min-w-[16px] h-4 px-1 text-[10px] font-semibold bg-indigo-500 text-white rounded-full border border-slate-900">
                  {comments.length}
                </span>
              )}
            </button>
          )}

          {/* Download — save the board image. Everyone, including guests on a
              crit link (public bucket = no auth). Single-board only, matching
              Present: "the viewed board" is ambiguous in a compare selection. */}
          {compareBoards.length <= 1 && !!imageUrl && (
            <button
              onClick={(e) => { e.stopPropagation(); void handleDownload() }}
              className="w-8 h-8 flex items-center justify-center rounded-full border border-white/20 bg-white/5 text-white/90 hover:bg-white/15 transition-colors"
              title="Download image"
              aria-label="Download image"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Close */}
          <button
            onClick={handleClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 border border-white/30 transition-colors"
            aria-label="Close"
          >
            <svg
              className="w-3.5 h-3.5 text-white"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>

        {/* Link editor popover — the EXISTING editor, moved out of the title column.
            Opens under the Add/Edit-link icon button; all handlers preserved. */}
        {isEditMode && editingLink && (
          <div className="absolute right-4 top-full mt-2 z-30" onClick={(e) => e.stopPropagation()}>
            <div className="flex flex-col gap-1 rounded-xl bg-slate-900/90 backdrop-blur-xl border border-slate-700/70 shadow-[0_10px_30px_rgba(2,6,23,0.45)] p-2">
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={linkInput}
                  onChange={(e) => {
                    setLinkInput(e.target.value)
                    if (linkError) setLinkError(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); handleSaveLink() }
                    else if (e.key === 'Escape') { setEditingLink(false); setLinkError(null) }
                  }}
                  autoFocus
                  disabled={savingLink}
                  placeholder="https://..."
                  className="text-[11px] text-slate-900 bg-white/95 border border-indigo-400 rounded px-1.5 py-0.5 w-52 sm:w-64 focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-60"
                />
                <button
                  onClick={handleSaveLink}
                  disabled={savingLink}
                  className="text-[11px] px-2 py-0.5 rounded bg-indigo-500 text-white hover:bg-indigo-400 disabled:opacity-60"
                >
                  {savingLink ? 'Saving…' : 'Save'}
                </button>
                <button
                  onClick={() => { setEditingLink(false); setLinkError(null) }}
                  disabled={savingLink}
                  className="text-[11px] px-2 py-0.5 rounded bg-white/10 text-white/80 hover:bg-white/20 disabled:opacity-60"
                >
                  Cancel
                </button>
              </div>
              {linkError && <p className="text-[10px] text-red-300">{linkError}</p>}
            </div>
          </div>
        )}

        {/* Board-size popover — a sheet preset fills the inches inputs (fit
            within the sheet, image aspect preserved); Save commits via
            handleSaveSize (existing position PATCH). Custom inches always
            editable. */}
        {canEditSize && editingSize && (
          <div className="absolute right-4 top-full mt-2 z-30" onClick={(e) => e.stopPropagation()}>
            <div className="flex flex-col gap-2 w-64 rounded-xl bg-slate-900/90 backdrop-blur-xl border border-slate-700/70 shadow-[0_10px_30px_rgba(2,6,23,0.45)] p-3">
              <div className="text-[10px] uppercase tracking-wider text-slate-400">Board size (real-world)</div>
              <select
                value=""
                onChange={(e) => {
                  const preset: SheetSizePreset | undefined = SHEET_SIZE_PRESETS.find((p) => p.label === e.target.value)
                  if (!preset) return
                  const fit = fitBoardWithinSheet(board.aspectRatio, preset.widthIn, preset.heightIn)
                  setSizeWidthInput(String(Math.round(fit.widthIn * 10) / 10))
                  setSizeHeightInput(String(Math.round(fit.heightIn * 10) / 10))
                  setSizeError(null)
                }}
                className="w-full text-xs text-slate-800 bg-white/95 border border-slate-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              >
                <option value="">Sheet preset…</option>
                {SHEET_SIZE_PRESETS.map((p) => (
                  <option key={p.label} value={p.label}>{p.label} in</option>
                ))}
              </select>
              <div className="flex items-center gap-1.5">
                <label className="flex items-center gap-1 text-[11px] text-slate-300">
                  <span className="font-semibold">W</span>
                  <input
                    type="number" min={1} max={600} step={0.5}
                    value={sizeWidthInput}
                    onChange={(e) => { setSizeWidthInput(e.target.value); if (sizeError) setSizeError(null) }}
                    className="w-16 text-[11px] text-slate-900 bg-white/95 border border-slate-300 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  />
                </label>
                <label className="flex items-center gap-1 text-[11px] text-slate-300">
                  <span className="font-semibold">H</span>
                  <input
                    type="number" min={1} max={600} step={0.5}
                    value={sizeHeightInput}
                    onChange={(e) => { setSizeHeightInput(e.target.value); if (sizeError) setSizeError(null) }}
                    className="w-16 text-[11px] text-slate-900 bg-white/95 border border-slate-300 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  />
                </label>
                <span className="text-[11px] text-slate-400">in</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-slate-500 truncate">
                  Now: {sizeDisplay.label}{sizeDisplay.provenance === 'assumed' ? ' (assumed)' : ''}
                </span>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => { setEditingSize(false); setSizeError(null) }}
                    disabled={savingSize}
                    className="text-[11px] px-2 py-0.5 rounded bg-white/10 text-white/80 hover:bg-white/20 disabled:opacity-60"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleSaveSize(parseFloat(sizeWidthInput), parseFloat(sizeHeightInput))}
                    disabled={savingSize}
                    className="text-[11px] px-2 py-0.5 rounded bg-indigo-500 text-white hover:bg-indigo-400 disabled:opacity-60"
                  >
                    {savingSize ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
              {sizeError && <p className="text-[10px] text-red-300">{sizeError}</p>}
            </div>
          </div>
        )}
      </div>
      )}

      {/* Present mode: no top bar; prev/next on sides + exit in corner */}
      {isPresentMode && (
        <>
          {/* Exit present - small corner control so it doesn't block the board */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              if (isComparePresentMode) {
                handleClose()
              } else {
                setIsPresentMode(false)
              }
            }}
            className="absolute top-6 right-6 z-20 px-3 py-1.5 rounded-lg text-xs font-medium text-white/80 hover:text-white bg-black/40 hover:bg-black/60 border border-white/20 transition-colors"
          >
            Exit present
          </button>
          {/* Prev/Next in present mode - left/right edges */}
          {!isComparePresentMode && hasPrev && (
            <button
              onClick={(e) => { e.stopPropagation(); onNavigate('prev') }}
              className="absolute left-2 top-1/2 -translate-y-1/2 z-20 w-10 h-10 flex items-center justify-center rounded-full bg-black/50 hover:bg-black/70 text-white/90 hover:text-white border border-white/20 transition-colors"
              aria-label="Previous board"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2">
                <path d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          {!isComparePresentMode && hasNext && (
            <button
              onClick={(e) => { e.stopPropagation(); onNavigate('next') }}
              className="absolute right-2 top-1/2 -translate-y-1/2 z-20 w-10 h-10 flex items-center justify-center rounded-full bg-black/50 hover:bg-black/70 text-white/90 hover:text-white border border-white/20 transition-colors"
              aria-label="Next board"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2">
                <path d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}
        </>
      )}

      {/* Main Content */}
      <div className={`h-full flex ${isPresentMode ? 'pt-0' : 'pt-20'}`}>
        {/* Left Side - Image/PDF Display (full area in present mode) */}
        <div 
          className={`flex-1 flex items-center justify-center ${isPresentMode ? 'absolute inset-0 p-4' : 'p-8 lg:p-12'}`}
          onClick={handleBackdropClick}
        >
          {isComparePresentMode ? (
            <div className="w-full h-full overflow-x-auto overflow-y-hidden" onClick={(e) => e.stopPropagation()}>
              <div
                className={`flex w-max min-w-full h-full items-stretch ${compareJustifyClass}`}
                style={{ gap: `${compareGapPx}px` }}
              >
                {compareBoards.map((compareBoard) => {
                  const compareImageUrl = compareBoard.fullImageUrl || compareBoard.thumbnailUrl
                  const compareIsPdf = compareImageUrl?.toLowerCase().endsWith('.pdf')
                  return (
                    <div
                      key={compareBoard.id}
                      className="flex-none h-full min-h-0 flex items-center justify-center"
                      style={{ width: compareCardWidth }}
                    >
                      {compareImageUrl ? (
                        compareIsPdf ? (
                          <a
                            href={compareImageUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm transition-colors"
                          >
                            Open PDF
                          </a>
                        ) : (
                          <img
                            src={compareImageUrl}
                            alt={compareBoard.title}
                            className="w-full h-full object-contain"
                            style={{ transform: `rotate(${compareBoard.position?.rotation ?? 0}rad)`, transition: 'transform 0.3s ease' }}
                          />
                        )
                      ) : (
                        <p className="text-white/70 text-sm">No image available</p>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ) : imageUrl ? (
            isPDF ? (
              <div 
                className="w-full h-full max-w-4xl bg-white rounded-lg shadow-2xl overflow-hidden flex flex-col"
                onClick={(e) => e.stopPropagation()}
              >
                {/* PDF Header */}
                <div className="flex items-center justify-between px-4 py-3 bg-gray-100 border-b">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-red-100 rounded-lg">
                      <svg className="w-5 h-5 text-red-600" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <span className="font-medium text-gray-800 text-sm">{board.title}.pdf</span>
                  </div>
                  <a 
                    href={imageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-1.5 bg-gray-200 hover:bg-gray-300 rounded-lg text-sm text-gray-700 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                    Open in new tab
                  </a>
                </div>
                {/* PDF Embed */}
                <div className="flex-1 bg-gray-200">
                  <embed
                    src={`${imageUrl}#toolbar=1&navpanes=1&scrollbar=1`}
                    type="application/pdf"
                    className="w-full h-full"
                    style={{ minHeight: '70vh' }}
                  />
                </div>
              </div>
            ) : (
              <div
                ref={viewport.containerRef}
                className="relative w-full h-full flex items-center justify-center overflow-hidden"
                style={{ touchAction: 'none' }}
                onPointerDown={viewport.onPointerDown}
                onPointerMove={(e) => { viewport.onPointerMove(e); handlePresenterCursorMove(e) }}
                onPointerUp={viewport.onPointerUp}
                onPointerCancel={viewport.onPointerCancel}
                onPointerLeave={handlePresenterCursorLeave}
                onDoubleClick={viewport.onDoubleClick}
                onClick={(e) => {
                  // Click on empty letterbox space closes (preserves the prior
                  // click-outside-image behavior); clicks on the image are
                  // stopped on the <img> below so they never reach here.
                  if (e.target === e.currentTarget) {
                    e.stopPropagation()
                    handleClose()
                  }
                }}
              >
                <img
                  ref={viewport.imgRef}
                  src={imageUrl}
                  alt={board.title}
                  draggable={false}
                  onLoad={viewport.onImageLoad}
                  className={`max-w-full max-h-full object-contain select-none ${isPresentMode ? 'rounded-none shadow-none w-full h-full' : 'rounded-lg shadow-2xl'}`}
                  style={{
                    // Compose pan (screen px) + zoom + the existing rotate() so
                    // rotation is preserved exactly (dead data at 0 today).
                    transform: `translate(${viewport.offsetX}px, ${viewport.offsetY}px) scale(${viewport.scale}) rotate(${board.position?.rotation ?? 0}rad)`,
                    transformOrigin: 'center center',
                    transition: viewport.isInteracting ? 'none' : 'transform 0.15s ease',
                    cursor: viewport.scale > 1 ? (viewport.isInteracting ? 'grabbing' : 'grab') : 'default',
                    willChange: 'transform',
                  }}
                  onClick={(e) => e.stopPropagation()}
                />

                {/* Phase B.3.2: presenter cursor dot (followers only). Positioned
                    imperatively each frame in the smooth-apply loop; pointer-events
                    none so it never intercepts clicks. */}
                {viewportDriven && (
                  <div
                    ref={lbCursorDotRef}
                    className="absolute z-20 rounded-full pointer-events-none"
                    style={{
                      display: 'none',
                      width: 12,
                      height: 12,
                      background: cursorColor,
                      transform: 'translate(-50%, -50%)',
                      boxShadow: '0 0 0 2px rgba(255,255,255,0.75)',
                    }}
                  />
                )}

                {/* Tool dock — floating bottom-center over the image. Holds the
                    callout/trace tools (moved out of the header, handlers/gates
                    unchanged) plus zoom controls that surface the EXISTING
                    viewport hook. Hidden in present mode (same gate as header).
                    pointer-events isolated so it never starts a pan/zoom. */}
                {!isPresentMode && (
                  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 pointer-events-none">
                    <div
                      className="pointer-events-auto flex items-center gap-1 px-2 py-1.5 rounded-full bg-slate-900/85 backdrop-blur-md border border-white/15 shadow-[0_10px_30px_rgba(2,6,23,0.45)]"
                      onClick={(e) => e.stopPropagation()}
                      onPointerDown={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => e.stopPropagation()}
                    >
                      {/* Add callout — existing button, same handler / mutual-exclusion / gate / badge */}
                      {!hideCallouts && calloutsEnabled && calloutsAccessible && canComment && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setComposer(null)
                            setTraceMode(false)
                            setCalloutMode((m) => !m)
                          }}
                          className={`flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-medium border transition-colors ${
                            calloutMode
                              ? 'border-[#3B6EF6]/60 bg-[#3B6EF6]/40 text-white'
                              : 'border-white/15 bg-white/5 text-white/90 hover:bg-white/15'
                          }`}
                          title={calloutMode ? 'Click the image to place a callout (Esc to cancel)' : 'Add a callout pin to the image'}
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                          <span className="hidden sm:inline">{calloutMode ? 'Placing…' : 'Add callout'}</span>
                          {rootCallouts.length > 0 && (
                            <span className="inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-semibold bg-white/20 rounded-full">
                              {rootCallouts.length}
                            </span>
                          )}
                        </button>
                      )}

                      {/* Trace — existing button, same handler / mutual-exclusion / gate / state */}
                      {!hideCallouts && calloutsEnabled && calloutsAccessible && canTrace && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setCalloutMode(false)
                            setComposer(null)
                            setTraceMode((m) => !m)
                          }}
                          className={`flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-medium border transition-colors ${
                            traceMode
                              ? 'border-[#3B6EF6]/60 bg-[#3B6EF6]/40 text-white'
                              : 'border-white/15 bg-white/5 text-white/90 hover:bg-white/15'
                          }`}
                          title={traceMode ? 'Stop tracing (Esc)' : 'Draw a trace over the board'}
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.232-6.232a2.5 2.5 0 113.536 3.536L12.536 16.5H9V13z" />
                          </svg>
                          <span className="hidden sm:inline">{traceMode ? 'Tracing…' : 'Trace'}</span>
                        </button>
                      )}

                      {/* Separator — only when a tool button is present */}
                      {!hideCallouts && calloutsEnabled && calloutsAccessible && (canComment || canTrace) && (
                        <span className="w-px h-5 bg-white/15 mx-0.5" />
                      )}

                      {/* Zoom out (steps the existing viewport hook) */}
                      <button
                        onClick={(e) => { e.stopPropagation(); stepZoom(-1) }}
                        disabled={atMinZoom}
                        className="w-8 h-8 flex items-center justify-center rounded-full text-white/90 hover:bg-white/15 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        title="Zoom out"
                        aria-label="Zoom out"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" />
                        </svg>
                      </button>

                      {/* Zoom % readout */}
                      <span className="w-11 text-center text-[11px] font-mono tabular-nums text-white/85 select-none">
                        {zoomPct}%
                      </span>

                      {/* Zoom in (steps the existing viewport hook) */}
                      <button
                        onClick={(e) => { e.stopPropagation(); stepZoom(1) }}
                        disabled={atMaxZoom}
                        className="w-8 h-8 flex items-center justify-center rounded-full text-white/90 hover:bg-white/15 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        title="Zoom in"
                        aria-label="Zoom in"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                        </svg>
                      </button>

                      {/* Fit — replaces the removed bottom-left Reset zoom button (viewport.reset) */}
                      <button
                        onClick={(e) => { e.stopPropagation(); resetViewport() }}
                        disabled={atMinZoom}
                        className="flex items-center h-8 px-3 rounded-full text-[11px] font-medium text-white/90 hover:bg-white/15 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        title="Fit to screen"
                        aria-label="Fit to screen"
                      >
                        Fit
                      </button>
                    </div>
                  </div>
                )}

                {/* ---- Anchored callout overlay (single-image, non-present) ----
                    Gated on calloutsAccessible so public/unauthenticated viewers
                    get no pins, capture layer, composer, or control strip.
                    Also gated on !hideCallouts so read-only view mode shows none of
                    the callout/trace overlay (pins, header, composer, trace canvas). */}
                {!isPresentMode && !hideCallouts && calloutsEnabled && calloutsAccessible && (
                  <>
                    {/* Trace canvas — renders every visible author's strokes.
                        While tracing it captures pointer events (suppressing pan
                        + double-click zoom) so the user can draw; otherwise it's
                        pass-through and sits beneath the pins. */}
                    <canvas
                      ref={traceCanvasRef}
                      className={`absolute inset-0 w-full h-full ${traceMode ? 'z-30 cursor-crosshair pointer-events-auto' : 'z-[5] pointer-events-none'}`}
                      onPointerDown={handleTracePointerDown}
                      onPointerMove={handleTracePointerMove}
                      onPointerUp={handleTracePointerUp}
                      onPointerCancel={handleTracePointerUp}
                      onDoubleClick={(e) => { if (traceMode) e.stopPropagation() }}
                    />

                    {/* Pins — pass-through layer except on the pins themselves.
                        Positions are re-derived from the viewport mapping every
                        render, so pins track zoom/pan; pin size is fixed px so
                        they don't scale with the image. */}
                    <div className="absolute inset-0 z-10 pointer-events-none">
                      {visibleRoots.map((root) => {
                        if (root.anchorX == null || root.anchorY == null) return null
                        const pt = viewport.imageFractionToContainerPoint(root.anchorX, root.anchorY)
                        if (!pt) return null
                        const n = calloutNumber.get(root.id)
                        const isActive = activeThreadRootId === root.id
                        return (
                          <button
                            key={root.id}
                            type="button"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => { e.stopPropagation(); setActiveThreadRootId(root.id) }}
                            className={`pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 w-7 h-7 rounded-full border-2 text-[11px] font-bold flex items-center justify-center shadow-md transition-transform hover:scale-110 ${
                              root.resolved
                                ? 'bg-slate-500/70 border-white/70 text-white/90 opacity-50'
                                : 'bg-[#3B6EF6] border-white text-white'
                            } ${isActive ? 'ring-2 ring-white scale-110' : ''}`}
                            style={{ left: `${pt.x}px`, top: `${pt.y}px` }}
                            title={root.resolved ? 'Resolved callout' : 'Open callout thread'}
                          >
                            {n}
                          </button>
                        )
                      })}
                    </div>

                    {/* Placement capture layer — intercepts the next click and
                        suppresses drag-to-pan / double-click zoom while active. */}
                    {calloutMode && (
                      <div
                        className="absolute inset-0 z-20 cursor-crosshair"
                        onClick={handleCalloutPlace}
                        onPointerDown={(e) => e.stopPropagation()}
                        onDoubleClick={(e) => e.stopPropagation()}
                      />
                    )}

                    {/* Inline composer anchored at the chosen point */}
                    {composer && (() => {
                      const pt = viewport.imageFractionToContainerPoint(composer.fx, composer.fy)
                      if (!pt) return null
                      return (
                        <div
                          className="absolute z-30 pointer-events-auto"
                          style={{ left: `${pt.x}px`, top: `${pt.y}px`, transform: 'translate(-50%, 12px)' }}
                          onClick={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                          onDoubleClick={(e) => e.stopPropagation()}
                        >
                          <div className="w-64 bg-white rounded-xl shadow-2xl border border-gray-200 p-3">
                            <textarea
                              value={composerText}
                              onChange={(e) => setComposerText(e.target.value)}
                              onKeyDown={(e) => {
                                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); handleSubmitCallout() }
                              }}
                              autoFocus
                              rows={3}
                              placeholder="Add a callout…"
                              disabled={composerPosting}
                              className="w-full px-2.5 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3B6EF6] resize-none bg-white text-gray-800 placeholder:text-gray-400"
                            />
                            <div className="flex items-center justify-end gap-2 mt-2">
                              <button
                                onClick={() => { setComposer(null); setComposerText('') }}
                                disabled={composerPosting}
                                className="px-2.5 py-1.5 text-[11px] font-semibold rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={handleSubmitCallout}
                                disabled={!composerText.trim() || composerPosting}
                                className="px-2.5 py-1.5 text-[11px] font-semibold rounded-md bg-[#3B6EF6] text-white hover:bg-[#2F5CD6] disabled:opacity-40"
                              >
                                {composerPosting ? 'Adding…' : 'Add callout'}
                              </button>
                            </div>
                          </div>
                        </div>
                      )
                    })()}

                    {/* Control strip — count + show-resolved filter + errors */}
                    {(rootCallouts.length > 0 || calloutError) && (
                      <div
                        className="absolute top-3 left-1/2 -translate-x-1/2 z-30 pointer-events-auto flex items-center gap-2"
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                      >
                        {rootCallouts.length > 0 && (
                          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900/70 backdrop-blur-md border border-white/15 text-white text-[11px] font-medium">
                            <span>{rootCallouts.length} callout{rootCallouts.length === 1 ? '' : 's'}</span>
                            <button
                              type="button"
                              onClick={() => setShowResolved((v) => !v)}
                              className="flex items-center gap-1.5 text-[11px] text-white/90 hover:text-white"
                              title="Toggle resolved callouts"
                            >
                              <span className={`w-3 h-3 rounded-sm border flex items-center justify-center text-[8px] leading-none ${showResolved ? 'bg-[#3B6EF6] border-[#3B6EF6] text-white' : 'border-white/40 text-transparent'}`}>✓</span>
                              Show resolved
                            </button>
                          </div>
                        )}
                        {calloutError && (
                          <div className="px-3 py-1.5 rounded-full bg-red-600/85 text-white text-[11px] font-medium">{calloutError}</div>
                        )}
                      </div>
                    )}

                    {/* Trace layers control — toggle each author's layer on/off */}
                    {(() => {
                      const layers: Array<{ key: string; name: string; color: string }> = []
                      const myKey = isGuest ? (guestTokenId ?? 'guest') : (user?.id ?? 'me')
                      if (myStrokes.length > 0) layers.push({ key: myKey, name: `${authorName} (you)`, color: traceColor })
                      for (const t of boardTraces) {
                        const isMine = isGuest
                          ? (t.guestTokenId != null && t.guestTokenId === guestTokenId)
                          : (!!user?.id && t.authorId === user.id)
                        if (isMine) continue
                        layers.push({ key: t.authorId ?? t.guestTokenId ?? t.id, name: t.authorName, color: t.authorColor ?? '#94a3b8' })
                      }
                      if (layers.length === 0) return null
                      return (
                        <div
                          className="absolute top-3 right-3 z-40 pointer-events-auto w-44 rounded-xl bg-slate-900/80 backdrop-blur-md border border-white/15 p-2"
                          onClick={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                        >
                          <div className="text-[10px] uppercase tracking-wide text-white/60 px-1 pb-1">Trace layers</div>
                          <div className="space-y-0.5 max-h-40 overflow-y-auto">
                            {layers.map((l) => {
                              const hidden = hiddenTraceAuthors.has(l.key)
                              return (
                                <button
                                  key={l.key}
                                  onClick={() => setHiddenTraceAuthors((prev) => {
                                    const n = new Set(prev)
                                    if (n.has(l.key)) n.delete(l.key); else n.add(l.key)
                                    return n
                                  })}
                                  className="w-full flex items-center gap-2 px-1.5 py-1 rounded hover:bg-white/10 text-left"
                                  title={hidden ? 'Show layer' : 'Hide layer'}
                                >
                                  <span className="w-3 h-3 rounded-full flex-shrink-0 border border-white/30" style={{ backgroundColor: l.color, opacity: hidden ? 0.25 : 1 }} />
                                  <span className={`text-[11px] truncate flex-1 ${hidden ? 'text-white/40 line-through' : 'text-white/90'}`}>{l.name}</span>
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })()}

                    {/* Trace tool strip — colors, widths, undo, clear.
                        Stacked directly ABOVE the tool dock (bottom-20) so the two
                        never overlap and neither collides with the ESC hint. */}
                    {traceMode && (
                      <div
                        className="absolute bottom-20 left-1/2 -translate-x-1/2 z-40 pointer-events-auto flex items-center gap-2 px-3 py-2 rounded-full bg-slate-900/85 backdrop-blur-md border border-white/15"
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                      >
                        {TRACE_COLORS.map((c) => (
                          <button
                            key={c}
                            onClick={() => setTraceColor(c)}
                            className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 ${traceColor === c ? 'border-white' : 'border-transparent'}`}
                            style={{ backgroundColor: c }}
                            title="Ink color"
                            aria-label={`Ink color ${c}`}
                          />
                        ))}
                        <span className="w-px h-5 bg-white/20" />
                        {TRACE_WIDTHS.map((w) => (
                          <button
                            key={w.value}
                            onClick={() => setTraceWidth(w.value)}
                            className={`px-2 py-1 rounded text-[10px] font-medium ${traceWidth === w.value ? 'bg-white/25 text-white' : 'text-white/70 hover:text-white'}`}
                            title={`${w.label} brush`}
                          >
                            {w.label}
                          </button>
                        ))}
                        <span className="w-px h-5 bg-white/20" />
                        <button
                          onClick={handleTraceUndo}
                          disabled={myStrokes.length === 0}
                          className="px-2 py-1 rounded text-[10px] font-medium text-white/80 hover:text-white disabled:opacity-40"
                          title="Undo last stroke"
                        >
                          Undo
                        </button>
                        {pendingClearTrace ? (
                          <button
                            onClick={handleTraceClear}
                            className="px-2 py-1 rounded text-[10px] font-semibold bg-red-600 text-white hover:bg-red-500"
                            title="Confirm — clear your whole trace"
                          >
                            Confirm clear
                          </button>
                        ) : (
                          <button
                            onClick={() => { setPendingClearTrace(true); window.setTimeout(() => setPendingClearTrace(false), 4000) }}
                            disabled={myStrokes.length === 0}
                            className="px-2 py-1 rounded text-[10px] font-medium text-white/80 hover:text-white disabled:opacity-40"
                            title="Clear my trace"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          ) : (
            <div className="text-center text-gray-500">
              <div className="text-6xl mb-4">🖼️</div>
              <p>No image available</p>
            </div>
          )}
        </div>

        {/* Right Side - Comment Panel (hidden in present mode; members only) */}
        {!isPresentMode && commentsOpen && commentsAccessible ? (
        <div 
          className="w-full lg:w-[340px] xl:w-[380px] bg-white/95 backdrop-blur-md flex flex-col shadow-[0_18px_60px_rgba(15,23,42,0.35)] border-l border-gray-200"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Panel Header */}
          <div className="flex-shrink-0 px-5 py-4 border-b border-gray-200/80">
            <h3 className="text-sm font-semibold text-gray-900 mb-1 flex items-center gap-2">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-indigo-50 text-indigo-500">
                <span className="text-xs">💬</span>
              </span>
              Comments
              {comments.length > 0 && (
                <span className="inline-flex items-center justify-center px-2 py-0.5 text-[11px] font-medium bg-indigo-50 text-indigo-600 rounded-full border border-indigo-100">
                  {comments.length}
                </span>
              )}
            </h3>
            <p className="text-xs text-gray-500">
              Share concise feedback to help the work grow.
            </p>
          </div>

          {/* Comments List */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {loading && (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-10 w-10 border-2 border-[#4444ff]/20 border-t-[#4444ff]"></div>
              </div>
            )}

            {error && (
              <div className="text-center py-12">
                <p className="text-red-600 text-sm">{error}</p>
              </div>
            )}

            {!loading && !error && comments.length === 0 && (
              <div className="text-center py-16">
                <div className="text-6xl mb-3">💭</div>
                <p className="text-gray-500 text-sm font-medium">No comments yet</p>
                <p className="text-gray-400 text-xs mt-1">Be the first to share feedback!</p>
              </div>
            )}

            {!loading && !error && comments.length > 0 && comments.map((comment) => (
              <div 
                key={comment.id}
                className="flex gap-3 p-3 rounded-xl bg-gray-50 border border-gray-100 hover:border-gray-200 hover:bg-white transition-colors"
              >
                {/* Avatar */}
                <div className={`flex-shrink-0 w-8 h-8 rounded-full ${getAvatarColor(comment.authorName)} flex items-center justify-center text-white font-bold text-xs shadow-sm`}>
                  {getInitials(comment.authorName)}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2 mb-1">
                    <span className="font-semibold text-gray-900 text-xs">
                      {comment.authorName}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-gray-500 whitespace-nowrap">
                        {formatTimestamp(comment.createdAt)}
                      </span>
                      {canManageComment(comment) && (
                        <>
                          <button
                            onClick={() => handleStartEdit(comment)}
                            disabled={deletingCommentId === comment.id || savingCommentId === comment.id}
                            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-indigo-600 hover:bg-indigo-50 hover:text-indigo-700 disabled:opacity-50"
                            aria-label="Edit comment"
                            title="Edit"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.232-6.232a2.5 2.5 0 113.536 3.536L12.536 16.5H9V13z" />
                            </svg>
                          </button>
                          {pendingDeleteCommentId === comment.id ? (
                            <button
                              onClick={() => handleDeleteComment(comment.id)}
                              disabled={deletingCommentId === comment.id || savingCommentId === comment.id}
                              className="inline-flex items-center justify-center rounded-md px-1.5 h-6 text-[10px] font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                              aria-label="Confirm delete comment"
                              title="Confirm delete"
                            >
                              {deletingCommentId === comment.id ? (
                                <div className="h-3.5 w-3.5 rounded-full border-2 border-red-200 border-t-white animate-spin" />
                              ) : (
                                'Confirm delete'
                              )}
                            </button>
                          ) : (
                            <button
                              onClick={() => handleDeleteComment(comment.id)}
                              disabled={deletingCommentId === comment.id || savingCommentId === comment.id}
                              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-red-600 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                              aria-label={deletingCommentId === comment.id ? 'Deleting comment' : 'Delete comment'}
                              title="Delete"
                            >
                              {deletingCommentId === comment.id ? (
                                <div className="h-3.5 w-3.5 rounded-full border-2 border-red-300 border-t-red-600 animate-spin" />
                              ) : (
                                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 7h12M9 7v12m6-12v12M10 4h4a1 1 0 011 1v2H9V5a1 1 0 011-1zM5 7h14l-1 13a2 2 0 01-2 2H8a2 2 0 01-2-2L5 7z" />
                                </svg>
                              )}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  {editingCommentId === comment.id ? (
                    <div className="space-y-2">
                      <textarea
                        value={editingContent}
                        onChange={(e) => setEditingContent(e.target.value)}
                        className="w-full px-2.5 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3B6EF6] focus:border-transparent resize-none bg-white text-gray-800"
                        rows={3}
                        disabled={savingCommentId === comment.id}
                      />
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleSaveEdit(comment.id)}
                          disabled={!editingContent.trim() || savingCommentId === comment.id}
                          className="px-2.5 py-1.5 bg-[#3B6EF6] text-white rounded-md hover:bg-[#2F5CD6] disabled:opacity-40 text-[11px] font-semibold"
                        >
                          {savingCommentId === comment.id ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          onClick={handleCancelEdit}
                          disabled={savingCommentId === comment.id}
                          className="px-2.5 py-1.5 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 text-[11px] font-semibold"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-800 leading-relaxed whitespace-pre-wrap">
                      {comment.content}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Add Comment Form */}
          <div className="flex-shrink-0 border-t border-gray-200 px-4 py-4 bg-gray-50">
            {user ? (
              <div className="space-y-3">
                <textarea
                  ref={textareaRef}
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Share your thoughts..."
                  className="w-full px-3 py-2.5 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3B6EF6] focus:border-transparent resize-none bg-white text-gray-800 placeholder:text-gray-400 shadow-sm"
                  rows={3}
                  disabled={posting}
                />
                <div className="flex items-center justify-between">
                  <p className="text-[11px] text-gray-500">
                    {newComment.length > 0 ? (
                      <span className="text-gray-700 font-medium">{newComment.length} characters</span>
                    ) : (
                      'Cmd+Enter to post'
                    )}
                  </p>
                  <button
                    onClick={handlePost}
                    disabled={!newComment.trim() || posting}
                    className="px-4 py-2 bg-[#3B6EF6] text-white rounded-lg hover:bg-[#2F5CD6] disabled:opacity-40 disabled:cursor-not-allowed transition-all text-xs font-semibold shadow-sm hover:shadow-md disabled:shadow-none"
                  >
                    {posting ? (
                      <span className="flex items-center gap-2">
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                        Posting...
                      </span>
                    ) : (
                      'Post Comment'
                    )}
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-center py-5">
                <div className="mb-3 text-3xl">🔒</div>
                <p className="text-xs text-gray-600 mb-3">Sign in to leave feedback</p>
                <a
                  href="/sign-in"
                  className="inline-block px-5 py-2 bg-[#3B6EF6] text-white rounded-lg hover:bg-[#2F5CD6] transition-all text-xs font-semibold shadow-md hover:shadow-lg"
                >
                  Sign In to Comment
                </a>
              </div>
            )}
          </div>
        </div>
        ) : null}
      </div>

      {/* ---- Callout thread panel (separate from the legacy comment panel) ---- */}
      {!isPresentMode && activeRoot && (
        <div
          className="fixed top-24 right-4 z-40 w-[320px] max-h-[70vh] bg-white rounded-2xl shadow-[0_18px_60px_rgba(15,23,42,0.45)] border border-gray-200 flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex-shrink-0 px-4 py-3 border-b border-gray-200 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-[#3B6EF6] text-white text-[11px] font-bold">
                {calloutNumber.get(activeRoot.id)}
              </span>
              <h3 className="text-sm font-semibold text-gray-900 truncate">
                Callout{activeRoot.resolved ? ' · Resolved' : ''}
              </h3>
            </div>
            <div className="flex items-center gap-1.5">
              {(isCalloutAuthor(activeRoot) || isInstructor) && (
                <button
                  onClick={() => handleToggleResolved(activeRoot.id, !activeRoot.resolved)}
                  className={`px-2 py-1 text-[11px] font-semibold rounded-md border transition-colors ${
                    activeRoot.resolved
                      ? 'border-gray-300 text-gray-600 hover:bg-gray-100'
                      : 'border-[#3B6EF6]/40 text-[#3B6EF6] hover:bg-[#3B6EF6]/10'
                  }`}
                  title={activeRoot.resolved ? 'Reopen this callout' : 'Mark resolved'}
                >
                  {activeRoot.resolved ? 'Reopen' : 'Resolve'}
                </button>
              )}
              <button
                onClick={() => setActiveThreadRootId(null)}
                className="w-7 h-7 flex items-center justify-center rounded-md text-gray-500 hover:bg-gray-100"
                aria-label="Close thread"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Root + replies, chronological */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5">
            {[activeRoot, ...repliesFor(activeRoot.id)].map((c) => {
              const isRoot = c.parentId == null
              const canEdit = isCalloutAuthor(c)
              const canDelete = isCalloutAuthor(c) || isInstructor
              const editing = editingCalloutId === c.id
              return (
                <div
                  key={c.id}
                  className={`rounded-xl border p-2.5 ${isRoot ? 'bg-[#3B6EF6]/[0.06] border-[#3B6EF6]/15' : 'bg-gray-50 border-gray-100 ml-3'}`}
                >
                  <div className="flex items-baseline justify-between gap-2 mb-1">
                    <span className="text-[11px] font-semibold text-gray-900 truncate">{c.authorName}</span>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <span className="text-[10px] text-gray-500 whitespace-nowrap">{formatTimestamp(c.createdAt)}</span>
                      {canEdit && !editing && (
                        <button
                          onClick={() => { setEditingCalloutId(c.id); setEditingCalloutText(c.body) }}
                          className="text-[10px] text-indigo-600 hover:text-indigo-800"
                          title="Edit"
                        >
                          Edit
                        </button>
                      )}
                      {canDelete && (
                        <button
                          onClick={() => handleDeleteCallout(c.id)}
                          disabled={deletingCalloutId === c.id}
                          className="text-[10px] text-red-600 hover:text-red-800 disabled:opacity-50"
                          title={isRoot ? 'Delete callout (and replies)' : 'Delete reply'}
                        >
                          {deletingCalloutId === c.id ? '…' : 'Delete'}
                        </button>
                      )}
                    </div>
                  </div>
                  {editing ? (
                    <div className="space-y-1.5">
                      <textarea
                        value={editingCalloutText}
                        onChange={(e) => setEditingCalloutText(e.target.value)}
                        rows={2}
                        disabled={savingCalloutId === c.id}
                        className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-400 resize-none bg-white text-gray-800"
                      />
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleEditCallout(c.id)}
                          disabled={!editingCalloutText.trim() || savingCalloutId === c.id}
                          className="px-2 py-1 text-[10px] font-semibold rounded-md bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40"
                        >
                          {savingCalloutId === c.id ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          onClick={() => { setEditingCalloutId(null); setEditingCalloutText('') }}
                          disabled={savingCalloutId === c.id}
                          className="px-2 py-1 text-[10px] font-semibold rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-800 leading-relaxed whitespace-pre-wrap">{c.body}</p>
                  )}
                </div>
              )
            })}
          </div>

          {/* Reply composer */}
          <div className="flex-shrink-0 border-t border-gray-200 px-3 py-2.5 bg-gray-50">
            {canComment ? (
              <div className="space-y-2">
                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); handleSubmitReply(activeRoot.id) }
                  }}
                  rows={2}
                  placeholder="Reply…"
                  disabled={replyPosting}
                  className="w-full px-2.5 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3B6EF6] resize-none bg-white text-gray-800 placeholder:text-gray-400"
                />
                <div className="flex justify-end">
                  <button
                    onClick={() => handleSubmitReply(activeRoot.id)}
                    disabled={!replyText.trim() || replyPosting}
                    className="px-3 py-1.5 text-[11px] font-semibold rounded-md bg-[#3B6EF6] text-white hover:bg-[#2F5CD6] disabled:opacity-40"
                  >
                    {replyPosting ? 'Replying…' : 'Reply'}
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-gray-500 text-center py-1">Sign in to reply</p>
            )}
          </div>
        </div>
      )}

      {/* Navigation Hint (simplified in present mode). Fades out ~5s after open
          (CSS animation, forwards); re-shows on board change / present toggle via
          the remount key. Sits at bottom-3 so it clears the tool dock. The ESC
          key handling itself is untouched. */}
      <style>{`@keyframes lbHintFade { to { opacity: 0; visibility: hidden; } }`}</style>
      <div
        key={`${board.id}-${isPresentMode}`}
        className="absolute bottom-3 left-1/2 transform -translate-x-1/2 px-4 py-2 bg-slate-900/65 border border-white/10 backdrop-blur-md rounded-full text-white text-xs sm:text-sm pointer-events-none"
        style={{ animation: 'lbHintFade 600ms ease 5s forwards' }}
      >
        {isPresentMode ? (
          <>
            Press <kbd className="px-2 py-0.5 bg-white/20 rounded mx-1">ESC</kbd> to exit present
            {!isComparePresentMode && (hasPrev || hasNext) && (
              <>
                <span className="mx-2">•</span>
                <kbd className="px-2 py-0.5 bg-white/20 rounded mx-1">←</kbd>
                <kbd className="px-2 py-0.5 bg-white/20 rounded mx-1">→</kbd>
                to change board
              </>
            )}
          </>
        ) : (
          <>
            Press <kbd className="px-2 py-0.5 bg-white/20 rounded mx-1">ESC</kbd> to close
            {(hasPrev || hasNext) && (
              <>
                <span className="mx-2">•</span>
                <kbd className="px-2 py-0.5 bg-white/20 rounded mx-1">←</kbd>
                <kbd className="px-2 py-0.5 bg-white/20 rounded mx-1">→</kbd>
                to navigate
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

