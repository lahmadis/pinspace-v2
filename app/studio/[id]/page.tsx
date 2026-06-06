'use client'

import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { Board } from '@/types'
import ShareModal from '@/components/ShareModal'
import DemoBanner from '@/components/DemoBanner'
import PresenceBar, { type PresentUser, friendlyName, colorFor } from '@/components/3d/PresenceBar'
import type { FollowPose, LaserState, LbViewport, LbCursorState } from '@/components/3d/CameraController'
import { ArrowLeft, Share2, Settings, Box, ChevronDown, Menu, X, Presentation } from 'lucide-react'
import { supabase, isSupabaseConfigured } from '@/lib/supabase/client'
import { toast } from '@/lib/toast'
import { DEFAULT_WALL_CONFIG, type WallConfig } from '@/lib/wallLayout'

type RealtimeBoardPayload = {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE'
  new: Record<string, unknown>
  old: Record<string, unknown>
}

// TEMP diagnostic — always-on tracing of the realtime boards channel, the
// upstream writer that feeds props.boards -> useBoardState parent-sync.
const postrace = (...args: unknown[]) => {
  // eslint-disable-next-line no-console
  console.log('[POSTRACE]', new Date().toISOString(), ...args)
}

const StudioRoom = dynamic(
  () => import(/* webpackChunkName: "StudioRoom" */ '@/components/3d/StudioRoom'),
  {
    ssr: false,
    loading: () => (
    <div className="w-full h-screen flex items-center justify-center" style={{ background: '#B3B3FF' }}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-white/20 border-t-white mx-auto mb-4"></div>
          <p className="text-white/90 font-medium">Loading 3D Studio...</p>
        </div>
    </div>
  ),
})

const DEFAULT_CONFIG = DEFAULT_WALL_CONFIG

export default function StudioPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const studioId = params.id as string
  
  const [boards, setBoards] = useState<Board[]>([])
  const [showShareModal, setShowShareModal] = useState(false)
  // Phone-only collapsed toolbar — see the hamburger panel rendered below
  // sm. Desktop toolbar stays uncontrolled.
  const [showStudioMenu, setShowStudioMenu] = useState(false)
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
  const [currentRoomName, setCurrentRoomName] = useState<string | null>(null)
  const [allRooms, setAllRooms] = useState<Array<{ id: string; name: string }>>([])
  const [showRoomSwitcher, setShowRoomSwitcher] = useState(false)
  const [currentUserRole, setCurrentUserRole] = useState<'instructor' | 'student' | null>(null)
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

  const isDemo = searchParams?.get('demo') === 'true'

  // Tier 2 optimistic-concurrency: the version the local wallConfig is based on.
  // A ref (not state) so save callbacks always read the freshest value without
  // re-creating and without stale-closure risk. Bumped on every successful save;
  // adopted from the server on load and on a 409 reload.
  const wallVersionRef = useRef<number>(0)

  // Clear stale wall config whenever the room changes so the previous room's
  // layout is never visible while the new room's config is loading.
  useEffect(() => {
    setWallConfig(null)
  }, [studioId])

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

  // 409 handler: a save was rejected as stale. Adopt the server's latest config
  // (strip the embedded version back out so wallConfig stays clean), update the
  // base version, and tell the user their unsaved changes were discarded.
  const handleWallConfigConflict = useCallback(
    (latest: Record<string, unknown> & { version?: number }) => {
      const { version, ...config } = latest
      if (typeof version === 'number') wallVersionRef.current = version
      const nextConfig = config as unknown as WallConfig
      setWallConfig(nextConfig)
      cacheWallConfigLocally(nextConfig)
      toast.error("Room layout was updated by another user. Reloaded latest — your changes weren't saved.")
    },
    [cacheWallConfigLocally]
  )

  const flushWallConfig = useCallback(async () => {
    const config = wallPersistLatestRef.current
    if (!config) return
    wallPersistLatestRef.current = null
    const wsKey = workspaceId ?? studioId
    try {
      const res = await fetch(`/api/studios/${wsKey}/wall-config?roomId=${encodeURIComponent(studioId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseVersion: wallVersionRef.current, config }),
      })
      if (res.status === 409) {
        const data = await res.json().catch(() => ({} as { latest?: Record<string, unknown> & { version?: number } }))
        if (data.latest) handleWallConfigConflict(data.latest)
        return
      }
      if (res.ok) {
        const data = await res.json().catch(() => ({} as { version?: number }))
        if (typeof data.version === 'number') wallVersionRef.current = data.version
        cacheWallConfigLocally(config)
      }
    } catch (e) {
      console.error('Failed to save wall config', e)
    }
  }, [studioId, workspaceId, cacheWallConfigLocally, handleWallConfigConflict])

  const persistWallConfig = useCallback((config: WallConfig) => {
    wallPersistLatestRef.current = config
    if (wallPersistTimeoutRef.current) clearTimeout(wallPersistTimeoutRef.current)
    wallPersistTimeoutRef.current = setTimeout(() => {
      wallPersistTimeoutRef.current = null
      flushWallConfig()
    }, 500)
  }, [flushWallConfig])

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
        const wsIdForFetch = resolvedWorkspaceId
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
              // Resolve current user's role from workspace members list
              const { data: { session: authSession } } = await supabase.auth.getSession()
              const myUserId = authSession?.user?.id
              if (myUserId && Array.isArray(ws?.members)) {
                const myMember = (ws.members as Array<{ userId: string; role: string }>).find(
                  (m) => m.userId === myUserId
                )
                setCurrentUserRole((myMember?.role as 'instructor' | 'student') ?? null)
              }
            }
          } catch {
            // Non-fatal: breadcrumb + archive status are best-effort
          }
        }

        // Phase 2a: wall-config is now per-room. The endpoint path segment is
        // still the workspace id (for the auth check); the room id is appended
        // as a query param so the route reads/writes the per-room blob. If a
        // per-room blob doesn't exist yet, the endpoint falls back to the
        // legacy workspace blob so existing rooms keep their current config.
        const wallConfigWsId = resolvedWorkspaceId ?? studioId
        const wallConfigUrl = `/api/studios/${wallConfigWsId}/wall-config?roomId=${encodeURIComponent(studioId)}`

        let loadedConfig: WallConfig | null = null
        try {
          const resConfig = await fetch(wallConfigUrl, { signal })
          if (resConfig.ok) {
            const data = await resConfig.json()
            // Capture the base version so the first save sends the right
            // baseVersion. Falls back to 0 (legacy blob / localStorage path).
            if (typeof data?.version === 'number') wallVersionRef.current = data.version
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

        if (loadedConfig) {
          setWallConfig(loadedConfig)
        } else {
          // First entry: silently persist defaults so subsequent loads just read them.
          setWallConfig(DEFAULT_CONFIG)
          try {
            const res = await fetch(wallConfigUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ baseVersion: 0, config: DEFAULT_CONFIG }),
              signal,
            })
            if (res.status === 409) {
              // Another user created this room's config first (simultaneous
              // first-entry). Silently adopt theirs — no toast: nobody made a
              // real edit yet, and both wrote identical defaults anyway.
              const data = await res.json().catch(() => ({} as { latest?: Record<string, unknown> & { version?: number } }))
              if (data.latest) {
                const { version, ...cfg } = data.latest
                if (typeof version === 'number') wallVersionRef.current = version
                setWallConfig(cfg as unknown as WallConfig)
              }
            } else if (res.ok) {
              const data = await res.json().catch(() => ({} as { version?: number }))
              if (typeof data.version === 'number') wallVersionRef.current = data.version
            }
          } catch (e) {
            if (!signal.aborted) console.warn('Failed to persist default wall config', e)
          }
          try {
            localStorage.setItem(
              `studio-${studioId}-wall-config`,
              JSON.stringify(DEFAULT_CONFIG)
            )
          } catch {
            // localStorage cache is best-effort; API is source of truth.
          }
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
                postrace('realtime DELETE -> parent setBoards FILTER', deletedId)
                if (deletedId) setBoards((prev) => prev.filter((b) => b.id !== deletedId))
                return
              }
              // INSERT/UPDATE: coalesce a burst (the INSERT-then-PUT pair, and
              // multi-page PDF uploads) into a single ~400ms-debounced refetch.
              if (boardsRefetchTimerRef.current) clearTimeout(boardsRefetchTimerRef.current)
              boardsRefetchTimerRef.current = setTimeout(() => {
                boardsRefetchTimerRef.current = null
                void handleBoardUpdate()
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
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
      liveChannelRef.current = null
      followPoseRef.current = null
      laserRef.current = null
      lbViewportRef.current = null
      lbCursorRef.current = null
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

  // Phase B.1: toggle the local user's presenter flag. Updates the meta ref
  // (so wall re-tracks preserve it) and re-tracks in place on the existing
  // channel — the same pattern as the wall-index change, no channel teardown.
  // No-op until presence is subscribed (and never fires in demo, where the
  // presence effect returns early and the refs stay null/false).
  const setPresenting = useCallback((value: boolean) => {
    const meta = presenceMetaRef.current
    if (!meta) return
    presenceMetaRef.current = { ...meta, isPresenting: value }
    const ch = presenceChannelRef.current
    if (ch && presenceSubscribedRef.current) {
      ch.track({
        ...presenceMetaRef.current,
        joinedAt: Date.now(),
        currentWallIndex: currentWallIndexRef.current,
      })
    }
  }, [])

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

  const handleReconfigureWalls = () => {
    setFloorEditorMode('walls')
    setFloorEditorOpen(true)
  }

  const handleBoardUpdate = async () => {
    // Reload boards after update — scoped to the room, not the workspace.
    try {
      const response = await fetch(`/api/boards?roomId=${studioId}`)
      if (response.ok) {
        const data = await response.json()
        setBoards(data.boards || [])
      }
    } catch (error) {
      console.error('Error reloading boards:', error)
    }
  }

  if (isLoading) {
    return (
      <div className="w-full h-screen flex items-center justify-center" style={{ background: '#B3B3FF' }}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-white/20 border-t-white mx-auto mb-4"></div>
          <p className="text-white/90 font-medium">Loading Studio...</p>
        </div>
      </div>
    )
  }

  if (boardsError) {
    return (
      <div className="w-full h-screen flex items-center justify-center" style={{ background: '#B3B3FF' }}>
        <div className="text-center">
          <p className="text-white font-semibold text-lg mb-2">Failed to load boards</p>
          <p className="text-white/70 text-sm mb-6">Check your connection and try again.</p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => { setBoardsError(false); setIsLoading(true); setRetryCount(c => c + 1) }}
              className="px-5 py-2 bg-white text-indigo-600 rounded-lg font-medium hover:bg-white/90 transition-colors"
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
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-indigo-600 text-white text-sm font-medium text-center py-2 px-4">
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
        <div className="relative w-full h-screen overflow-hidden" style={{ background: '#B3B3FF' }}>
          {/* Animated gradient background effects */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="absolute -top-40 -right-40 w-96 h-96 rounded-full blur-3xl animate-pulse" style={{ backgroundColor: 'rgba(102, 102, 255, 0.2)' }}></div>
            <div className="absolute -bottom-40 -left-40 w-96 h-96 rounded-full blur-3xl animate-pulse" style={{ backgroundColor: 'rgba(102, 102, 255, 0.2)', animationDelay: '1s' }}></div>
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full blur-3xl" style={{ backgroundColor: 'rgba(102, 102, 255, 0.1)' }}></div>
          </div>

          {/* Top Left - Logo and breadcrumb. Hidden in wall edit mode. */}
          {!isEditMode && (
            // Same flex-wrap/max-w pattern as the right toolbar so a long
            // workspace + room breadcrumb pill drops to a second line on
            // narrow viewports instead of running off the right edge.
            <div className="fixed top-4 left-4 z-40 flex flex-wrap items-center gap-2.5 max-w-[calc(100vw-2rem)] sm:flex-nowrap sm:max-w-none">
              {/* PinSpace Logo - links to home */}
              <button
                onClick={() => router.push('/')}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl shadow-lg shadow-blue-500/30 transition-all duration-300 font-semibold text-base backdrop-blur-sm border border-white/10"
              >
                PinSpace
              </button>

              {/* Phase 6.2: breadcrumb + room switcher. Workspace name links
                  back to the rooms list page; room name opens a dropdown
                  listing the other rooms in the same workspace. Falls back
                  to a plain "← Dashboard" button while metadata is loading
                  or in demo mode (no workspace context). */}
              {workspaceName && workspaceId ? (
                <div className="px-3 py-2 bg-white/10 hover:bg-white/15 backdrop-blur-md text-white rounded-xl shadow-lg border border-white/20 transition-colors flex items-center gap-2 text-sm font-medium relative">
                  <button
                    onClick={() => router.push(`/workspace/${workspaceId}`)}
                    className="hover:underline"
                    aria-label={`Back to ${workspaceName} rooms list`}
                  >
                    {workspaceName}
                  </button>
                  <span className="text-white/50">/</span>
                  <button
                    onClick={() => setShowRoomSwitcher((v) => !v)}
                    disabled={allRooms.length <= 1}
                    className="flex items-center gap-1 disabled:cursor-default"
                    aria-label="Switch room"
                    aria-expanded={showRoomSwitcher}
                  >
                    <span>{currentRoomName ?? '…'}</span>
                    {allRooms.length > 1 && (
                      <ChevronDown className={`w-4 h-4 transition-transform ${showRoomSwitcher ? 'rotate-180' : ''}`} />
                    )}
                  </button>

                  {showRoomSwitcher && allRooms.length > 1 && (
                    <div
                      className="absolute left-0 top-full mt-2 w-56 bg-white text-gray-900 rounded-xl shadow-2xl border border-gray-200 overflow-hidden z-50"
                      onMouseLeave={() => setShowRoomSwitcher(false)}
                    >
                      <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-100">
                        Rooms in {workspaceName}
                      </div>
                      <ul className="py-1">
                        {allRooms.map((r) => {
                          const isCurrent = r.id === roomId
                          return (
                            <li key={r.id}>
                              {isCurrent ? (
                                <div className="px-3 py-2 text-sm bg-indigo-50 text-indigo-700 font-medium flex items-center justify-between">
                                  <span>{r.name}</span>
                                  <span className="text-xs">current</span>
                                </div>
                              ) : (
                                <button
                                  onClick={() => {
                                    setShowRoomSwitcher(false)
                                    router.push(`/studio/${r.id}`)
                                  }}
                                  className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
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
                          className="block px-3 py-2 text-sm text-indigo-700 hover:bg-indigo-50 font-medium"
                        >
                          See all rooms →
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
              Phones get the hamburger panel right below; the `hidden sm:flex`
              switch swaps the two without changing handlers. */}
          {!isEditMode && (
            <div className="hidden sm:flex fixed top-4 right-4 z-40 flex-nowrap justify-end items-center gap-2.5">
              {/* Share button */}
              <button
                onClick={() => setShowShareModal(true)}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl shadow-lg shadow-blue-500/30 transition-all duration-300 font-medium text-sm flex items-center gap-2 backdrop-blur-sm border border-white/10"
              >
                <Share2 className="w-4 h-4" />
                Share
              </button>

              {/* Place 3D model - open floor editor to add tables and upload/position models */}
              {!isArchived && (
                <button
                  onClick={() => { setFloorEditorMode('tables'); setFloorEditorOpen(true) }}
                  className="px-4 py-2.5 bg-white/10 hover:bg-white/20 backdrop-blur-md text-white rounded-xl shadow-lg border border-white/20 transition-all duration-300 font-medium text-sm flex items-center gap-2"
                >
                  <Box className="w-4 h-4" />
                  Place 3D model
                </button>
              )}

              {/* Reconfigure button */}
              {!isArchived && (
                <button
                  onClick={handleReconfigureWalls}
                  className="px-4 py-2.5 bg-white/10 hover:bg-white/20 backdrop-blur-md text-white rounded-xl shadow-lg border border-white/20 transition-all duration-300 font-medium text-sm flex items-center gap-2"
                >
                  <Settings className="w-4 h-4" />
                  Reconfigure Walls
                </button>
              )}

              {/* Present toggle (Phase B.1). Three states: nobody presenting →
                  "Present"; you are presenter → "Stop presenting"; someone else
                  presenting → disabled "{name} is presenting". Hidden in demo
                  (presence is inert there). */}
              {!isDemo && (
                <button
                  onClick={() => setPresenting(!isPresenter)}
                  disabled={someoneElsePresenting}
                  className={`px-4 py-2.5 backdrop-blur-md text-white rounded-xl shadow-lg border border-white/20 transition-all duration-300 font-medium text-sm flex items-center gap-2 ${
                    someoneElsePresenting
                      ? 'bg-white/5 opacity-60 cursor-not-allowed'
                      : isPresenter
                        ? 'bg-blue-600 hover:bg-blue-500'
                        : 'bg-white/10 hover:bg-white/20'
                  }`}
                >
                  <Presentation className="w-4 h-4" />
                  {someoneElsePresenting
                    ? `${friendlyName(presenter!.fullName)} is presenting`
                    : isPresenter
                      ? 'Stop presenting'
                      : 'Present'}
                </button>
              )}
            </div>
          )}

          {/* Phone-only toolbar (< sm) — collapses Share, Place 3D model, and
              Reconfigure Walls into a single hamburger so the buttons don't
              cover the 3D view. Each menu item calls the same handler as its
              desktop counterpart, then closes the menu. Top-left logo +
              workspace/room breadcrumb stay visible because they carry the
              "where am I" context. */}
          {!isEditMode && (
            <div className="sm:hidden fixed top-4 right-4 z-40">
              <button
                onClick={() => setShowStudioMenu((v) => !v)}
                aria-label={showStudioMenu ? 'Close studio menu' : 'Open studio menu'}
                aria-expanded={showStudioMenu}
                className="p-2.5 bg-white/10 hover:bg-white/20 backdrop-blur-md text-white rounded-xl shadow-lg border border-white/20 transition-colors"
              >
                {showStudioMenu ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
              {showStudioMenu && (
                <>
                  {/* Tap-outside backdrop — sits under the panel, above the
                      canvas; pointer-events catches the tap and closes. */}
                  <div
                    className="fixed inset-0 z-[-1]"
                    onClick={() => setShowStudioMenu(false)}
                  />
                  <div
                    className="absolute right-0 top-full mt-2 w-56 bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden"
                    role="menu"
                  >
                    <button
                      role="menuitem"
                      onClick={() => { setShowStudioMenu(false); setShowShareModal(true) }}
                      className="w-full text-left px-4 py-3 text-sm font-medium text-gray-900 hover:bg-gray-50 flex items-center gap-2"
                    >
                      <Share2 className="w-4 h-4 text-blue-600" />
                      Share
                    </button>
                    {!isArchived && (
                      <button
                        role="menuitem"
                        onClick={() => { setShowStudioMenu(false); setFloorEditorMode('tables'); setFloorEditorOpen(true) }}
                        className="w-full text-left px-4 py-3 text-sm font-medium text-gray-900 hover:bg-gray-50 flex items-center gap-2 border-t border-gray-100"
                      >
                        <Box className="w-4 h-4 text-indigo-600" />
                        Place 3D model
                      </button>
                    )}
                    {!isArchived && (
                      <button
                        role="menuitem"
                        onClick={() => { setShowStudioMenu(false); handleReconfigureWalls() }}
                        className="w-full text-left px-4 py-3 text-sm font-medium text-gray-900 hover:bg-gray-50 flex items-center gap-2 border-t border-gray-100"
                      >
                        <Settings className="w-4 h-4 text-indigo-600" />
                        Reconfigure Walls
                      </button>
                    )}
                    {/* Present toggle (Phase B.1) — same three states as the
                        desktop button. Disabled when another user is presenting. */}
                    {!isDemo && (
                      <button
                        role="menuitem"
                        onClick={() => { if (!someoneElsePresenting) { setShowStudioMenu(false); setPresenting(!isPresenter) } }}
                        disabled={someoneElsePresenting}
                        className={`w-full text-left px-4 py-3 text-sm font-medium flex items-center gap-2 border-t border-gray-100 ${
                          someoneElsePresenting
                            ? 'text-gray-400 cursor-not-allowed'
                            : 'text-gray-900 hover:bg-gray-50'
                        }`}
                      >
                        <Presentation className="w-4 h-4 text-blue-600" />
                        {someoneElsePresenting
                          ? `${friendlyName(presenter!.fullName)} is presenting`
                          : isPresenter
                            ? 'Stop presenting'
                            : 'Present'}
                      </button>
                    )}
                  </div>
                </>
              )}
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
            isArchived={isArchived}
            commentNonce={commentNonce}
            currentUserRole={currentUserRole}
            wallVersionRef={wallVersionRef}
            onWallConfigConflict={handleWallConfigConflict}
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
            onWallConfigChange={(config) => {
              setWallConfig(config)
              persistWallConfig(config)
            }}
          />
        </div>
      )}
    </>
  )
}