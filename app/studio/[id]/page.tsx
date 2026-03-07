'use client'

import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase/client'
import dynamic from 'next/dynamic'
import { Board } from '@/types'
import WallConfigModal from '@/components/WallConfigModal'
import ShareModal from '@/components/ShareModal'
import DemoBanner from '@/components/DemoBanner'
import { ArrowLeft, Share2, Settings, Box } from 'lucide-react'

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
  const [isEditMode, setIsEditMode] = useState(false)
  const [floorEditorOpen, setFloorEditorOpen] = useState(false)
  const [floorEditorMode, setFloorEditorMode] = useState<'tables' | 'walls'>('tables')

  const isDemo = searchParams?.get('demo') === 'true'

  const cacheWallConfigLocally = (config: WallConfig) => {
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
  }

  const persistWallConfig = async (config: WallConfig) => {
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
  }

  // Load boards and wall config (API + localStorage fallback)
  useEffect(() => {
    const loadData = async () => {
      try {
        // Load boards (studioId is actually workspaceId now)
        const url = isDemo ? `/api/boards?workspaceId=${studioId}&demo=true` : `/api/boards?workspaceId=${studioId}`
        const response = await fetch(url)
        if (response.ok) {
          const data = await response.json()
          setBoards(data.boards || [])
        }

        // Try API first
        let loadedConfig: WallConfig | null = null
        try {
          const resConfig = await fetch(`/api/studios/${studioId}/wall-config`)
          if (resConfig.ok) {
            const data = await resConfig.json()
            if (data?.config) {
              loadedConfig = data.config
            }
          }
        } catch (e) {
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
        console.error('Error loading data:', error)
        setShowWallConfig(true)
      } finally {
        setIsLoading(false)
      }
    }

    loadData()
  }, [studioId])

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

  return (
    <>
      <DemoBanner />
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
              <button
                onClick={() => { setFloorEditorMode('tables'); setFloorEditorOpen(true) }}
                className="px-4 py-2.5 bg-white/10 hover:bg-white/20 backdrop-blur-md text-white rounded-xl shadow-lg border border-white/20 transition-all duration-300 font-medium text-sm flex items-center gap-2"
              >
                <Box className="w-4 h-4" />
                Place 3D model
              </button>

              {/* Reconfigure button */}
              <button
                onClick={handleReconfigureWalls}
                className="px-4 py-2.5 bg-white/10 hover:bg-white/20 backdrop-blur-md text-white rounded-xl shadow-lg border border-white/20 transition-all duration-300 font-medium text-sm flex items-center gap-2"
              >
                <Settings className="w-4 h-4" />
                Reconfigure Walls
              </button>
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