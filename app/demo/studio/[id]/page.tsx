'use client'

import { useParams, useRouter } from 'next/navigation'
import { useState, useEffect, useRef, Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, PerspectiveCamera } from '@react-three/drei'
import { motion } from 'framer-motion'
import DemoBanner from '@/components/DemoBanner'
import Loading from '@/components/Loading'
import { getStudioById, getBoardsByStudio, transformDemoBoard, type DemoStudio } from '@/lib/mockData'
import { Board } from '@/types'
import WallSystem from '@/components/3d/WallSystem'
import { CameraController } from '@/components/3d/CameraController'
import { EditModeOverlay } from '@/components/3d/EditModeOverlay'

export default function DemoStudioRoomPage() {
  const params = useParams()
  const router = useRouter()
  const studioId = params.id as string
  
  const [studio, setStudio] = useState<Pick<DemoStudio, 'id' | 'name' | 'description' | 'instructor'> | null>(null)
  const [boards, setBoards] = useState<Board[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [editingWall, setEditingWall] = useState<number | null>(null)
  const orbitControlsRef = useRef<unknown>(null)

  // Default wall config for demo (4 walls, 8ft × 10ft each)
  const wallConfig = {
    walls: [
      { width: 10, height: 8 },
      { width: 10, height: 8 },
      { width: 10, height: 8 },
      { width: 10, height: 8 }
    ],
    layoutType: 'square' as const
  }

  useEffect(() => {
    // Load demo data
    const demoStudio = getStudioById(studioId)
    if (!demoStudio) {
      router.push('/demo')
      return
    }
    
    const demoBoards = getBoardsByStudio(studioId).map(transformDemoBoard) as Board[]
    
    setStudio({
      id: demoStudio.id,
      name: demoStudio.name,
      description: demoStudio.description,
      instructor: demoStudio.instructor
    })
    setBoards(demoBoards)
    setLoading(false)
  }, [studioId, router])

  const handleUpload = () => {
    alert('Upload is disabled in demo mode. Sign up to create your own workspace!')
  }

  if (loading) {
    return <Loading message="Loading demo studio..." />
  }

  if (!studio) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-text-muted">Studio not found</p>
      </div>
    )
  }

  return (
    <div className="relative w-full h-screen overflow-hidden bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Demo Banner */}
      <DemoBanner 
        message={`Demo: ${studio.name} • ${studio.instructor}`}
      />

      {/* Header */}
      <motion.header
        initial={{ y: -100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5 }}
        className="fixed top-16 left-0 right-0 z-40 px-6 py-4 flex items-center justify-between bg-white/80 backdrop-blur-sm shadow-sm"
      >
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push('/demo')}
            className="p-2 hover:bg-background-lighter rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>
          <div>
            <h1 className="text-xl font-semibold text-text-primary">{studio.name}</h1>
            <p className="text-sm text-text-muted">{studio.instructor} • {boards.length} boards</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <a
            href={`/demo/studio/${studioId}/view`}
            className="px-4 py-2 bg-background-lighter hover:bg-background-light text-text-secondary hover:text-text-primary rounded-lg text-sm transition-colors border border-border"
          >
            View Mode
          </a>
          <button
            onClick={handleUpload}
            className="px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg text-sm transition-colors"
          >
            Add Board (Demo)
          </button>
        </div>
      </motion.header>

      {/* 3D Canvas */}
      <div className="w-full h-full pt-32">
        <Canvas
          shadows
          dpr={[1, 2]}
          gl={{ antialias: true, alpha: false }}
          style={{ background: '#B3B3FF' }}
        >
          <PerspectiveCamera makeDefault position={[0, 60, 120]} fov={35} />
          
          <ambientLight intensity={0.6} />
          <directionalLight
            position={[10, 20, 10]}
            intensity={1.2}
            castShadow
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
            shadow-camera-far={200}
            shadow-camera-left={-100}
            shadow-camera-right={100}
            shadow-camera-top={100}
            shadow-camera-bottom={-100}
          />
          <hemisphereLight args={['#ffffff', '#8888aa', 0.4]} />

          <Suspense fallback={null}>
            <WallSystem
              boards={boards}
              wallConfig={wallConfig}
              editingWall={editingWall}
              onBoardClick={(board) => {
                console.log('Board clicked:', board.title)
              }}
              onWallDoubleClick={(wallIndex) => {
                if (editingWall === null) {
                  setEditingWall(wallIndex)
                }
              }}
            />
          </Suspense>

          <CameraController
            orbitControlsRef={orbitControlsRef}
            editingWall={editingWall}
            wallPosition={null}
            wallRotation={0}
            wallDimensions={null}
          />

          {editingWall === null && <OrbitControls ref={orbitControlsRef as React.RefObject<import('three-stdlib').OrbitControls>} enableDamping={false} dampingFactor={0} />}
        </Canvas>
      </div>

      {/* Edit Mode Overlay */}
      <EditModeOverlay
        isVisible={editingWall !== null}
        wallIndex={editingWall || 0}
        onClose={() => setEditingWall(null)}
        onUpload={handleUpload}
      />

      {/* Demo Info */}
      {editingWall === null && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1 }}
          className="fixed bottom-6 right-6 bg-white/95 backdrop-blur-sm rounded-xl shadow-xl p-4 max-w-xs border border-border"
        >
          <h3 className="font-semibold text-sm mb-2">💡 Demo Tips</h3>
          <ul className="text-xs text-gray-600 space-y-1.5">
            <li>• Click a wall to enter edit mode</li>
            <li>• Drag boards to rearrange (changes not saved)</li>
            <li>• Click boards to view comments</li>
            <li>• Use mouse to rotate and zoom</li>
          </ul>
        </motion.div>
      )}
    </div>
  )
}