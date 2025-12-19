'use client'

import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase/client'
import dynamic from 'next/dynamic'
import { Board } from '@/types'
import WallConfigModal from '@/components/WallConfigModal'
import ShareModal from '@/components/ShareModal'
import DemoBanner from '@/components/DemoBanner'
import { ArrowLeft, Share2, Settings } from 'lucide-react'

const StudioRoom = dynamic(() => import('@/components/3d/StudioRoom'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-500/20 border-t-indigo-500 mx-auto mb-4"></div>
        <p className="text-gray-600">Loading 3D Studio...</p>
      </div>
    </div>
  ),
})

interface WallDimensions {
  height: number
  width: number
}

type LayoutType = 'zigzag' | 'square' | 'linear' | 'lshape'

interface WallConfig {
  walls: WallDimensions[]
  layoutType: LayoutType
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

  const isDemo = searchParams?.get('demo') === 'true'

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
      const savedConfigKey = `studio-${studioId}-wall-config`
      localStorage.setItem(savedConfigKey, JSON.stringify(config))
    } catch (error) {
      console.error('Failed to save wall config', error)
    }

    setWallConfig(config)
    setShowWallConfig(false)
  }

  const handleReconfigureWalls = () => {
    setShowWallConfig(true)
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
      <div className="w-full h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-500/20 border-t-indigo-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading Studio...</p>
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
        <>
          {/* Top Left - Logo and Dashboard - Hide when in edit mode */}
          {!isEditMode && (
            <div className="fixed top-4 left-4 z-40 flex items-center gap-2.5">
              {/* PinSpace Logo - links to home */}
              <button
                onClick={() => router.push('/')}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-sm transition-colors font-semibold text-base"
              >
                PinSpace
              </button>

              {/* Back to Dashboard */}
              <button
                onClick={() => router.push('/dashboard')}
                className="px-4 py-2 bg-white hover:bg-gray-50 text-gray-700 rounded-lg shadow-sm border border-gray-200 transition-colors font-medium text-sm flex items-center gap-2"
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
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-sm transition-colors font-medium text-sm flex items-center gap-2"
              >
                <Share2 className="w-4 h-4" />
                Share
              </button>
              
              {/* Reconfigure button */}
              <button
                onClick={handleReconfigureWalls}
                className="px-4 py-2 bg-white hover:bg-gray-50 text-gray-700 rounded-lg shadow-sm border border-gray-200 transition-colors font-medium text-sm flex items-center gap-2"
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
          />
        </>
      )}
    </>
  )
}