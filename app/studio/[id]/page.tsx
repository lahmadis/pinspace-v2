'use client'

import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useState, useEffect, useRef, useCallback } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { Board } from '@/types'
import ShareModal from '@/components/ShareModal'
import DemoBanner from '@/components/DemoBanner'
import PresenceBar, { type PresentUser } from '@/components/3d/PresenceBar'
import { ArrowLeft, Share2, Settings, Box, ChevronDown } from 'lucide-react'
import { supabase } from '@/lib/supabase/client'
import { toast } from '@/lib/toast'
import type { WallConfig } from '@/lib/wallLayout'

type RealtimeBoardPayload = {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE'
  new: Record<string, unknown>
  old: Record<string, unknown>
}

function transformBoardRow(row: Record<string, unknown>): Board {
  return {
    id: row.id as string,
    studioId: row.workspace_id as string,
    workspaceId: row.workspace_id as string,
    studentName: row.student_name as string,
    studentEmail: row.student_email as string | undefined,
    title: row.title as string,
    description: row.description as string | undefined,
    thumbnailUrl: row.thumbnail_url as string,
    fullImageUrl: row.full_image_url as string,
    tags: (row.tags as string[]) || [],
    uploadedAt: new Date(row.uploaded_at as string),
    position:
      row.position_wall_index != null && row.position_x != null && row.position_y != null
        ? {
            wallIndex: Number(row.position_wall_index),
            x: Number(row.position_x),
            y: Number(row.position_y),
            width: row.position_width != null ? Number(row.position_width) : undefined,
            height: row.position_height != null ? Number(row.position_height) : undefined,
            side: String(row.position_side || '').trim().toLowerCase() === 'back' ? 'back' : 'front',
            rotation: row.position_rotation != null ? Number(row.position_rotation) : 0,
          }
        : undefined,
    position_rotation: row.position_rotation != null ? Number(row.position_rotation) : 0,
    ownerId: row.owner_id as string,
    ownerName: row.owner_name as string,
    ownerColor: row.owner_color as string | undefined,
    originalWidth: row.original_width as number | undefined,
    originalHeight: row.original_height as number | undefined,
    aspectRatio: row.aspect_ratio ? parseFloat(row.aspect_ratio as string) : undefined,
    physicalWidth: row.physical_width ? parseFloat(row.physical_width as string) : undefined,
    physicalHeight: row.physical_height ? parseFloat(row.physical_height as string) : undefined,
  }
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

const DEFAULT_CONFIG: WallConfig = {
  layoutType: 'zigzag',
  walls: [
    { height: 10, width: 8 },
    { height: 10, width: 8 },
    { height: 10, width: 8 },
    { height: 10, width: 8 }
  ],
  customTransforms: [
    { x: -43.90182462935905, z: -93.15280816860862,  rotationY: 0 },
    { x: 1.5,                z: -46.5,               rotationY: 1.5707963267948966 },
    { x: 46.83620060511996,  z: -1.2549356733049677, rotationY: 0 },
    { x: 91.85236286631033,  z: 49.35139735216034,   rotationY: 1.5707963267948966 }
  ]
}

export default function StudioPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const studioId = params.id as string
  
  const [boards, setBoards] = useState<Board[]>([])
  const [showShareModal, setShowShareModal] = useState(false)
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
    // Wall-config remains workspace-scoped (Phase 6.2 leaves it intentionally
    // unchanged). Fall back to studioId only as a safety net during the brief
    // window before workspaceId resolves.
    const wsKey = workspaceId ?? studioId
    const savedConfigKey = `studio-${wsKey}-wall-config`
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
  }, [studioId, workspaceId])

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
      const res = await fetch(`/api/studios/${wsKey}/wall-config`, {
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

        // Wall-config stays keyed by workspace id (the existing
        // /api/studios/[id]/wall-config endpoint expects workspace_id, and
        // localStorage entries from before the URL flip use workspace id too).
        const wallConfigWsId = resolvedWorkspaceId ?? studioId

        let loadedConfig: WallConfig | null = null
        try {
          const resConfig = await fetch(`/api/studios/${wallConfigWsId}/wall-config`, { signal })
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

        // Fallback: localStorage
        if (!loadedConfig) {
          const savedConfigKey = `studio-${wallConfigWsId}-wall-config`
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
            const res = await fetch(`/api/studios/${wallConfigWsId}/wall-config`, {
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
              `studio-${wallConfigWsId}-wall-config`,
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
              if (payload.eventType === 'INSERT') {
                // /api/upload first INSERTs a placeholder row with empty
                // thumbnail_url/full_image_url and upload_status='pending',
                // then UPDATEs it with the real URLs. Picking up the INSERT
                // here would clobber the local state that useBoardState's
                // sync effect already populated from the upload response,
                // forcing a Save&Exit refresh to recover. Skip placeholders;
                // the UPDATE handler below picks up the row when it goes
                // 'pending' → 'complete'.
                const newRow = payload.new as Record<string, unknown>
                if (newRow.upload_status === 'pending') return
                const incoming = transformBoardRow(newRow)
                setBoards((prev) => {
                  // Skip if we already have this board (optimistic upload by this user)
                  if (prev.some((b) => b.id === incoming.id)) return prev
                  return [...prev, incoming]
                })
              } else if (payload.eventType === 'UPDATE') {
                const newRow = payload.new as Record<string, unknown>
                // Still a placeholder — ignore until it goes complete.
                if (newRow.upload_status === 'pending') return
                const updated = transformBoardRow(newRow)
                setBoards((prev) => {
                  const exists = prev.some((b) => b.id === updated.id)
                  if (exists) {
                    return prev.map((b) => (b.id === updated.id ? updated : b))
                  }
                  // 'pending' → 'complete' transition. Other users who never
                  // saw the placeholder get the row here for the first time.
                  return [...prev, updated]
                })
              } else if (payload.eventType === 'DELETE') {
                const deletedId = (payload.old as { id?: string }).id
                if (deletedId) setBoards((prev) => prev.filter((b) => b.id !== deletedId))
              }
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
      if (channel) supabase.removeChannel(channel)
      if (commentsChannel) supabase.removeChannel(commentsChannel)
    }
  }, [studioId, isDemo, retryCount, roomId])

  // Tier 1 presence: track this user on a per-room channel and read who else is
  // here. Separate from the boards channel so the userlist isn't coupled to the
  // boards reconnect/retry budget. Keyed by roomId so each room has its own set.
  useEffect(() => {
    if (isDemo || !roomId) return
    let channel: ReturnType<typeof supabase.channel> | null = null
    let cancelled = false

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

      channel = supabase.channel(`studio-presence:${roomId}`, {
        config: { presence: { key: user.id } },
      })
      channel
        .on('presence', { event: 'sync' }, () => {
          if (!channel) return
          const state = channel.presenceState() as Record<string, Array<{ userId?: string; fullName?: string }>>
          const flat: PresentUser[] = Object.values(state)
            .flat()
            .map((m) => ({ userId: m.userId ?? '', fullName: m.fullName ?? 'Someone' }))
          setPresentUsers(flat)
        })
        .subscribe(async (status: string) => {
          if (status === 'SUBSCRIBED' && channel) {
            await channel.track({ userId: user.id, fullName, joinedAt: Date.now() })
          }
        })
    })()

    return () => {
      cancelled = true
      if (channel) supabase.removeChannel(channel)
      setPresentUsers([])
    }
  }, [roomId, isDemo])

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
            <div className="fixed top-4 left-4 z-40 flex items-center gap-2.5">
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

          {/* Top-right buttons - Hide when in edit mode */}
          {!isEditMode && (
            <div className="fixed top-4 right-4 z-40 flex items-center gap-2.5">
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