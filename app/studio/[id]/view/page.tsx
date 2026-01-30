'use client'

import { useEffect, useState } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, PerspectiveCamera } from '@react-three/drei'
import { supabase } from '@/lib/supabase/client'
import { Board, FloorTable } from '@/types'
import WallSystem from '@/components/3d/WallSystem'
import TableWithModel from '@/components/3d/TableWithModel'
import ModelViewer from '@/components/3d/ModelViewer'
import LightboxModal from '@/components/LightboxModal'
import DemoBanner from '@/components/DemoBanner'
import { addDemoParam } from '@/lib/demoMode'
import { ArrowLeft } from 'lucide-react'

interface WallDimensions {
  height: number
  width: number
}

interface WallConfig {
  walls: WallDimensions[]
  layoutType: 'zigzag' | 'square' | 'linear' | 'lshape'
}

export default function StudioViewPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const studioId = params.id as string
  
  // Check if it's a demo studio (starts with "demo-studio-") or has demo=true param
  const isDemoStudio = studioId.startsWith('demo-studio-')
  const isDemo = searchParams?.get('demo') === 'true' || isDemoStudio
  const [boards, setBoards] = useState<Board[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedBoard, setSelectedBoard] = useState<Board | null>(null)
  const [wallConfig, setWallConfig] = useState<WallConfig | null>(null)
  const [modelViewerUrl, setModelViewerUrl] = useState<string | null>(null)

  // Tables from wall config (floor tables with 3D models) – strip blob URLs
  const tables: FloorTable[] = (() => {
    const raw = (wallConfig as { tables?: FloorTable[] })?.tables
    const list = Array.isArray(raw) ? raw : []
    return list.map((t) => ({
      ...t,
      modelUrl: t.modelUrl?.startsWith('blob:') ? undefined : t.modelUrl,
    }))
  })()

  // Load wall config
  useEffect(() => {
    const loadWallConfig = async () => {
      try {
        // Try API first - include demo param if in demo mode
        const configUrl = isDemo 
          ? `/api/studios/${studioId}/wall-config?demo=true`
          : `/api/studios/${studioId}/wall-config`
        const resConfig = await fetch(configUrl)
        if (resConfig.ok) {
          const data = await resConfig.json()
          if (data?.config) {
            setWallConfig(data.config)
            return
          }
        }
      } catch (e) {
        console.warn('Wall config API fetch failed, falling back to localStorage', e)
      }

      // Fallback: localStorage
      const savedConfigKey = `studio-${studioId}-wall-config`
      const savedConfig = localStorage.getItem(savedConfigKey)
      if (savedConfig) {
        setWallConfig(JSON.parse(savedConfig))
      } else {
        // Default config
        setWallConfig({
          walls: [
            { height: 10, width: 8 },
            { height: 10, width: 8 },
            { height: 10, width: 8 },
            { height: 10, width: 8 }
          ],
          layoutType: 'zigzag'
        })
      }
    }
    loadWallConfig()
  }, [studioId])

  useEffect(() => {
    fetchBoards()
  }, [studioId, isDemo])
  
  // Open board from URL query param after boards are loaded
  useEffect(() => {
    const boardIdFromUrl = searchParams.get('boardId')
    if (boardIdFromUrl && boards.length > 0) {
      console.log('🔍 [View Mode] Looking for board with ID:', boardIdFromUrl)
      console.log('📋 [View Mode] Available boards:', boards.map(b => ({ id: b.id, title: b.title })))
      const boardToOpen = boards.find(b => b.id === boardIdFromUrl)
      if (boardToOpen) {
        // Only update if it's a different board
        if (!selectedBoard || selectedBoard.id !== boardToOpen.id) {
          console.log('✅ [View Mode] Found and opening board:', boardToOpen.title, boardToOpen.id)
          setSelectedBoard(boardToOpen)
        }
      } else {
        console.warn('⚠️ [View Mode] Board not found with ID:', boardIdFromUrl)
        // Clear selection if board not found
        if (selectedBoard) {
          setSelectedBoard(null)
        }
      }
    } else if (!boardIdFromUrl && selectedBoard) {
      // Clear selection if no boardId in URL
      setSelectedBoard(null)
    }
  }, [boards, searchParams])

  const fetchBoards = async () => {
    try {
      setLoading(true)
      setError(null)
      // Always include demo=true for demo studios, even if not in URL params
      const url = isDemo 
        ? `/api/boards?workspaceId=${studioId}&demo=true` 
        : `/api/boards?workspaceId=${studioId}`
      console.log('🔍 [View Mode] Fetching boards from:', url, 'isDemo:', isDemo)
      const response = await fetch(url)
      
      if (!response.ok) {
        throw new Error('Failed to fetch boards')
      }
      
      const data = await response.json()
      setBoards(data.boards || [])
      console.log('📖 [View Mode] Loaded', data.boards?.length || 0, 'boards for studio', studioId)
    } catch (err) {
      console.error('Error fetching boards:', err)
      setError('Failed to load boards')
    } finally {
      setLoading(false)
    }
  }

  const handleBoardClick = (board: Board) => {
    console.log('🖱️ [View Mode] Board clicked:', board.id)
    setSelectedBoard(board)
  }

  const handleNavigate = (direction: 'prev' | 'next') => {
    if (!selectedBoard) return
    
    const currentIndex = boards.findIndex(b => b.id === selectedBoard.id)
    let newIndex: number
    
    if (direction === 'prev') {
      newIndex = currentIndex - 1
    } else {
      newIndex = currentIndex + 1
    }
    
    if (newIndex >= 0 && newIndex < boards.length) {
      setSelectedBoard(boards[newIndex])
      console.log('🖱️ [View Mode] Navigated to board:', boards[newIndex].id)
    }
  }

  if (loading) {
    return (
      <div className="w-full h-screen flex items-center justify-center" style={{ background: '#B3B3FF' }}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-4 border-white/20 border-t-white mx-auto mb-4"></div>
          <p className="text-white/90 font-medium">Loading studio...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="w-full h-screen flex items-center justify-center" style={{ background: '#B3B3FF' }}>
        <div className="text-center max-w-md p-8 bg-white/95 rounded-xl shadow-lg">
          <div className="text-6xl mb-4">😕</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Oops!</h2>
          <p className="text-gray-600 mb-6">{error}</p>
          <button 
            onClick={() => window.location.reload()}
            className="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium"
          >
            Try Again
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="relative w-full h-screen overflow-hidden" style={{ background: '#B3B3FF' }}>
      <DemoBanner />

      {/* Animated gradient background effects (match studio room page) */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 rounded-full blur-3xl animate-pulse" style={{ backgroundColor: 'rgba(102, 102, 255, 0.2)' }}></div>
        <div className="absolute -bottom-40 -left-40 w-96 h-96 rounded-full blur-3xl animate-pulse" style={{ backgroundColor: 'rgba(102, 102, 255, 0.2)', animationDelay: '1s' }}></div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full blur-3xl" style={{ backgroundColor: 'rgba(102, 102, 255, 0.1)' }}></div>
      </div>

      {/* Top Left - Logo and Back (match studio room chrome, but back to network/gallery) */}
      <div className="fixed top-4 left-4 z-40 flex items-center gap-2.5">
        <button
          onClick={() => router.push('/')}
          className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl shadow-lg shadow-blue-500/30 transition-all duration-300 font-semibold text-base backdrop-blur-sm border border-white/10"
        >
          PinSpace
        </button>

        <button
          onClick={() => {
            const base = searchParams.get('returnTo') === 'gallery' ? '/gallery' : '/explore'
            if (isDemo) {
              const originalParams = typeof window !== 'undefined' ? window.location.search : ''
              if (originalParams.includes('color=') || originalParams.includes('department=')) {
                const urlParams = new URLSearchParams(originalParams)
                urlParams.set('demo', 'true')
                router.push(`${base}?${urlParams.toString()}`)
                return
              }
              router.push(`${base}?demo=true`)
              return
            }
            router.push(base)
          }}
          className="px-4 py-2.5 bg-white/10 hover:bg-white/20 backdrop-blur-md text-white rounded-xl shadow-lg border border-white/20 transition-all duration-300 font-medium text-sm flex items-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          {searchParams.get('returnTo') === 'gallery' ? 'Gallery' : 'Network'}
        </button>
      </div>

      {/* Top-right status pill (view mode + board count) */}
      <div className="fixed top-4 right-4 z-40 flex items-center gap-2.5">
        <div className="px-4 py-2.5 bg-white/10 backdrop-blur-md text-white rounded-xl shadow-lg border border-white/20 transition-all duration-300 font-medium text-sm flex items-center gap-2">
          <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
          <span>View Mode</span>
          <span className="opacity-80">• {boards.length} boards</span>
        </div>
      </div>

      {/* Instructions Overlay */}
      <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 z-10 bg-white/90 backdrop-blur-sm px-6 py-3 rounded-full shadow-lg border border-gray-200">
        <p className="text-sm text-gray-700">
          <span className="font-semibold">💬 Click boards</span> to view comments
          <span className="mx-3 text-gray-400">•</span>
          <span className="font-semibold">🖱️ Click table/model</span> for full 3D view
          <span className="mx-3 text-gray-400">•</span>
          <span className="font-semibold">Drag</span> to rotate camera
        </p>
      </div>

      {/* Full-screen 3D model viewer overlay */}
      {modelViewerUrl && (
        <div className="fixed inset-0 z-50 bg-slate-900/90 flex flex-col">
          <div className="flex items-center justify-between p-3 bg-white/10 border-b border-white/20">
            <span className="text-white font-medium">3D Model</span>
            <button
              type="button"
              onClick={() => setModelViewerUrl(null)}
              className="px-4 py-2 rounded-lg bg-white/20 hover:bg-white/30 text-white text-sm font-medium transition-colors"
            >
              Close
            </button>
          </div>
          <div className="flex-1 min-h-0">
            <ModelViewer modelUrl={modelViewerUrl} />
          </div>
        </div>
      )}

      {/* 3D Canvas */}
      <Canvas shadows className="w-full h-full">
        {/* Background matches wall color */}
        <color attach="background" args={['#D8DEFF']} />
        
        {/* Lighting */}
        <ambientLight intensity={0.6} />
        <directionalLight position={[10, 10, 5]} intensity={0.8} castShadow />
        <directionalLight position={[-10, 10, -5]} intensity={0.4} />
        
        {/* Wall System with Boards */}
        {wallConfig && (
          <WallSystem 
            boards={boards} 
            wallConfig={wallConfig}
            onWallClick={() => {}} // No wall click in view mode
            editingWall={null}
            onBoardClick={handleBoardClick}
          />
        )}

        {/* Floor tables with 3D models – click to open full 3D viewer */}
        {tables.map((table) => (
          <TableWithModel
            key={table.id}
            table={table}
            onTableClick={(url) => setModelViewerUrl(url)}
          />
        ))}
        
        {/* Camera Controls - scaled based on wall dimensions */}
        {(() => {
          // Find the largest wall dimension to scale camera controls
          const maxWallWidth = wallConfig?.walls ? Math.max(...wallConfig.walls.map(w => w.width)) : 8
          const maxWallHeight = wallConfig?.walls ? Math.max(...wallConfig.walls.map(w => w.height)) : 10
          const maxDimension = Math.max(maxWallWidth, maxWallHeight) // in feet
          
          // Scale camera controls based on wall size
          // Base scale: for 8ft walls, we use 50-800 inches
          // For larger walls, scale proportionally
          const scaleFactor = maxDimension / 8 // 8ft is our baseline
          const minDistance = 50 * scaleFactor   // Scale minimum zoom
          const maxDistance = 800 * scaleFactor   // Scale maximum zoom
          const targetHeight = 50 * scaleFactor   // Scale target height
          const cameraHeight = 50 * scaleFactor   // Scale camera height
          const cameraDistance = 80 * scaleFactor // Scale camera distance
          
          return (
            <>
              <OrbitControls 
                enableDamping
                dampingFactor={0.05}
                minDistance={minDistance}   // Scaled minimum zoom
                maxDistance={maxDistance}   // Scaled maximum zoom
                maxPolarAngle={Math.PI / 2}
                minPolarAngle={Math.PI / 6}  // Prevent looking from too high above (30 degrees minimum)
                enablePan={true}
                enableRotate={true}
                enableZoom={true}
                target={[0, targetHeight, 0]}  // Scaled target height
              />
              
              <PerspectiveCamera 
                makeDefault 
                position={[0, cameraHeight, cameraDistance]}  // Scaled camera position
                fov={50}  // Wider FOV to see more of the room
              />
            </>
          )
        })()}
      </Canvas>

      {/* Lightbox Modal */}
      <LightboxModal 
        board={selectedBoard}
        allBoards={boards}
        onClose={() => setSelectedBoard(null)}
        onNavigate={handleNavigate}
      />
    </div>
  )
}

