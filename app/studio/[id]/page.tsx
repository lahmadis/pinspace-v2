'use client'

import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useState, useEffect, useRef, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { Board } from '@/types'
import WallConfigModal from '@/components/WallConfigModal'
import ShareModal from '@/components/ShareModal'
import DemoBanner from '@/components/DemoBanner'
import { ArrowLeft, Share2, Settings, Box } from 'lucide-react'
import { supabase } from '@/lib/supabase/client'
import { toast } from '@/lib/toast'

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
          }
        : undefined,
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

interface WallDimensions {
  height: number
  width: number
}

type LayoutType = 'zigzag' | 'square' | 'linear' | 'lshape'

interface WallTransformOverride {
  x: number
  z: number
  rotationY: number
}

interface WallConfig {
  walls: WallDimensions[]
  layoutType: LayoutType
  customTransforms?: WallTransformOverride[]
}

const DEFAULT_CONFIG: WallConfig = {
  layoutType: 'zigzag',
  walls: [
    { height: 10, width: 8 },
    { height: 10, width: 8 },
    { height: 10, width: 8 },
    { height: 10, width: 8 }
  ]
}

export default function StudioPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const studioId = params.id as string
  
  const [boards, setBoards] = useState<Board[]>([])
  const [showWallConfig, setShowWallConfig] = useState(false)
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

  const isDemo = searchParams?.get('demo') === 'true'

  // Wall-config persistence: debounce network writes so a drag at 60fps doesn't fire 60 POSTs/sec.
  // Local UI state still updates immediately; only the fetch is throttled.
  const wallPersistTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wallPersistLatestRef = useRef<WallConfig | null>(null)

  const cacheWallConfigLocally = useCallback((config: WallConfig) => {
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

  const flushWallConfig = useCallback(async () => {
    const config = wallPersistLatestRef.current
    if (!config) return
    wallPersistLatestRef.current = null
    try {
      await fetch(`/api/studios/${studioId}/wall-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      cacheWallConfigLocally(config)
    } catch (e) {
      console.error('Failed to save wall config', e)
    }
  }, [studioId, cacheWallConfigLocally])

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
        // Load boards (studioId is actually workspaceId now)
        const url = isDemo ? `/api/boards?workspaceId=${studioId}&demo=true` : `/api/boards?workspaceId=${studioId}`
        const response = await fetch(url, { signal })
        if (response.ok) {
          const data = await response.json()
          setBoards(data.boards || [])
          setBoardsError(false)
        } else {
          setBoardsError(true)
        }

        // Fetch workspace metadata to get archive status
        if (!isDemo) {
          try {
            const wsRes = await fetch(`/api/workspaces/${studioId}`, { signal })
            if (wsRes.ok) {
              const wsData = await wsRes.json()
              setIsArchived(Boolean(wsData.workspace?.isArchived))
            }
          } catch {
            // Non-fatal: archive status is best-effort
          }
        }

        // Try API first
        let loadedConfig: WallConfig | null = null
        try {
          const resConfig = await fetch(`/api/studios/${studioId}/wall-config`, { signal })
          if (resConfig.ok) {
            const data = await resConfig.json()
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
          const savedConfigKey = `studio-${studioId}-wall-config`
          const savedConfig = localStorage.getItem(savedConfigKey)
          if (savedConfig) {
            loadedConfig = JSON.parse(savedConfig)
          }
        }

        if (loadedConfig) {
          setWallConfig(loadedConfig)
          setShowWallConfig(false)
        } else {
          // No saved config, show modal
          setShowWallConfig(true)
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

    const channel = isDemo
      ? null
      : supabase
          .channel(`studio-boards:${studioId}`)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'boards', filter: `workspace_id=eq.${studioId}` },
            (payload: RealtimeBoardPayload) => {
              if (payload.eventType === 'INSERT') {
                const incoming = transformBoardRow(payload.new as Record<string, unknown>)
                setBoards((prev) => {
                  // Skip if we already have this board (optimistic upload by this user)
                  if (prev.some((b) => b.id === incoming.id)) return prev
                  return [...prev, incoming]
                })
              } else if (payload.eventType === 'UPDATE') {
                const updated = transformBoardRow(payload.new as Record<string, unknown>)
                setBoards((prev) => prev.map((b) => (b.id === updated.id ? updated : b)))
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
  }, [studioId, isDemo, retryCount])

  const handleWallConfigConfirm = async (config: WallConfig) => {
    try {
      await fetch(`/api/studios/${studioId}/wall-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      cacheWallConfigLocally(config)
    } catch (error) {
      console.error('Failed to save wall config', error)
    }

    setWallConfig(config)
    setShowWallConfig(false)
  }

  const handleReconfigureWalls = () => {
    setFloorEditorMode('walls')
    setFloorEditorOpen(true)
  }

  const handleBoardUpdate = async () => {
    // Reload boards after update
    try {
      const response = await fetch(`/api/boards?studioId=${studioId}`)
      if (response.ok) {
        const data = await response.json()
        const studioBoards = data.boards.filter((b: Board) => b.studioId === studioId)
        setBoards(studioBoards)
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
      {/* Mobile warning — 3D canvas requires a desktop browser */}
      <div className="md:hidden fixed inset-0 z-[9999] bg-gray-900 flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <p className="text-4xl mb-4">🖥️</p>
          <h2 className="text-white text-xl font-bold mb-2">Desktop required</h2>
          <p className="text-gray-400 text-sm">The 3D studio editor requires a desktop browser. Please visit on a laptop or desktop computer.</p>
        </div>
      </div>
      <DemoBanner />
      {/* Archive banner */}
      {isArchived && (
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-indigo-600 text-white text-sm font-medium text-center py-2 px-4">
          This workspace is archived. View only.
        </div>
      )}
      {showWallConfig && (
        <WallConfigModal
          onConfirm={handleWallConfigConfirm}
          initialConfig={wallConfig || DEFAULT_CONFIG}
        />
      )}

      {showShareModal && (
        <ShareModal
          studioId={studioId}
          onClose={() => setShowShareModal(false)}
        />
      )}

      {!showWallConfig && wallConfig && (
        <div className="relative w-full h-screen overflow-hidden" style={{ background: '#B3B3FF' }}>
          {/* Animated gradient background effects */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="absolute -top-40 -right-40 w-96 h-96 rounded-full blur-3xl animate-pulse" style={{ backgroundColor: 'rgba(102, 102, 255, 0.2)' }}></div>
            <div className="absolute -bottom-40 -left-40 w-96 h-96 rounded-full blur-3xl animate-pulse" style={{ backgroundColor: 'rgba(102, 102, 255, 0.2)', animationDelay: '1s' }}></div>
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full blur-3xl" style={{ backgroundColor: 'rgba(102, 102, 255, 0.1)' }}></div>
          </div>

          {/* Top Left - Logo and Dashboard - Hide when in edit mode */}
          {!isEditMode && (
            <div className="fixed top-4 left-4 z-40 flex items-center gap-2.5">
              {/* PinSpace Logo - links to home */}
              <button
                onClick={() => router.push('/')}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl shadow-lg shadow-blue-500/30 transition-all duration-300 font-semibold text-base backdrop-blur-sm border border-white/10"
              >
                PinSpace
              </button>

              {/* Back to Dashboard */}
              <button
                onClick={() => router.push('/dashboard')}
                className="px-4 py-2.5 bg-white/10 hover:bg-white/20 backdrop-blur-md text-white rounded-xl shadow-lg border border-white/20 transition-all duration-300 font-medium text-sm flex items-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                Dashboard
              </button>
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
            boards={boards}
            wallConfig={wallConfig}
            onBoardUpdate={handleBoardUpdate}
            onEditModeChange={setIsEditMode}
            floorEditorOpen={floorEditorOpen}
            onFloorEditorOpenChange={setFloorEditorOpen}
            floorEditorMode={floorEditorMode}
            isArchived={isArchived}
            commentNonce={commentNonce}
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