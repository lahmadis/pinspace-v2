'use client'

import { useParams, useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase/client'
import dynamic from 'next/dynamic'
import { Board } from '@/types'
import WallConfigModal from '@/components/WallConfigModal'
import ShareModal from '@/components/ShareModal'

const StudioRoom = dynamic(() => import('@/components/3d/StudioRoom'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-screen flex items-center justify-center bg-background">
      <div className="text-center">
        <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary mx-auto mb-4"></div>
        <p className="text-text-muted">Loading 3D Studio...</p>
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
  const studioId = params.id as string
  
  const [boards, setBoards] = useState<Board[]>([])
  const [showWallConfig, setShowWallConfig] = useState(false)
  const [showShareModal, setShowShareModal] = useState(false)
  const [wallConfig, setWallConfig] = useState<WallConfig | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Load boards and wall config (API + localStorage fallback)
  useEffect(() => {
    const loadData = async () => {
      try {
        // Load boards (studioId is actually workspaceId now)
        const response = await fetch(`/api/boards?workspaceId=${studioId}`)
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
      <div className="w-full h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-text-muted">Loading Studio...</p>
        </div>
      </div>
    )
  }

  return (
    <>
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
          {/* Top Left - Logo and Dashboard */}
          <div className="fixed top-4 left-4 z-40 flex items-center gap-3">
            {/* PinSpace Logo - links to home */}
            <button
              onClick={() => router.push('/')}
              className="px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white rounded-lg shadow-lg transition-all font-bold text-lg tracking-tight"
            >
              PinSpace
            </button>

            {/* Back to Dashboard */}
            <button
              onClick={() => router.push('/dashboard')}
              className="px-4 py-2 bg-white hover:bg-gray-100 text-gray-700 rounded-lg shadow-lg border border-gray-200 transition-colors font-medium text-sm flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
                <path d="M10 19l-7-7m0 0l7-7m-7 7h18"></path>
              </svg>
              Dashboard
            </button>
          </div>

          {/* Top-right buttons */}
          <div className="fixed top-4 right-4 z-40 flex items-center gap-3">
            {/* User button */}
            <button
              onClick={() => supabase.auth.signOut().then(() => window.location.href = '/')}
              className="bg-white rounded-lg shadow-lg px-4 py-2 border border-gray-200 hover:bg-gray-50 transition-colors text-sm font-medium"
            >
              Sign Out
            </button>

            {/* Share button */}
            <button
              onClick={() => setShowShareModal(true)}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-lg transition-colors font-medium text-sm flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
                <path d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"></path>
              </svg>
              Share
            </button>
            
            {/* Reconfigure button */}
            <button
              onClick={handleReconfigureWalls}
              className="px-4 py-2 bg-white hover:bg-gray-100 text-gray-700 rounded-lg shadow-lg border border-gray-200 transition-colors font-medium text-sm"
            >
              ⚙️ Reconfigure Walls
            </button>
          </div>

          <StudioRoom 
            studioId={studioId} 
            boards={boards}
            wallConfig={wallConfig}
            onBoardUpdate={handleBoardUpdate}
          />
        </>
      )}
    </>
  )
}