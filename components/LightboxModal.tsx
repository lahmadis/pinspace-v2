'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import { Comment, Board, BoardComment, BoardTrace, TraceStroke } from '@/types'
import { validateLinkUrl } from '@/lib/linkUrl'
import { useImageViewport } from '@/components/useImageViewport'
import { toast } from '@/lib/toast'
import { ExternalLink } from 'lucide-react'

// Trace ink palette + brush widths (width = fraction of image width).
const TRACE_COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6']
const TRACE_WIDTHS: Array<{ label: string; value: number }> = [
  { label: 'Thin', value: 0.004 },
  { label: 'Thick', value: 0.01 },
]
import type { Session, AuthChangeEvent, User } from '@supabase/supabase-js'

// TEMP diagnostic — always-on tracing of the lightbox link read/write path.
const postrace = (...args: unknown[]) => {
  // eslint-disable-next-line no-console
  console.log('[POSTRACE]', new Date().toISOString(), ...args)
}

interface LightboxModalProps {
  board: Board | null
  allBoards: Board[] // For navigation
  compareBoards?: Board[]
  autoEnterPresentCompare?: boolean
  onClose: () => void
  onNavigate: (direction: 'prev' | 'next') => void
  /** True when rendered on the edit-mode studio page; enables inline author name editing. */
  isEditMode?: boolean
  /** Role of the currently authenticated user in this workspace. Instructor sees email. */
  currentUserRole?: 'instructor' | 'student' | null
  /**
   * Called after a video link save persists (PUT ok). The parent uses it to
   * write the new linkUrl into its local boards cache (and the open-lightbox
   * snapshot) so reopening the lightbox shows the link without a refresh —
   * the PUT alone only updates the server, not the local board the lightbox
   * re-reads on open. null = link cleared.
   */
  onLinkSaved?: (boardId: string, linkUrl: string | null) => void
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

function getInitials(name: string): string {
  return name
    .split(' ')
    .map(word => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

function getAvatarColor(name: string): string {
  const colors = [
    'bg-purple-500',
    'bg-blue-500',
    'bg-green-500',
    'bg-yellow-500',
    'bg-pink-500',
    'bg-indigo-500',
    'bg-red-500',
    'bg-teal-500',
  ]
  const hash = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
  return colors[hash % colors.length]
}

export default function LightboxModal({ board, allBoards, compareBoards = [], autoEnterPresentCompare = false, onClose, onNavigate, isEditMode = false, currentUserRole = null, onLinkSaved, guestToken = null, guestName = null, guestTokenId = null, guestCanComment = false, guestCanTrace = false, liveChannelRef, isPresenter = false, viewportDriven = false, viewportTargetRef, lbCursorRef, cursorColor = '#22d3ee' }: LightboxModalProps) {
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

  // Single-image zoom/pan + image-rect measurement (Phase A.2). Only the
  // single-image branch below consumes it; PDF/compare are untouched.
  const viewport = useImageViewport()
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
  useEffect(() => { traceModeRef.current = traceMode }, [traceMode])
  // Clear any pending debounced save on unmount.
  useEffect(() => () => { if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current) }, [])

  const isOpen = board !== null
  const [profileFullName, setProfileFullName] = useState<string | null>(null)
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
      return
    }
    fetch('/api/user-profile', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const fullName = typeof data?.full_name === 'string' ? data.full_name.trim() : ''
        setProfileFullName(fullName || null)
      })
      .catch(() => setProfileFullName(null))
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
    // [POSTRACE] board the lightbox renders on (re)open — linkOverride is reset
    // here, so what shows is board.linkUrl unless re-saved this session.
    if (board) postrace('lightbox BOARD MOUNT/CHANGE', board.id, `board.linkUrl=${JSON.stringify(board.linkUrl)} (linkOverride reset to null)`)
    // Reset zoom/pan whenever the board changes (covers arrow-key navigation).
    resetViewport()
    setEditingAuthorName(false)
    setAuthorNameInput('')
    setDisplayedAuthorName(null)
    setLinkOverride(null)
    setEditingLink(false)
    setLinkInput('')
    setLinkError(null)
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
    postrace('handleSaveLink', board.id, `input=${JSON.stringify(linkInput)} validated=${JSON.stringify(value)} validationError=${JSON.stringify(error)}`)
    if (error) {
      setLinkError(error)
      return
    }
    const current = linkOverride ? linkOverride.value : board.linkUrl ?? null
    if (value === current) {
      postrace('handleSaveLink NO-OP (value === current)', board.id, `value=${JSON.stringify(value)}`)
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
      postrace('handleSaveLink PUT RESPONSE', board.id, `status=${res.status} ok=${res.ok}`)
      if (res.ok) {
        setLinkOverride({ value })
        setEditingLink(false)
        // Push the persisted value up so the parent's boards cache (and the
        // open-lightbox snapshot) stay current — otherwise reopening the
        // lightbox re-reads a stale board and the link disappears until refresh.
        postrace('handleSaveLink CALLING onLinkSaved', board.id, `value=${JSON.stringify(value)} hasCallback=${!!onLinkSaved}`)
        onLinkSaved?.(board.id, value)
      } else {
        const data = await res.json().catch(() => ({}))
        postrace('handleSaveLink PUT FAILED', board.id, `status=${res.status} error=${JSON.stringify(data?.error)}`)
        setLinkError(data?.error || 'Failed to save link.')
      }
    } catch (e) {
      postrace('handleSaveLink PUT THREW', board.id, String(e))
      setLinkError('Failed to save link.')
    } finally {
      linkSaveInFlightRef.current = false
      setSavingLink(false)
    }
  }, [board, linkInput, linkOverride, onLinkSaved])

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

  const handleTracePointerDown = (e: React.PointerEvent) => {
    if (!traceMode) return
    e.stopPropagation()
    const canvas = traceCanvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const frac = viewport.containerPointToImageFraction(e.clientX - rect.left, e.clientY - rect.top)
    if (!frac) return
    try { (e.target as Element).setPointerCapture(e.pointerId) } catch { /* noop */ }
    setDrawingPoints([[clamp01(frac.x), clamp01(frac.y)]])
  }

  const handleTracePointerMove = (e: React.PointerEvent) => {
    if (!traceMode || !drawingPoints) return
    const canvas = traceCanvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const frac = viewport.containerPointToImageFraction(e.clientX - rect.left, e.clientY - rect.top)
    if (!frac) return
    setDrawingPoints((prev) => (prev ? [...prev, [clamp01(frac.x), clamp01(frac.y)]] : prev))
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
  }, [mapFracToPt, boardTraces, myStrokes, drawingPoints, hiddenTraceAuthors, traceColor, traceWidth, user?.id, isGuest, guestTokenId])

  // Redraw on stroke/layer changes AND on every zoom/pan transform change.
  useEffect(() => {
    redrawTraces()
  }, [redrawTraces, viewport.scale, viewport.offsetX, viewport.offsetY])

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

  return (
    <div 
      className={`fixed inset-0 bg-slate-950/85 z-50 transition-opacity duration-300 ${
        isVisible ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={handleBackdropClick}
    >
      {/* Top Header Bar (hidden in present mode) */}
      {!isPresentMode && (
      <div className="absolute top-3 left-3 right-3 h-16 rounded-2xl bg-slate-900/75 backdrop-blur-xl border border-slate-700/70 shadow-[0_10px_30px_rgba(2,6,23,0.45)] flex items-center justify-between px-4 sm:px-5 z-20">
        {/* Board Title */}
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-[0.16em] text-slate-300/70 mb-0.5">
            Uploaded Board
          </p>
          <h2 className="text-slate-50 font-semibold text-sm sm:text-[15px] truncate">
            {compareBoards.length > 1 ? `Compare selection (${compareBoards.length})` : board.title}
          </h2>
          {(() => {
            const resolvedName = displayedAuthorName ?? board.studentName ?? 'Unknown'
            const showEmail = isEditMode && currentUserRole === 'instructor' && board.studentEmail

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
              <p
                className={`text-[11px] text-slate-300/90 truncate mt-0.5 flex items-center gap-1 ${isEditMode ? 'group/author cursor-pointer hover:text-white' : ''}`}
                onClick={isEditMode ? () => {
                  setAuthorNameInput(resolvedName === 'Unknown' ? '' : resolvedName)
                  setEditingAuthorName(true)
                } : undefined}
              >
                <span>Author: {resolvedName}</span>
                {isEditMode && (
                  <svg className="w-3 h-3 opacity-0 group-hover/author:opacity-60 transition-opacity flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.232-6.232a2.5 2.5 0 113.536 3.536L12.536 16.5H9V13z" />
                  </svg>
                )}
                {showEmail && (
                  <span className="text-slate-400 ml-0.5">· {board.studentEmail}</span>
                )}
              </p>
            )
          })()}
          {/* Link editor (edit mode only) */}
          {isEditMode && (
            <div className="mt-0.5" onClick={(e) => e.stopPropagation()}>
              {editingLink ? (
                <div className="flex flex-col gap-1">
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
              ) : (
                <button
                  onClick={() => { setLinkInput(resolvedLinkUrl ?? ''); setEditingLink(true); setLinkError(null) }}
                  className="text-[11px] text-slate-300/90 hover:text-white inline-flex items-center gap-1"
                >
                  <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 010 5.656l-3 3a4 4 0 01-5.656-5.656l1.5-1.5M10.172 13.828a4 4 0 010-5.656l3-3a4 4 0 015.656 5.656l-1.5 1.5" />
                  </svg>
                  <span>{resolvedLinkUrl ? 'Edit link' : 'Add link'}</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Navigation + Close */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Open link — visible to everyone when a link is attached */}
          {resolvedLinkUrl && (
            <button
              onClick={(e) => { e.stopPropagation(); openVideo() }}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border border-white/20 bg-white/5 text-white/90 hover:bg-white/15 transition-colors"
              title="Open link in a new tab"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Open link</span>
            </button>
          )}
          {/* Previous */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              onNavigate('prev')
            }}
            disabled={!hasPrev}
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border border-white/20 bg-white/5 text-white/90 hover:bg-white/15 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
              <path d="M15 19l-7-7 7-7"></path>
            </svg>
            <span>Previous</span>
          </button>

          {/* Next */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              onNavigate('next')
            }}
            disabled={!hasNext}
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border border-white/20 bg-white/5 text-white/90 hover:bg-white/15 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <span>Next</span>
            <svg className="w-3.5 h-3.5" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
              <path d="M9 5l7 7-7 7"></path>
            </svg>
          </button>

          {/* Compact arrow-only buttons on small screens */}
          <div className="flex sm:hidden items-center gap-1.5">
            <button
              onClick={(e) => {
                e.stopPropagation()
                onNavigate('prev')
              }}
              disabled={!hasPrev}
              className="w-8 h-8 flex items-center justify-center rounded-full border border-white/20 bg-white/5 text-white/90 hover:bg-white/15 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              aria-label="Previous"
            >
              <svg className="w-3.5 h-3.5" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
                <path d="M15 19l-7-7 7-7"></path>
              </svg>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onNavigate('next')
              }}
              disabled={!hasNext}
              className="w-8 h-8 flex items-center justify-center rounded-full border border-white/20 bg-white/5 text-white/90 hover:bg-white/15 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              aria-label="Next"
            >
              <svg className="w-3.5 h-3.5" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
                <path d="M9 5l7 7-7 7"></path>
              </svg>
            </button>
          </div>

          {/* Present - full screen board only */}
          {compareBoards.length <= 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                setIsPresentMode(true)
              }}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border border-white/20 bg-white/5 text-white/90 hover:bg-white/15 transition-colors"
              title="Present (board fills screen)"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2">
                <path d="M4 8V6a2 2 0 012-2h2M4 16v2a2 2 0 002 2h2M20 8V6a2 2 0 00-2-2h-2M20 16v2a2 2 0 002 2h-2M14 6v12" />
              </svg>
              <span>Present</span>
            </button>
          )}

          {/* Add Callout toggle — enters placement mode for an anchored pin.
              Hidden unless the viewer has comment access (member or guest critic). */}
          {calloutsEnabled && calloutsAccessible && canComment && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                setComposer(null)
                setTraceMode(false)
                setCalloutMode((m) => !m)
              }}
              className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                calloutMode
                  ? 'border-pink-300 bg-pink-500/30 text-white'
                  : 'border-white/20 bg-white/5 text-white/90 hover:bg-white/15'
              }`}
              title={calloutMode ? 'Click the image to place a callout (Esc to cancel)' : 'Add a callout pin to the image'}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              <span>{calloutMode ? 'Placing…' : 'Add callout'}</span>
              {rootCallouts.length > 0 && (
                <span className="inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-semibold bg-white/20 rounded-full">
                  {rootCallouts.length}
                </span>
              )}
            </button>
          )}

          {/* Trace toggle — freehand drawing over the board (member or guest critic) */}
          {calloutsEnabled && calloutsAccessible && canTrace && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                setCalloutMode(false)
                setComposer(null)
                setTraceMode((m) => !m)
              }}
              className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                traceMode
                  ? 'border-amber-300 bg-amber-500/30 text-white'
                  : 'border-white/20 bg-white/5 text-white/90 hover:bg-white/15'
              }`}
              title={traceMode ? 'Stop tracing (Esc)' : 'Draw a trace over the board'}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.232-6.232a2.5 2.5 0 113.536 3.536L12.536 16.5H9V13z" />
              </svg>
              <span>{traceMode ? 'Tracing…' : 'Trace'}</span>
            </button>
          )}

          {/* Comments Toggle — hidden unless the viewer has comment access
              (workspace member); private to members per Phase A.3.2. */}
          {commentsAccessible && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              setCommentsOpen(prev => !prev)
            }}
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border border-white/20 bg-white/5 text-white/90 hover:bg-white/15 transition-colors"
            title="Toggle comments panel"
          >
            <span>Comments</span>
            {comments.length > 0 && (
              <span className="inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-semibold bg-white/20 rounded-full">
                {comments.length}
              </span>
            )}
          </button>
          )}

          {/* Close Button */}
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
                {viewport.isZoomed && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); viewport.reset() }}
                    className="absolute bottom-4 left-4 z-30 px-3 py-1.5 rounded-lg text-xs font-medium text-white/90 hover:text-white bg-black/50 hover:bg-black/70 border border-white/20 backdrop-blur-sm transition-colors flex items-center gap-1.5"
                    title="Reset zoom"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 9L4 4m0 0v4m0-4h4M15 9l5-5m0 0v4m0-4h-4M9 15l-5 5m0 0v-4m0 4h4m6-4l5 5m0 0v-4m0 4h-4" />
                    </svg>
                    Reset zoom
                  </button>
                )}

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

                {/* ---- Anchored callout overlay (single-image, non-present) ----
                    Gated on calloutsAccessible so public/unauthenticated viewers
                    get no pins, capture layer, composer, or control strip. */}
                {!isPresentMode && calloutsEnabled && calloutsAccessible && (
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
                                : 'bg-pink-500 border-white text-white'
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
                              className="w-full px-2.5 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-400 resize-none bg-white text-gray-800 placeholder:text-gray-400"
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
                                className="px-2.5 py-1.5 text-[11px] font-semibold rounded-md bg-pink-600 text-white hover:bg-pink-500 disabled:opacity-40"
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
                              <span className={`w-3 h-3 rounded-sm border flex items-center justify-center text-[8px] leading-none ${showResolved ? 'bg-pink-500 border-pink-500 text-white' : 'border-white/40 text-transparent'}`}>✓</span>
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

                    {/* Trace tool strip — colors, widths, undo, clear */}
                    {traceMode && (
                      <div
                        className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 pointer-events-auto flex items-center gap-2 px-3 py-2 rounded-full bg-slate-900/85 backdrop-blur-md border border-white/15"
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
                        className="w-full px-2.5 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#6366f1] focus:border-transparent resize-none bg-white text-gray-800"
                        rows={3}
                        disabled={savingCommentId === comment.id}
                      />
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleSaveEdit(comment.id)}
                          disabled={!editingContent.trim() || savingCommentId === comment.id}
                          className="px-2.5 py-1.5 bg-[#4f46e5] text-white rounded-md hover:bg-[#4338ca] disabled:opacity-40 text-[11px] font-semibold"
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
                  className="w-full px-3 py-2.5 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#6366f1] focus:border-transparent resize-none bg-white text-gray-800 placeholder:text-gray-400 shadow-sm"
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
                    className="px-4 py-2 bg-[#4f46e5] text-white rounded-lg hover:bg-[#4338ca] disabled:opacity-40 disabled:cursor-not-allowed transition-all text-xs font-semibold shadow-sm hover:shadow-md disabled:shadow-none"
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
                  className="inline-block px-5 py-2 bg-[#4f46e5] text-white rounded-lg hover:bg-[#4338ca] transition-all text-xs font-semibold shadow-md hover:shadow-lg"
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
              <span className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-pink-500 text-white text-[11px] font-bold">
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
                      : 'border-green-300 text-green-700 hover:bg-green-50'
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
                  className={`rounded-xl border p-2.5 ${isRoot ? 'bg-pink-50/60 border-pink-100' : 'bg-gray-50 border-gray-100 ml-3'}`}
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
                  className="w-full px-2.5 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-400 resize-none bg-white text-gray-800 placeholder:text-gray-400"
                />
                <div className="flex justify-end">
                  <button
                    onClick={() => handleSubmitReply(activeRoot.id)}
                    disabled={!replyText.trim() || replyPosting}
                    className="px-3 py-1.5 text-[11px] font-semibold rounded-md bg-pink-600 text-white hover:bg-pink-500 disabled:opacity-40"
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

      {/* Navigation Hint (simplified in present mode) */}
      <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 px-4 py-2 bg-slate-900/65 border border-white/10 backdrop-blur-md rounded-full text-white text-xs sm:text-sm">
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

