'use client'

import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
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
import { addDemoParam } from '@/lib/demoMode'

export default function DemoStudioRoomPage() {
  const params = useParams()
  const router = useRouter()
  const studioId = params.id as string
  
  const [studio, setStudio] = useState<Pick<DemoStudio, 'id' | 'name' | 'description' | 'instructor'> | null>(null)
  const [boards, setBoards] = useState<Board[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [editingWall] = useState<number | null>(null)
  const orbitControlsRef = useRef<unknown>(null)

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
    
    // Demo data is synchronously derived from the selected route identity.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    <div className="relative flex h-dvh w-full flex-col overflow-hidden bg-gradient-to-br from-background to-background-lighter">
      {/* Demo Banner */}
      <DemoBanner inline
        message={`Demo: ${studio.name} • ${studio.instructor}`}
      />

      {/* Header */}
      <motion.header
        initial={{ y: -100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5 }}
        className="relative z-40 flex shrink-0 flex-col items-stretch gap-2 bg-background-light/90 px-3 py-2 shadow-sm backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-4"
      >
        <div className="flex min-w-0 items-center gap-2 sm:gap-4">
          <button
            type="button"
            onClick={() => router.push('/demo')}
            aria-label="Back to demo network"
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-pinspace transition-colors hover:bg-background-lighter focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold text-text-primary sm:text-xl">{studio.name}</h1>
            <p className="truncate text-xs text-text-muted sm:text-sm">{studio.instructor} • {boards.length} boards</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:gap-3">
          <Link 
            href={addDemoParam('/', true)}
            className="inline-flex min-h-11 flex-1 items-center justify-center rounded-pinspace border border-border bg-background-light/90 px-3 py-2 text-sm font-semibold text-text-primary shadow-lg backdrop-blur-sm transition-colors hover:bg-background-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:flex-none"
          >
            ← Back home
          </Link>
          <a
            href={`/demo/studio/${studioId}`}
            className="inline-flex min-h-11 flex-1 items-center justify-center rounded-pinspace border border-border bg-background-lighter px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-background-light hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:flex-none sm:px-4"
          >
            Edit Mode
          </a>
          <button
            onClick={handleUpload}
            className="min-h-11 flex-1 rounded-pinspace bg-primary px-3 py-2 text-sm font-semibold text-pinspace-ink transition-colors hover:bg-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:flex-none sm:px-4"
          >
            Add Board (Demo)
          </button>
        </div>
      </motion.header>

      {/* 3D Canvas */}
      <div className="min-h-0 w-full flex-1">
        <Canvas
          shadows
          gl={{ antialias: true, alpha: false }}
          style={{ background: 'rgb(var(--color-primary-muted))' }}
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
          <hemisphereLight args={['white', 'darkslategray', 0.4]} />
          <Suspense fallback={null}>
            <WallSystem
              boards={boards}
              wallConfig={wallConfig}
              editingWall={editingWall}
              onBoardClick={(board) => console.log('Board clicked:', board.title)}
              onWallDoubleClick={(wallIndex) => console.log('Wall double-clicked:', wallIndex)}
            />
          </Suspense>
          <CameraController
            orbitControlsRef={orbitControlsRef}
            editingWall={editingWall}
            wallPosition={null}
            wallRotation={0}
            wallDimensions={null}
          />
          {editingWall === null && (
            <OrbitControls ref={orbitControlsRef as React.RefObject<import('three-stdlib').OrbitControls>} enableDamping={false} dampingFactor={0} />
          )}
        </Canvas>
      </div>

      {/* Edit Mode Overlay - Not shown in view mode */}

      {/* Demo Info */}
      {editingWall === null && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1 }}
          className="fixed bottom-6 right-6 bg-background-light/95 backdrop-blur-sm rounded-xl shadow-xl p-4 max-w-xs border border-border"
        >
          <h3 className="font-semibold text-sm mb-2">💡 Demo Tips</h3>
          <ul className="text-xs text-text-secondary space-y-1.5">
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
