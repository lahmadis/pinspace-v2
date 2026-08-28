'use client'

import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useState, useEffect, useRef, useCallback, useMemo, Suspense } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { Figtree } from 'next/font/google'
import { Board } from '@/types'
import ShareModal from '@/components/ShareModal'
import { ROOM_SKY } from '@/lib/room/palette'
import DemoBanner from '@/components/DemoBanner'
import PresenceBar, { type PresentUser, friendlyName, colorFor } from '@/components/3d/PresenceBar'
import type { FollowPose, LaserState, LbViewport, LbCursorState, CritDirtySignal, TraceStreamEntry } from '@/components/3d/CameraController'
import { ArrowLeft, Share2, ChevronDown, Presentation } from 'lucide-react'
import { supabase, isSupabaseConfigured } from '@/lib/supabase/client'
import { toast } from '@/lib/toast'
import { DEFAULT_WALL_CONFIG, type WallConfig } from '@/lib/wallLayout'
import type { RoomView } from '@/components/room/RevisionStrip'
import { useWallConfigWriter } from '@/lib/wallConfigWriter'

type RealtimeBoardPayload = {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE'
  new: Record<string, unknown>
  old: Record<string, unknown>
}

// Room chrome type ramp. Figtree carries ALL of it. The breadcrumb pill used to
// be JetBrains Mono on the theory that a workspace/room path is drawing-sheet
// metadata like a wall label — but it sits in the same row of pills as Share and
// Presentation, and a mono pill beside two Figtree pills just reads as the one
// that got the wrong font. Wall labels on the plan are still mono; those are
// drawn ON a sheet, which is where that voice belongs.
const figtree = Figtree({ subsets: ['latin'], weight: ['400', '500', '600', '700'], display: 'swap' })

/**
 * Room chrome palette — the app's one blue accent (matches lib/room/palette.ts's
 * ROOM.accent and components/3d/WallSystem.tsx's ROOM_PALETTE.accent), not a
 * separate black-chrome-plus-one-off-green scheme. Previously `ink` (near-black)
 * filled the logo/breadcrumb/menu buttons and `green` was Share's own distinct
 * color — reported as "black buttons" and "green Share button" reading as
 * off-system once the room itself moved to blue/paper.
 */
const CHROME = {
  accent: '#3B6EF6',
  paper: '#FBFCFE',
  hairline: '#B9C4D6',
} as const

const StudioRoom = dynamic(
  () => import(/* webpackChunkName: "StudioRoom" */ '@/components/3d/StudioRoom'),
  {
    ssr: false,
    loading: () => (
    <div className="w-full h-screen flex items-center justify-center" style={{ background: CHROME.accent }}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-white/20 border-t-white mx-auto mb-4"></div>
          <p className="text-white/90 font-medium">Loading space...</p>
        </div>
    </div>
  ),
})

const DEFAULT_CONFIG = DEFAULT_WALL_CONFIG

function StudioPageInner() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const studioId = params.id as string
  
  const [boards, setBoards] = useState<Board[]>([])
  const [showShareModal, setShowShareModal] = useState(false)
  /**
   * Lifted out of StudioRoom so the Presentation button beside Share can drive
   * it. The
   * bottom strip still owns Space/2D/Plan and writes back through the
   * same setter, so the two controls can never disagree about which view is up.
   */
  const [roomView, setRoomView] = useState<RoomView>('room')
  const [wallConfig, setWallConfig] = useState<WallConfig | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [boardsError, setBoardsError] = useState(false)
  const [retryCount, setRetryCount] = useState(0)
  const [isEditMode, setIsEditMode] = useState(false)
  const [floorEditorOpen, setFloorEditorOpen] = useState(false)
  const [floorEditorMode, setFloorEditorMode] = useState<'tables' | 'walls'>('tables')
  const [isArchived, setIsArchived] = useState(false)
  const [commentNonce, setCommentNonce] = useState(0)
  // Phase 6.2: URL `[id]` is now a room id (Phase 6.1b URL flip is folded into
  // 6.2). Backward compat: if `[id]` is actually a workspace id (old shared
  // links), the API resolves the workspace's first room and we router.replace.
  // Track both ids: roomId scopes the boards filter / realtime; workspaceId
  // scopes wall-config + workspace metadata + membership checks.
  const [roomId, setRoomId] = useState<string | null>(null)
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [workspaceName, setWorkspaceName] = useState<string | null>(null)
  // Room-level wall color (migration 031), surfaced by /api/boards. Drives the
  // 3D wall material; defaults to 'grey' (the current look).
  const [wallColor, setWallColor] = useState<'grey' | 'white'>('white')
  const [currentRoomName, setCurrentRoomName] = useState<string | null>(null)
  const [allRooms, setAllRooms] = useState<Array<{ id: string; name: string }>>([])
  const [showRoomSwitcher, setShowRoomSwitcher] = useState(false)
  const [currentUserRole, setCurrentUserRole] = useState<'instructor' | 'student' | null>(null)
  /**
   * May this user write the wall-config blob (walls, tables, wall text)?
   *
   * OWNER, platform SUPERADMIN, or ANY workspace member (any role). Widened from
   * owner-only: a room's layout is now collaboratively editable. This is only
   * safe because the writer attributes 409s by `lastWriterId`
   * (lib/wallConfigWriter.ts) — a second editor gets a real conflict toast rather
   * than being silently rebased over. The two decisions move together; do not
   * widen one without the other.
   *
   * Wall DELETE is NOT gated by this flag — it is narrower (see canDeleteWalls),
   * because deleting a wall also deletes the boards pinned to it.
   *
   * Starts false and is only raised once permission is known. That direction is
   * deliberate: the workspace metadata fetch below is best-effort, and if it
   * fails we cannot tell an editor from a viewer. So the wall-editing affordances
   * are gated on this same flag — unresolved permission means no editor opens,
   * and there are no edits to lose.
   */
  const [canEditWalls, setCanEditWalls] = useState(false)
  /**
   * May this user set a board's slideshow position from the lightbox counter?
   * Owner or platform superadmin — the exact rule /api/boards/reorder enforces.
   * Fail-closed like the wall predicates: a host that hasn't resolved ownership
   * shows no affordance.
   */
  const [canReorderBoards, setCanReorderBoards] = useState(false)
  // Ref mirror so the persist/flush callbacks can read permission without taking
  // it as a dep — their identity feeds the unmount-flush effect below, and
  // rebuilding that on a permission change would tear down an armed autosave.
  const canEditWallsRef = useRef(false)
  useEffect(() => {
    canEditWallsRef.current = canEditWalls
  }, [canEditWalls])
  /**
   * May this user DELETE a wall? Narrower than canEditWalls: OWNER, platform
   * SUPERADMIN, or an INSTRUCTOR. A student member may add/move walls but not
   * delete one — a wall delete also permanently deletes every board pinned to
   * that wall, so it is kept to teaching staff. Gates the delete path in
   * StudioRoom (handlePersistWallConfig) and hides the Remove-wall control in the
   * floor editor. Same fail-closed default as canEditWalls.
   */
  const [canDeleteWalls, setCanDeleteWalls] = useState(false)
  // Tier 1 presence: other members currently in this room (self excluded in the bar).
  const [presentUsers, setPresentUsers] = useState<PresentUser[]>([])
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  // Wall the local user is editing (0-based) or null. Broadcast via presence so
  // others' walls can be highlighted. Ref mirror so the presence subscribe/track
  // callbacks read the latest value without re-subscribing.
  const [currentWallIndex, setCurrentWallIndex] = useState<number | null>(null)
  const currentWallIndexRef = useRef<number | null>(null)
  currentWallIndexRef.current = currentWallIndex
  // Presence channel + identity, hoisted so the re-track effect can update the
  // user's wall meta without tearing down and re-subscribing the channel.
  // Debounce timer for realtime-driven board refetch. A realtime boards
  // INSERT/UPDATE coalesces into one GET on this timer (see the boards channel
  // below); cleared on that effect's cleanup.
  const boardsRefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Phase B.5.2: monotonic id for board refetches. Only the latest-issued fetch
  // may commit to state — discards out-of-order resolutions (e.g. the first
  // upload's pre-PUT center snapshot landing after the committed-placement read).
  const boardsFetchSeqRef = useRef(0)
  const presenceChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  // isPresenting lives here (not in React state) so the wall-change re-track
  // effect preserves it via `...meta` instead of wiping it. Phase B.1.
  const presenceMetaRef = useRef<{ userId: string; fullName: string; isPresenting: boolean } | null>(null)
  const presenceSubscribedRef = useRef(false)
  // Phase B.2: follow-presenter camera sync over an ephemeral broadcast channel.
  // liveChannelRef holds the studio-live:${roomId} channel; followPoseRef holds
  // ONLY the latest received pose (written per broadcast message — never via
  // setState; CameraController reads the ref in its frame loop). isFollowing is
  // low-frequency UI state.
  const liveChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const followPoseRef = useRef<FollowPose | null>(null)
  const [isFollowing, setIsFollowing] = useState(false)
  // Phase B.3.1: presenter cursor — laserRef holds only the latest received
  // cursor pose (written per "laser" message — never setState).
  const laserRef = useRef<LaserState | null>(null)
  // Phase B.3.1: lightbox follow. followLightboxBoardId = the board the presenter
  // has open in the lightbox (null = closed), set from "lb" — drives the
  // follower's lightbox while following. lbViewportRef = latest presenter lightbox
  // viewport (written per "lbv" message — never setState).
  const [followLightboxBoardId, setFollowLightboxBoardId] = useState<string | null>(null)
  const lbViewportRef = useRef<LbViewport | null>(null)
  // Phase B.3.2: latest presenter pointer-over-image (per "lbc" — never setState).
  const lbCursorRef = useRef<LbCursorState | null>(null)
  // Phase B.5: debounced peer trace/callout-edit signal → LightboxModal refetch.
  const [critDirty, setCritDirty] = useState<CritDirtySignal | null>(null)
  // Phase B.5.1: peers' in-progress trace strokes (ephemeral), keyed
  // `${boardId}|${authorKey}`. Written by the trace-pt/trace-end handlers (no
  // setState); LightboxModal renders them live and clears on refetch.
  const traceStreamRef = useRef<Map<string, TraceStreamEntry>>(new Map())

  const isDemo = searchParams?.get('demo') === 'true'

  // Wall-config persistence: debounce network writes so a drag at 60fps doesn't fire 60 POSTs/sec.
  // Local UI state still updates immediately; only the fetch is throttled.
  const wallPersistTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wallPersistLatestRef = useRef<WallConfig | null>(null)

  const cacheWallConfigLocally = useCallback((config: WallConfig) => {
    // Phase 2a: wall-config is per-room. studioId is the room id here.
    const savedConfigKey = `studio-${studioId}-wall-config`
    const rawTables = (config as { tables?: Array<{ modelUrl?: string }> }).tables
    const compactConfig =
      Array.isArray(rawTables)
        ? {
            ...config,
            tables: rawTables.map((t) => ({
              ...t,
              modelUrl:
                typeof t.modelUrl === 'string' &&
                (t.modelUrl.startsWith('data:') || t.modelUrl.startsWith('blob:'))
                  ? undefined
                  : t.modelUrl,
            })),
          }
        : config

    try {
      localStorage.setItem(savedConfigKey, JSON.stringify(compactConfig))
    } catch (error) {
      console.warn('Wall config local cache skipped (quota/full storage)', error)
      try {
        localStorage.setItem(
          savedConfigKey,
          JSON.stringify({
            layoutType: config.layoutType,
            walls: config.walls,
          })
        )
      } catch {
        // Local fallback is optional; API remains source of truth.
      }
    }
  }, [studioId])

  // 409 handler: a save was rejected as stale AND could not be rebased. Adopt the
  // server's latest config (strip the embedded version back out so wallConfig
  // stays clean) and tell the user their unsaved changes were discarded. The
  // writer has already adopted the version by the time this runs, so this only
  // touches UI state.
  //
  // This is now the LAST resort, not the ordinary 409 path. Writes from this
  // client are serialized, wall writes are owner-only, and a losing write
  // re-posts itself onto the server's version up to MAX_REBASE_RETRIES times
  // before landing here. So reaching this means the version kept moving under a
  // single writer — we genuinely don't know what the room should be, and saying
  // so beats guessing. It is the only path that discards the user's edit, which
  // is why it must keep telling them.
  const handleWallConfigConflict = useCallback(
    (latest: Record<string, unknown> & { version?: number }) => {
      const { version: _version, ...config } = latest
      const nextConfig = config as unknown as WallConfig
      setWallConfig(nextConfig)
      cacheWallConfigLocally(nextConfig)
      toast.error("Space layout was updated by another user. Reloaded latest — your changes weren't saved.")
    },
    [cacheWallConfigLocally]
  )

  // Tier 2 optimistic-concurrency. The writer owns BOTH the base version and a
  // serialization queue, and EVERY wall-config write (this page's autosave plus
  // Save & Exit, wall-delete and text-items in StudioRoom) goes through it.
  // Holding the version and the queue in one object is the point: writes used to
  // read the version at payload-build time, so two overlapping in flight shipped
  // the same baseVersion and the second to land 409'd against the version the
  // first had just created — the false "updated by another user" toast with a
  // single user in the room.
  const wallConfigWriter = useWallConfigWriter(handleWallConfigConflict)

  // Room change: drop the previous room's layout so it's never briefly shown as
  // this room's, and tell the writer which room is on screen so a conflict from
  // the room we just left can't toast over this one. We deliberately do NOT touch
  // the version here: it's keyed per room inside the writer, so room A's number
  // can't leak into room B, and the trailing flush of room A's pending autosave
  // (fired from the effect cleanup below, during this switch) still needs it.
  useEffect(() => {
    setWallConfig(null)
    wallConfigWriter.setCurrentRoom(studioId)
    // On unmount there is no studio on screen, so a late conflict from a write
    // still in flight has no business toasting over whatever page the user is on
    // now. (On a room switch this is immediately followed by setCurrentRoom of
    // the new room — cleanups all run before setups.)
    return () => wallConfigWriter.setCurrentRoom(null)
  }, [studioId, wallConfigWriter])

  const flushWallConfig = useCallback(async () => {
    const config = wallPersistLatestRef.current
    if (!config) return
    wallPersistLatestRef.current = null
    // Defense in depth: persistWallConfig already refuses to arm a timer for a
    // non-editor, so this only fires if a future caller stages a config directly.
    if (!canEditWallsRef.current) return
    const wsKey = workspaceId ?? studioId
    // Queued: the writer reads the base version only once this reaches the front
    // of the queue, so it can never collide with a Save & Exit / text / delete
    // write that is already in flight. 409 → the writer already reported it.
    const result = await wallConfigWriter.write({ wsKey, roomId: studioId, config })
    if (result.status === 'ok') cacheWallConfigLocally(config)
    else if (result.status === 'error') console.error('Failed to save wall config', result.error)
  }, [studioId, workspaceId, cacheWallConfigLocally, wallConfigWriter])

  const persistWallConfig = useCallback((config: WallConfig) => {
    // The single choke point for the debounced autosave: every wall drag/rotate/
    // stretch/add/undo lands here. A non-editor never arms the timer, so the
    // unmount flush below has nothing to send either.
    if (!canEditWallsRef.current) return
    wallPersistLatestRef.current = config
    if (wallPersistTimeoutRef.current) clearTimeout(wallPersistTimeoutRef.current)
    wallPersistTimeoutRef.current = setTimeout(() => {
      wallPersistTimeoutRef.current = null
      flushWallConfig()
    }, 500)
  }, [flushWallConfig])

  /**
   * Drop any pending debounced autosave. Used when a caller takes ownership of
   * writing this config itself (the wall delete, which must await its write to
   * sequence against the board re-index it already committed server-side).
   * Without this the timer from an earlier drag would still be armed and would
   * later re-write a PRE-delete config on top of the delete — resurrecting the
   * wall. Cancelling is what makes collapsing the delete to one write safe.
   */
  const cancelPendingWallConfigSave = useCallback(() => {
    if (wallPersistTimeoutRef.current) {
      clearTimeout(wallPersistTimeoutRef.current)
      wallPersistTimeoutRef.current = null
    }
    wallPersistLatestRef.current = null
  }, [])

  // Flush any pending wall-config write on unmount so the user's last drag isn't lost.
  useEffect(() => {
    return () => {
      if (wallPersistTimeoutRef.current) {
        clearTimeout(wallPersistTimeoutRef.current)
        wallPersistTimeoutRef.current = null
        // Fire-and-forget; we can't await during cleanup.
        flushWallConfig()
      }
    }
  }, [flushWallConfig])

  // Load boards and wall config (API + localStorage fallback)
  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller

    const loadData = async () => {
      try {
        // Phase 6.2: studioId from URL is the room id. The API resolves it
        // (falls back to workspace_id for legacy URLs). If the resolved
        // room.id differs from studioId, we router.replace — the effect
        // re-runs with the correct id.
        const url = isDemo ? `/api/boards?roomId=${studioId}&demo=true` : `/api/boards?roomId=${studioId}`
        const response = await fetch(url, { signal })
        let resolvedRoomId: string | null = null
        let resolvedWorkspaceId: string | null = null
        if (response.ok) {
          const data = await response.json()
          setBoards(data.boards || [])
          resolvedRoomId = data.room?.id ?? null
          resolvedWorkspaceId = data.room?.workspaceId ?? null
          setRoomId(resolvedRoomId)
          setWorkspaceId(resolvedWorkspaceId)
          setWallColor(data.room?.wallColor === 'grey' ? 'grey' : 'white')
          setBoardsError(false)

          // Backward-compat redirect: legacy /studio/{workspace_id} URLs.
          if (!isDemo && resolvedRoomId && resolvedRoomId !== studioId) {
            const qs = searchParams ? searchParams.toString() : ''
            router.replace(`/studio/${resolvedRoomId}${qs ? `?${qs}` : ''}`, { scroll: false })
            return
          }
        } else {
          setBoardsError(true)
          return
        }

        // Fetch workspace metadata for archive status + breadcrumb + room
        // switcher. Keyed by the resolved workspace id, not the URL param.
        //
        // Also resolves wall-write permission. `canEdit` is tracked as a local
        // alongside the state setter because the first-entry seed below runs in
        // THIS same pass — the state update wouldn't be visible to it.
        // `?? studioId` mirrors wallConfigWsId below, and is load-bearing now
        // that permission is resolved here: /api/boards returns `room: null` for
        // a legacy /studio/{workspace_id} URL whose workspace has no rooms rows,
        // so resolvedWorkspaceId is null even though the id in hand IS the
        // workspace. Without the fallback the block below is skipped and the
        // OWNER silently drops to read-only on a page that otherwise looks fine.
        // When studioId is a room id that failed to resolve, this 404s and
        // canEdit stays false — same as having skipped it.
        const wsIdForFetch = resolvedWorkspaceId ?? studioId
        // Demo studios never fetch workspace metadata (there's no workspace to
        // read), so permission can't be resolved from members. They're a local
        // sandbox, so keep them editable rather than gating them into read-only.
        let canEdit = isDemo
        let canDelete = isDemo
        // REORDER (a board's slideshow slot): owner or superadmin only —
        // deliberately narrower than canEdit/canDelete so the affordance
        // matches /api/boards/reorder and never shows to someone who'd 403.
        let canReorder = false
        if (!isDemo && wsIdForFetch) {
          try {
            const wsRes = await fetch(`/api/workspaces/${wsIdForFetch}`, { signal })
            if (wsRes.ok) {
              const wsData = await wsRes.json()
              const ws = wsData.workspace
              setIsArchived(Boolean(ws?.isArchived))
              setWorkspaceName(ws?.name ?? null)
              const rooms: Array<{ id: string; name: string }> = (ws?.rooms ?? []).map(
                (r: { id: string; name: string }) => ({ id: r.id, name: r.name })
              )
              setAllRooms(rooms)
              const matched = rooms.find(r => r.id === resolvedRoomId)
              setCurrentRoomName(matched?.name ?? null)
              // Resolve current user's role + membership from the workspace
              // members list. Both wall predicates below reuse these, so there is
              // no extra round trip.
              const { data: { session: authSession } } = await supabase.auth.getSession()
              const myUserId = authSession?.user?.id
              let myRole: 'instructor' | 'student' | null = null
              let isMember = false
              if (myUserId && Array.isArray(ws?.members)) {
                const members = ws.members as Array<{ userId: string; role: string }>
                const myMember = members.find((m) => m.userId === myUserId)
                myRole = (myMember?.role as 'instructor' | 'student') ?? null
                isMember = myMember != null
                setCurrentUserRole(myRole)
              }
              // `createdBy` is owner_id and needs only the session — deliberately
              // NOT read off `members`, so an owner keeps write access even if the
              // members array is missing or malformed. `isSuperadmin` rides on the
              // same workspace fetch (no new route).
              const isOwner = !!myUserId && ws?.createdBy === myUserId
              const viewerIsSuperadmin = wsData.isSuperadmin === true
              // EDIT (walls/tables/text): owner, superadmin, or any member (any
              // role). Widened from owner-only — safe now that the writer resolves
              // concurrent 409s by lastWriterId instead of assuming a lone writer
              // (lib/wallConfigWriter.ts).
              canEdit = isOwner || viewerIsSuperadmin || isMember
              // DELETE (a wall, and the boards on it): owner, superadmin, or an
              // instructor only. A student member is intentionally excluded.
              canDelete = isOwner || viewerIsSuperadmin || myRole === 'instructor'
              canReorder = isOwner || viewerIsSuperadmin
            }
          } catch {
            // Non-fatal: breadcrumb + archive status are best-effort. canEdit and
            // canDelete stay false (fail-closed) — see the canEditWalls
            // declaration for why that's the safe direction.
          }
        }
        setCanEditWalls(canEdit)
        setCanDeleteWalls(canDelete)
        setCanReorderBoards(canReorder)

        // Phase 2a: wall-config is now per-room. The endpoint path segment is
        // still the workspace id (for the auth check); the room id is appended
        // as a query param so the route reads/writes the per-room blob. If a
        // per-room blob doesn't exist yet, the endpoint falls back to the
        // legacy workspace blob so existing rooms keep their current config.
        const wallConfigWsId = resolvedWorkspaceId ?? studioId
        const wallConfigUrl = `/api/studios/${wallConfigWsId}/wall-config?roomId=${encodeURIComponent(studioId)}`

        let loadedConfig: WallConfig | null = null
        let versionKnown = false
        try {
          const resConfig = await fetch(wallConfigUrl, { signal })
          if (resConfig.ok) {
            const data = await resConfig.json()
            // Capture the base version so the first save sends the right one.
            // `readError` means the route couldn't determine what's stored (as
            // opposed to proving nothing is): it then sends no version at all,
            // and treating its absence as "unknown" is what keeps us off the
            // blind-write path. The explicit check is belt-and-braces so a route
            // that ever regains a version field on an errored read can't be read
            // as authoritative.
            if (data?.readError !== true && typeof data?.version === 'number') {
              // Hand it the config too: knowing what the server holds is what
              // lets a later 409 against an unstamped blob be told apart from a
              // rival editor. See the rebase gate in lib/wallConfigWriter.ts.
              wallConfigWriter.setVersion(studioId, data.version, data.config)
              versionKnown = true
            }
            if (data?.config) {
              loadedConfig = data.config
            }
          }
        } catch (e) {
          if (signal.aborted) return
          console.warn('Wall config API fetch failed, falling back to localStorage', e)
        }

        // Fallback: localStorage (per-room key)
        if (!loadedConfig) {
          const savedConfigKey = `studio-${studioId}-wall-config`
          const savedConfig = localStorage.getItem(savedConfigKey)
          if (savedConfig) {
            loadedConfig = JSON.parse(savedConfig)
          }
        }

        // The GET never gave us a version, so whatever we're about to render came
        // from stale localStorage (or defaults below) rather than the server. Hand
        // the writer that config as its baseline: the next write re-learns the
        // version but may only use it if the stored blob still matches this — if
        // the server has moved on, writing would silently destroy a layout we
        // never saw, so it surfaces as a real conflict instead.
        if (loadedConfig) {
          setWallConfig(loadedConfig)
          if (!versionKnown) wallConfigWriter.markVersionUnknown(studioId, loadedConfig)
        } else if (!canEdit) {
          // A viewer opening a room that has no config yet renders the defaults
          // WITHOUT seeding them. Seeding is a write: it creates the blob and
          // bumps the version, which 409s the real editor's next save. The room
          // gets its config from the first person who may actually edit it.
          setWallConfig(DEFAULT_CONFIG)
          if (!versionKnown) wallConfigWriter.markVersionUnknown(studioId, DEFAULT_CONFIG)
        } else {
          // First entry: silently persist defaults so subsequent loads just read them.
          setWallConfig(DEFAULT_CONFIG)
          if (!versionKnown) wallConfigWriter.markVersionUnknown(studioId, DEFAULT_CONFIG)
          // What this room ends up on: defaults, or the server's layout if the
          // write below finds one already there.
          let seededConfig: WallConfig = DEFAULT_CONFIG
          try {
            // silentConflict: a 409 here means another client seeded this room's
            // defaults first (simultaneous first-entry). Nobody made a real edit
            // and both wrote identical defaults, so adopt theirs without a toast.
            // This is also the recovery when the load GET failed AND the room turns
            // out to already have a real layout: the writer refuses to rebase
            // defaults over it and reports a conflict, which lands here and adopts
            // the server's config — no toast, no clobber.
            const result = await wallConfigWriter.write({
              wsKey: wallConfigWsId,
              roomId: studioId,
              config: DEFAULT_CONFIG,
              silentConflict: true,
              // Never rebase THIS write. A 409 here means the room already has a
              // layout; re-posting DEFAULT_CONFIG on top of it would replace a
              // real room with an empty one. Adopting the server's config (below)
              // is the entire point of seeding — defaults are a starting guess,
              // not the user's intent.
              rebaseOnConflict: false,
              signal,
            })
            if (result.status === 'conflict' && result.latest) {
              const { version: _version, ...cfg } = result.latest
              seededConfig = cfg as unknown as WallConfig
              setWallConfig(seededConfig)
            }
          } catch (e) {
            if (!signal.aborted) console.warn('Failed to persist default wall config', e)
          }
          // Cache what we actually settled on, not DEFAULT_CONFIG — after adopting
          // the server's real layout above, caching defaults would poison this
          // room's fallback for any later session whose GET fails.
          cacheWallConfigLocally(seededConfig)
        }
      } catch (error) {
        if (signal.aborted) return
        console.error('Error loading data:', error)
        setBoardsError(true)
      } finally {
        if (!signal.aborted) setIsLoading(false)
      }
    }

    loadData()

    // Realtime: keep boards in sync with other users in the same studio.
    // Status callback recovers from transient network blips with a bounded retry budget.
    let reconnectAttempts = 0
    const MAX_RECONNECTS = 3
    const handleStatus = (status: string) => {
      if (status === 'SUBSCRIBED') {
        reconnectAttempts = 0
        return
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        reconnectAttempts += 1
        console.warn('Realtime channel disconnected:', status, `(attempt ${reconnectAttempts}/${MAX_RECONNECTS})`)
        if (reconnectAttempts <= MAX_RECONNECTS) {
          toast.warning('Connection lost — reconnecting…')
          setRetryCount((c) => c + 1)
        } else {
          toast.error('Lost connection to live updates. Please refresh the page.')
        }
      }
    }

    // Realtime filter walks via room_id (Phase 6.1 data path). Skip the
    // subscription entirely until we've resolved the room — without a filter
    // we'd receive every boards-table change for every studio.
    const channel = isDemo || !roomId
      ? null
      : supabase
          .channel(`studio-boards:${roomId}`)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'boards', filter: `room_id=eq.${roomId}` },
            (payload: RealtimeBoardPayload) => {
              // A realtime INSERT/UPDATE can carry an INTERMEDIATE upload
              // snapshot: a new board is INSERTed at center (50/50) with a
              // default size, and its real placement/size lands in a LATER PUT.
              // Mapping payload.new straight into state therefore renders that
              // stale snapshot until a refresh. Instead, debounce a refetch
              // through the GET path (handleBoardUpdate) so we render the
              // COMMITTED row — identical to a hard refresh. That GET ->
              // setBoards -> useBoardState parent-sync route is the same one the
              // uploader's own post-upload refresh already uses, so its
              // ACTIVE_WALL_OWNERSHIP / optimistic-hold / temp-board guards keep
              // shielding an in-progress upload and an actively-edited wall.
              if (payload.eventType === 'DELETE') {
                // DELETE stays inline — payload.old.id is final and sufficient.
                const deletedId = (payload.old as { id?: string }).id
                if (deletedId) setBoards((prev) => prev.filter((b) => b.id !== deletedId))
                // Phase B.5.2: ping guest spectators (no postgres_changes for
                // them) to refetch via their token path. Fire-and-forget.
                liveChannelRef.current?.send({ type: 'broadcast', event: 'boards-dirty', payload: {} })
                return
              }
              // INSERT/UPDATE: coalesce a burst (the INSERT-then-PUT pair, and
              // multi-page PDF uploads) into a single ~400ms-debounced refetch.
              if (boardsRefetchTimerRef.current) clearTimeout(boardsRefetchTimerRef.current)
              boardsRefetchTimerRef.current = setTimeout(() => {
                boardsRefetchTimerRef.current = null
                void handleBoardUpdate()
                // Phase B.5.2: same-timer ping so guest spectators refetch the
                // committed boards via their token path (covers upload/move/resize).
                liveChannelRef.current?.send({ type: 'broadcast', event: 'boards-dirty', payload: {} })
              }, 400)
            }
          )
          .subscribe(handleStatus)

    // Comments realtime: bump a nonce on any insert/update/delete so open comment panels refetch.
    // No filter — `comments` doesn't carry workspace_id; panels filter client-side by board.
    const commentsChannel = isDemo
      ? null
      : supabase
          .channel(`studio-comments:${studioId}`)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'comments' },
            () => setCommentNonce((n) => n + 1)
          )
          .subscribe()

    return () => {
      controller.abort()
      if (boardsRefetchTimerRef.current) {
        clearTimeout(boardsRefetchTimerRef.current)
        boardsRefetchTimerRef.current = null
      }
      if (channel) supabase.removeChannel(channel)
      if (commentsChannel) supabase.removeChannel(commentsChannel)
    }
  }, [studioId, isDemo, retryCount, roomId])

  // Tier 1 presence: track this user on a per-room channel and read who else is
  // here. Separate from the boards channel so the userlist isn't coupled to the
  // boards reconnect/retry budget. Keyed by roomId so each room has its own set.
  useEffect(() => {
    if (isDemo || !roomId) return
    let cancelled = false
    presenceSubscribedRef.current = false

    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const user = session?.user
      if (!user || cancelled) return
      const fullName =
        (user.user_metadata?.full_name as string | undefined) ||
        (user.user_metadata?.name as string | undefined) ||
        user.email ||
        'Someone'
      setCurrentUserId(user.id)
      presenceMetaRef.current = { userId: user.id, fullName, isPresenting: false }

      const channel = supabase.channel(`studio-presence:${roomId}`, {
        config: { presence: { key: user.id } },
      })
      presenceChannelRef.current = channel
      channel
        .on('presence', { event: 'sync' }, () => {
          const state = channel.presenceState() as Record<
            string,
            Array<{
              userId?: string
              fullName?: string
              currentWallIndex?: number | null
              isPresenting?: boolean
              joinedAt?: number
            }>
          >
          const flat: PresentUser[] = Object.values(state)
            .flat()
            .map((m) => ({
              userId: m.userId ?? '',
              fullName: m.fullName ?? 'Someone',
              wallIndex: m.currentWallIndex ?? null,
              isPresenting: m.isPresenting ?? false,
              joinedAt: m.joinedAt,
            }))
          setPresentUsers(flat)
        })
        .subscribe(async (status: string) => {
          if (status === 'SUBSCRIBED') {
            presenceSubscribedRef.current = true
            // Track with the latest wall + presenter flag (read from refs to
            // avoid a stale closure, and so a Present toggle that fired before
            // SUBSCRIBED is preserved here).
            await channel.track({
              userId: user.id,
              fullName,
              joinedAt: Date.now(),
              currentWallIndex: currentWallIndexRef.current,
              isPresenting: presenceMetaRef.current?.isPresenting ?? false,
            })
          }
        })
    })()

    return () => {
      cancelled = true
      presenceSubscribedRef.current = false
      const ch = presenceChannelRef.current
      if (ch) supabase.removeChannel(ch)
      presenceChannelRef.current = null
      presenceMetaRef.current = null
      setPresentUsers([])
    }
  }, [roomId, isDemo])

  // Phase B.2: ephemeral live channel for presenter camera broadcast. Broadcast
  // only — no presence, no postgres_changes. self:false so the presenter never
  // receives (or follows) its own packets. Incoming "cam" payloads are written
  // straight into followPoseRef (latest pose only); CameraController consumes the
  // ref in its frame loop. NEVER setState per message, no logging. Mirrors the
  // presence-channel lifecycle: keyed [roomId, isDemo], held in a ref, removed in
  // cleanup.
  useEffect(() => {
    if (isDemo || !roomId || !isSupabaseConfigured) return
    const channel = supabase.channel(`studio-live:${roomId}`, {
      config: { broadcast: { self: false } },
    })
    liveChannelRef.current = channel
    // Phase B.3: monotonic seq so the laser renderer can tell a fresh packet from
    // a repeat and time out a stale pointer via frame deltas (no Date.now in the
    // frame loop). Lives in the effect closure; resets per room.
    let laserSeq = 0
    let lbCursorSeq = 0
    // Phase B.5: crit-dirty debounce state (per-channel-lifetime closure).
    let critDirtySeq = 0
    let critDirtyPending: { boardId: string; trace: boolean; callout: boolean } | null = null
    let critDirtyTimer: ReturnType<typeof setTimeout> | null = null
    channel
      .on('broadcast', { event: 'cam' }, (msg: { payload?: FollowPose }) => {
        const payload = msg.payload
        if (payload && Array.isArray(payload.p) && Array.isArray(payload.t)) {
          followPoseRef.current = payload
        }
      })
      .on('broadcast', { event: 'laser' }, (msg: { payload?: { p?: [number, number, number]; off?: boolean } }) => {
        const payload = msg.payload
        if (!payload || payload.off || !Array.isArray(payload.p)) {
          laserRef.current = null
          return
        }
        laserSeq += 1
        laserRef.current = { p: payload.p, seq: laserSeq }
      })
      // Phase B.3.1: presenter opened/closed/switched their lightbox. Low-frequency
      // discrete event, so setState is correct here (drives the follower's modal);
      // gated downstream by isFollowing (ignored entirely when not following).
      .on('broadcast', { event: 'lb' }, (msg: { payload?: { boardId?: string; off?: boolean } }) => {
        const payload = msg.payload
        setFollowLightboxBoardId(payload && !payload.off && payload.boardId ? payload.boardId : null)
      })
      // Phase B.3.1: presenter lightbox viewport (~10Hz). Ref-only — never setState;
      // LightboxModal smooth-applies it while following.
      .on('broadcast', { event: 'lbv' }, (msg: { payload?: { z?: number; cx?: number; cy?: number } }) => {
        const payload = msg.payload
        if (!payload || typeof payload.z !== 'number' || typeof payload.cx !== 'number' || typeof payload.cy !== 'number') return
        lbViewportRef.current = { z: payload.z, cx: payload.cx, cy: payload.cy }
      })
      // Phase B.3.2: presenter pointer over the lightbox image (~15Hz). Ref-only
      // (seq for staleness); LightboxModal positions the 2D dot in its frame loop.
      .on('broadcast', { event: 'lbc' }, (msg: { payload?: { cx?: number; cy?: number; off?: boolean } }) => {
        const payload = msg.payload
        if (!payload || payload.off || typeof payload.cx !== 'number' || typeof payload.cy !== 'number') {
          lbCursorRef.current = null
          return
        }
        lbCursorSeq += 1
        lbCursorRef.current = { cx: payload.cx, cy: payload.cy, seq: lbCursorSeq }
      })
      // Phase B.5: a peer saved a trace/callout. Coalesce a burst into one
      // debounced signal (ref + timer; setState only in the debounce resolution),
      // then LightboxModal refetches the matching kind for the open board.
      .on('broadcast', { event: 'crit-dirty' }, (msg: { payload?: { boardId?: string; kind?: 'trace' | 'callout' } }) => {
        const p = msg.payload
        if (!p?.boardId || (p.kind !== 'trace' && p.kind !== 'callout')) return
        if (!critDirtyPending || critDirtyPending.boardId !== p.boardId) {
          critDirtyPending = { boardId: p.boardId, trace: false, callout: false }
        }
        if (p.kind === 'trace') critDirtyPending.trace = true
        else critDirtyPending.callout = true
        if (critDirtyTimer) clearTimeout(critDirtyTimer)
        critDirtyTimer = setTimeout(() => {
          critDirtyTimer = null
          const pend = critDirtyPending
          critDirtyPending = null
          if (pend) { critDirtySeq += 1; setCritDirty({ ...pend, seq: critDirtySeq }) }
        }, 500)
      })
      // Phase B.5.1: live trace streaming (ephemeral). Append delta points to the
      // author's in-progress stroke; trace-end finalizes it. Ref writes only — no
      // setState; LightboxModal renders from the ref each frame and clears on save.
      .on('broadcast', { event: 'trace-pt' }, (msg: { payload?: { boardId?: string; authorKey?: string; color?: string; pts?: [number, number][] } }) => {
        const p = msg.payload
        if (!p?.boardId || !p.authorKey || !Array.isArray(p.pts)) return
        const map = traceStreamRef.current
        const key = `${p.boardId}|${p.authorKey}`
        let e = map.get(key)
        if (!e) {
          e = { boardId: p.boardId, authorKey: p.authorKey, color: typeof p.color === 'string' ? p.color : '#94a3b8', completed: [], live: null }
          map.set(key, e)
        }
        if (typeof p.color === 'string') e.color = p.color
        if (!e.live) e.live = []
        for (const pt of p.pts) {
          if (Array.isArray(pt) && pt.length === 2 && typeof pt[0] === 'number' && typeof pt[1] === 'number') e.live.push([pt[0], pt[1]])
        }
      })
      .on('broadcast', { event: 'trace-end' }, (msg: { payload?: { boardId?: string; authorKey?: string } }) => {
        const p = msg.payload
        if (!p?.boardId || !p.authorKey) return
        const e = traceStreamRef.current.get(`${p.boardId}|${p.authorKey}`)
        if (e && e.live) { e.completed.push(e.live); e.live = null }
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
      liveChannelRef.current = null
      followPoseRef.current = null
      laserRef.current = null
      lbViewportRef.current = null
      lbCursorRef.current = null
      traceStreamRef.current.clear()
      if (critDirtyTimer) clearTimeout(critDirtyTimer)
    }
  }, [roomId, isDemo])

  // Re-broadcast the local user's active wall when it changes — updates presence
  // meta in place (no re-subscribe). Guarded on SUBSCRIBED; the subscribe handler
  // sends the initial value.
  useEffect(() => {
    if (isDemo) return
    const ch = presenceChannelRef.current
    const meta = presenceMetaRef.current
    if (!ch || !meta || !presenceSubscribedRef.current) return
    ch.track({ ...meta, joinedAt: Date.now(), currentWallIndex })
  }, [currentWallIndex, isDemo])

  // Walls currently occupied by OTHER users (exclude self) — drives the 3D highlight.
  const othersEditingWalls = useMemo(() => {
    const s = new Set<number>()
    for (const u of presentUsers) {
      if (u.userId && u.userId !== currentUserId && typeof u.wallIndex === 'number') {
        s.add(u.wallIndex)
      }
    }
    return s
  }, [presentUsers, currentUserId])

  // Phase B.1: the single active presenter, derived from presence. If more than
  // one user somehow has isPresenting (brief race — the UI otherwise prevents
  // it), the lowest joinedAt wins so everyone agrees on the same presenter.
  // Returns null when nobody is presenting (incl. after a presenter disconnects,
  // since their presence row — and the flag — leaves the synced state).
  const presenter = useMemo(() => {
    let best: PresentUser | null = null
    for (const u of presentUsers) {
      // Phase B.4: guests (key "guest:<tokenId>") spectate live crit but can NEVER
      // present — ignore them here even if a malformed payload claims isPresenting.
      if (!u.userId || u.userId.startsWith('guest:') || !u.isPresenting) continue
      if (!best || (u.joinedAt ?? Infinity) < (best.joinedAt ?? Infinity)) best = u
    }
    return best ? { userId: best.userId, fullName: best.fullName } : null
  }, [presentUsers])

  const isPresenter = !!presenter && presenter.userId === currentUserId
  const someoneElsePresenting = !!presenter && presenter.userId !== currentUserId

  // Phase B.2: auto-follow. Defaults ON when a non-self presenter starts and
  // resets when the presenter clears/disconnects or it becomes us. Keyed on the
  // presenter's id so a NEW presenter re-arms follow, while a manual break-away
  // (which only flips isFollowing, not the id) stays detached for that presenter.
  const followTargetId = someoneElsePresenting ? presenter!.userId : null
  useEffect(() => {
    setIsFollowing(followTargetId !== null)
  }, [followTargetId])

  // Break-away: Escape detaches a following viewer so they can orbit freely.
  // Bound only while following; flipping isFollowing re-enables OrbitControls on
  // the next frame (see CameraController arbitration).
  //
  // This used to stand down while the studio options menu was open, so one
  // Escape dismissed the menu without also dropping the viewer out of follow
  // mode. That menu is gone, and with nothing else claiming Escape here, the
  // guard went with it.
  useEffect(() => {
    if (!isFollowing) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFollowing(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isFollowing])

  // Phase B.3.1: deterministic cursor-dot color for the active presenter (same
  // palette as PresenceBar avatars). Irrelevant when nobody is presenting.
  const laserColor = presenter ? colorFor(presenter.userId) : '#22d3ee'

  const handleBoardUpdate = async () => {
    // Reload boards after update — scoped to the room, not the workspace.
    // Phase B.5.2: sequence-guard the refetch. The first upload's cold-path
    // INSERT(center)->PUT(placement) gap can exceed the 400ms debounce, so a
    // fetch reads the pre-PUT center snapshot while a later fetch reads the
    // committed placement. Without this guard, out-of-order resolution lets the
    // stale snapshot win as the final setBoards with nothing to correct it (the
    // board never converges until refresh). Only the latest-issued fetch commits.
    const seq = ++boardsFetchSeqRef.current
    try {
      const response = await fetch(`/api/boards?roomId=${studioId}`)
      if (response.ok) {
        const data = await response.json()
        if (seq !== boardsFetchSeqRef.current) return // superseded by a newer refetch
        setBoards(data.boards || [])
      }
    } catch (error) {
      console.error('Error reloading boards:', error)
    }
  }

  if (isLoading) {
    return (
      <div className="w-full h-screen flex items-center justify-center" style={{ background: CHROME.accent }}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-white/20 border-t-white mx-auto mb-4"></div>
          <p className="text-white/90 font-medium">Loading space...</p>
        </div>
      </div>
    )
  }

  if (boardsError) {
    return (
      <div className="w-full h-screen flex items-center justify-center" style={{ background: CHROME.accent }}>
        <div className="text-center">
          <p className="text-white font-semibold text-lg mb-2">Failed to load boards</p>
          <p className="text-white/70 text-sm mb-6">Check your connection and try again.</p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => { setBoardsError(false); setIsLoading(true); setRetryCount(c => c + 1) }}
              className="px-5 py-2 bg-white text-[#3B6EF6] rounded-lg font-medium hover:bg-white/90 transition-colors"
            >
              Retry
            </button>
            <button
              onClick={() => router.push('/dashboard')}
              className="px-5 py-2 bg-white/20 text-white rounded-lg font-medium hover:bg-white/30 transition-colors"
            >
              Dashboard
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      <DemoBanner />
      {!isDemo && <PresenceBar users={presentUsers} currentUserId={currentUserId} />}
      {/* Phase B.1: presenter indicator. Shown to everyone except the presenter
          (they get the "Stop presenting" button). Sits just below PresenceBar;
          style kept consistent with it. */}
      {!isDemo && someoneElsePresenting && (
        <div
          className="fixed top-16 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-3 py-2 bg-white/10 backdrop-blur-md rounded-xl shadow-lg border border-white/20"
          role="status"
        >
          <Presentation className="w-4 h-4 text-white" />
          <span className="text-white/90 text-xs font-medium">{friendlyName(presenter!.fullName)} is presenting</span>
          {/* Phase B.2: follow toggle. Default is following; break away to orbit
              freely (also via Escape), or rejoin. */}
          <button
            onClick={() => setIsFollowing((v) => !v)}
            className="ml-1 px-2 py-0.5 rounded-md bg-white/15 hover:bg-white/25 text-white text-xs font-medium transition-colors"
          >
            {isFollowing ? 'Stop following' : `Follow ${friendlyName(presenter!.fullName)}`}
          </button>
        </div>
      )}
      {/* Archive banner */}
      {isArchived && (
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#3B6EF6] text-white text-sm font-medium text-center py-2 px-4">
          This workspace is archived. View only.
        </div>
      )}
      {showShareModal && (
        <ShareModal
          studioId={studioId}
          onClose={() => setShowShareModal(false)}
        />
      )}

      {wallConfig && (
        <div className={`${figtree.className} relative w-full h-screen overflow-hidden`} style={{ background: ROOM_SKY }}>
          {/* The three pulsing indigo blur orbs that used to sit here were the
              remaining lavender in the room: they tinted the paper background
              and competed with the white sheets on the walls. A developed
              drawing surface wants a flat, neutral field behind it. Background
              matches ROOM_SKY (the room Canvas's own fog/sky color) so
              there's no color flash while the Canvas mounts on top of this. */}

          {/* Top Left - Logo and breadcrumb. Hidden in wall edit mode. */}
          {!isEditMode && (
            // Same flex-wrap/max-w pattern as the right toolbar so a long
            // workspace + room breadcrumb pill drops to a second line on
            // narrow viewports instead of running off the right edge.
            <div className="fixed top-4 left-4 z-40 flex flex-wrap items-center gap-2.5 max-w-[calc(100vw-2rem)] sm:flex-nowrap sm:max-w-none">
              {/* The wordmark, not a button. It was a filled blue pill the same
                  size and shape as Share, which made the brand read as an
                  action you were being offered — and it was the only place in
                  the product where "pinspace" appeared without its blue
                  terminal period. This is the landing page's own lockup
                  (app/page.tsx nav): ink wordmark, extrabold, tight tracking,
                  the period as a true circle rather than the font's '.' so it
                  stays round and on-brand at any size. Still a link home;
                  nothing but the chrome came off. */}
              <Link
                href="/"
                aria-label="pinspace home"
                // Onest inline, not inherited: this whole page is wrapped in
                // Figtree, and Figtree is loaded here at 400–700 — so the
                // extrabold-800 wordmark would both change typeface AND get
                // synthesised or clamped to 700. Onest at 800 is what the
                // landing page draws, and the mark has to be one mark.
                style={{ fontFamily: "'Onest', 'Inter', system-ui, sans-serif" }}
                className="text-[#16181D] font-extrabold text-xl tracking-[-0.045em] hover:opacity-80 transition-opacity"
              >
                pinspace
                <span
                  aria-hidden="true"
                  className="inline-block align-baseline rounded-full bg-[#3B6EF6] w-[0.2em] h-[0.2em] ml-[0.06em]"
                />
              </Link>

              {/* Phase 6.2: breadcrumb + room switcher. Workspace name links
                  back to the rooms list page; room name opens a dropdown
                  listing the other rooms in the same workspace. Falls back
                  to a plain "← Dashboard" button while metadata is loading
                  or in demo mode (no workspace context). */}
              {workspaceName && workspaceId ? (
                <div
                  style={{ background: CHROME.accent, color: CHROME.paper, borderColor: CHROME.hairline }}
                  className={`${figtree.className} px-4 py-2.5 rounded-xl shadow-lg border transition-colors flex items-center gap-2 text-sm font-semibold relative`}
                >
                  <button
                    onClick={() => router.push(`/workspace/${workspaceId}`)}
                    className="hover:underline"
                    aria-label={`Back to ${workspaceName} spaces list`}
                  >
                    {workspaceName}
                  </button>
                  <span className="text-white/50">/</span>
                  <button
                    onClick={() => setShowRoomSwitcher((v) => !v)}
                    disabled={allRooms.length <= 1}
                    className="flex items-center gap-1 disabled:cursor-default"
                    aria-label="Switch space"
                    aria-expanded={showRoomSwitcher}
                  >
                    <span>{currentRoomName ?? '…'}</span>
                    {allRooms.length > 1 && (
                      <ChevronDown className={`w-4 h-4 transition-transform ${showRoomSwitcher ? 'rotate-180' : ''}`} />
                    )}
                  </button>

                  {showRoomSwitcher && allRooms.length > 1 && (
                    // The pill above used to be JetBrains Mono with uppercase
                    // and 0.14em tracking, and this menu — a DOM child of it —
                    // inherited all three, with the text-transform hitting the
                    // <div> and <a> but NOT the <button>s (Chrome's UA sheet
                    // resets it there), so the list read "SITE ANALYSIS" next to
                    // "Precedents". The pill is plain Figtree now, so the
                    // font-sans/normal-case/tracking-normal antidote it needed
                    // is gone with the thing it was undoing.
                    <div
                      className="absolute left-0 top-full mt-2 w-56 bg-white text-gray-900 rounded-xl shadow-2xl border border-gray-200 overflow-hidden z-50"
                      onMouseLeave={() => setShowRoomSwitcher(false)}
                    >
                      {/* Its own caps + tracking: this is a section label, not a
                          room name. */}
                      <div className="px-3 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-[0.12em] bg-gray-50 border-b border-gray-100 truncate">
                        Spaces in {workspaceName}
                      </div>
                      <ul className="py-1">
                        {allRooms.map((r) => {
                          const isCurrent = r.id === roomId
                          return (
                            <li key={r.id}>
                              {isCurrent ? (
                                <div className="px-3 py-2 text-[13px] bg-[#3B6EF6]/10 text-[#3B6EF6] font-semibold flex items-center justify-between gap-2">
                                  <span className="truncate">{r.name}</span>
                                  {/* Caps so it reads as a badge instead of
                                      running into the name. */}
                                  <span className="shrink-0 text-[10px] uppercase tracking-[0.1em] opacity-70">
                                    current
                                  </span>
                                </div>
                              ) : (
                                <button
                                  onClick={() => {
                                    setShowRoomSwitcher(false)
                                    router.push(`/studio/${r.id}`)
                                  }}
                                  className="block w-full truncate text-left px-3 py-2 text-[13px] hover:bg-gray-50"
                                >
                                  {r.name}
                                </button>
                              )}
                            </li>
                          )
                        })}
                      </ul>
                      <div className="border-t border-gray-100">
                        <Link
                          href={`/workspace/${workspaceId}`}
                          onClick={() => setShowRoomSwitcher(false)}
                          className="block px-3 py-2 text-[13px] text-[#3B6EF6] hover:bg-[#3B6EF6]/10 font-semibold"
                        >
                          See all spaces →
                        </Link>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => router.push('/dashboard')}
                  className="px-4 py-2.5 bg-white/10 hover:bg-white/20 backdrop-blur-md text-white rounded-xl shadow-lg border border-white/20 transition-all duration-300 font-medium text-sm flex items-center gap-2"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Dashboard
                </button>
              )}
            </div>
          )}

          {/* Top-right buttons (desktop / >= sm) - Hide when in edit mode.
              Phones get the Share-only panel right below; the `hidden sm:flex`
              switch swaps the two without changing handlers.

              Two named buttons, no menu. The hamburger here held exactly one
              item — Presentation — after room configuration moved onto the Plan
              view, so it was a menu you had to open to discover its only
              choice. A button that says what it does costs the same pixels. */}
          {!isEditMode && (
            <div className="hidden sm:flex fixed top-4 right-4 z-40 flex-nowrap justify-end items-center gap-2.5">
              {/* Presentation is a running order, not a way of looking at the
                  SPACE — that's why it isn't a tab in the bottom strip beside
                  Space/2D/Plan. It's a toggle: pressing it while you're already
                  presenting returns you to the room, which is the only way back
                  now that it has no tab. */}
              <button
                onClick={() => setRoomView(roomView === 'presentation' ? 'room' : 'presentation')}
                aria-pressed={roomView === 'presentation'}
                style={
                  roomView === 'presentation'
                    ? { background: CHROME.accent, color: CHROME.paper, borderColor: CHROME.accent }
                    : { background: CHROME.paper, color: '#16181D', borderColor: CHROME.hairline }
                }
                className={`${figtree.className} px-5 py-2.5 rounded-xl shadow-lg border transition-opacity duration-200 font-semibold text-sm flex items-center gap-2 hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3B6EF6]/40`}
              >
                <Presentation className="w-4 h-4" />
                Presentation
              </button>

              {/* Share sits rightmost — it's the action that brings other people
                  in, not a view. */}
              <button
                onClick={() => setShowShareModal(true)}
                style={{ background: CHROME.accent, color: CHROME.paper }}
                className={`${figtree.className} px-5 py-2.5 rounded-xl shadow-lg transition-opacity duration-200 font-semibold text-sm flex items-center gap-2 hover:opacity-90`}
              >
                <Share2 className="w-4 h-4" />
                Share
              </button>
            </div>
          )}

          {/* Phone-only Share (< sm). The hamburger this replaces also held
              Place 3D model and Reconfigure Walls, both of which now live on
              the Plan view. Share has no other home on a phone, so it becomes
              a plain button rather than a menu of one. */}
          {!isEditMode && (
            <div className="sm:hidden fixed top-4 right-4 z-40">
              <button
                onClick={() => setShowShareModal(true)}
                aria-label="Share this space"
                className="p-2.5 bg-white/10 hover:bg-white/20 backdrop-blur-md text-white rounded-xl shadow-lg border border-white/20 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
              >
                <Share2 className="w-5 h-5" />
              </button>
            </div>
          )}

          <StudioRoom
            studioId={studioId}
            roomId={roomId}
            workspaceId={workspaceId}
            boards={boards}
            wallConfig={wallConfig}
            onBoardUpdate={handleBoardUpdate}
            onEditModeChange={setIsEditMode}
            floorEditorOpen={floorEditorOpen}
            onFloorEditorOpenChange={setFloorEditorOpen}
            floorEditorMode={floorEditorMode}
            onFloorEditorModeChange={setFloorEditorMode}
            isArchived={isArchived}
            commentNonce={commentNonce}
            currentUserRole={currentUserRole}
            canEditWalls={canEditWalls}
            canReorderBoards={canReorderBoards}
            // Controlled from here so the menu beside Share and the bottom
            // strip drive one piece of state instead of two.
            roomView={roomView}
            onRoomViewChange={setRoomView}
            canDeleteWalls={canDeleteWalls}
            wallColor={wallColor}
            wallConfigWriter={wallConfigWriter}
            onEditingWallChange={setCurrentWallIndex}
            othersEditingWalls={othersEditingWalls}
            liveChannelRef={liveChannelRef}
            isPresenter={isPresenter}
            isFollowing={isFollowing}
            followPoseRef={followPoseRef}
            laserRef={laserRef}
            laserColor={laserColor}
            followLightboxBoardId={followLightboxBoardId}
            lbViewportRef={lbViewportRef}
            lbCursorRef={lbCursorRef}
            critDirty={critDirty}
            traceStreamRef={traceStreamRef}
            onWallConfigChange={(config, opts) => {
              setWallConfig(config)
              if (opts?.persist === false) {
                // The caller owns this write (wall delete: it awaits its own
                // persist so it can sequence against the board re-index). Drop
                // the pending autosave so a timer armed by an earlier drag can't
                // land a pre-delete config on top of it.
                cancelPendingWallConfigSave()
              } else {
                persistWallConfig(config)
              }
            }}
          />
        </div>
      )}
    </>
  )
}

export default function StudioPage() {
  return (
    <Suspense fallback={null}>
      <StudioPageInner />
    </Suspense>
  )
}