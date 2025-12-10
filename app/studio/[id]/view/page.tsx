'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, PerspectiveCamera } from '@react-three/drei'
import { supabase } from '@/lib/supabase/client'
import { Board } from '@/types'
import WallSystem from '@/components/3d/WallSystem'
import LightboxModal from '@/components/LightboxModal'

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
  const studioId = params.id as string
  
  const [boards, setBoards] = useState<Board[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedBoard, setSelectedBoard] = useState<Board | null>(null)

  // Wall configuration (same as edit mode)
  const wallConfig: WallConfig = {
    walls: [
      { height: 10, width: 8 },
      { height: 10, width: 8 },
      { height: 10, width: 8 },
      { height: 10, width: 8 }
    ],
    layoutType: 'zigzag'
  }

  useEffect(() => {
    fetchBoards()
  }, [studioId])

  const fetchBoards = async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await fetch(`/api/boards?studioId=${studioId}`)
      
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
      <div className="w-full h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-4 border-indigo-600/20 border-t-indigo-600 mx-auto mb-4"></div>
          <p className="text-gray-600 font-medium">Loading studio...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="w-full h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100">
        <div className="text-center max-w-md p-8 bg-white rounded-xl shadow-lg">
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
    <div className="relative w-full h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      {/* Top Navigation Bar */}
      <div className="absolute top-0 left-0 right-0 z-10 bg-white/90 backdrop-blur-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link 
              href={`/studio/${studioId}`}
              className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
                <path d="M15 19l-7-7 7-7"></path>
              </svg>
              <span className="font-medium">Back to Edit</span>
            </Link>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
              <span className="font-medium">View Mode</span>
            </div>
            <div className="w-px h-6 bg-gray-300"></div>
            <span className="text-sm text-gray-500">{boards.length} boards</span>
            <div className="w-px h-6 bg-gray-300"></div>
            <button
              onClick={() => supabase.auth.signOut().then(() => window.location.href = '/')}
              className="bg-white rounded-lg shadow-lg px-4 py-2 border border-gray-200 hover:bg-gray-50 transition-colors text-sm font-medium"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>

      {/* Instructions Overlay */}
      <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 z-10 bg-white/90 backdrop-blur-sm px-6 py-3 rounded-full shadow-lg border border-gray-200">
        <p className="text-sm text-gray-700">
          <span className="font-semibold">💬 Click boards</span> to view comments
          <span className="mx-3 text-gray-400">•</span>
          <span className="font-semibold">🖱️ Drag</span> to rotate camera
        </p>
      </div>

      {/* 3D Canvas */}
      <Canvas shadows className="w-full h-full">
        <color attach="background" args={['#f5f5f5']} />
        
        {/* Lighting */}
        <ambientLight intensity={0.6} />
        <directionalLight position={[10, 10, 5]} intensity={0.8} castShadow />
        <directionalLight position={[-10, 10, -5]} intensity={0.4} />
        
        {/* Wall System with Boards */}
        <WallSystem 
          boards={boards} 
          wallConfig={wallConfig}
          onWallClick={() => {}} // No wall click in view mode
          editingWall={null}
          onBoardClick={handleBoardClick}
        />
        
        {/* Camera Controls */}
        <OrbitControls 
          enableDamping
          dampingFactor={0.05}
          minDistance={3}
          maxDistance={20}
          maxPolarAngle={Math.PI / 2}
          enablePan={true}
          enableRotate={true}
          enableZoom={true}
        />
        
        <PerspectiveCamera 
          makeDefault 
          position={[0, 3.2, 7]} 
          fov={35}
        />
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

