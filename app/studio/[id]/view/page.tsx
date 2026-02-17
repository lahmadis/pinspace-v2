'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, PerspectiveCamera } from '@react-three/drei'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsType } from 'three-stdlib'
import { Board, FloorTable } from '@/types'
import WallSystem from '@/components/3d/WallSystem'
import TableWithModel from '@/components/3d/TableWithModel'
import ModelViewer from '@/components/3d/ModelViewer'
import LightboxModal from '@/components/LightboxModal'
import DemoBanner from '@/components/DemoBanner'
import { getCachedStudioData } from '@/lib/studioViewCache'
import { ArrowLeft } from 'lucide-react'

interface WallDimensions {
  height: number
  width: number
}

interface WallConfig {
  walls: WallDimensions[]
  layoutType: 'zigzag' | 'square' | 'linear' | 'lshape'
}

function getControls(ref: React.RefObject<unknown>): OrbitControlsType | null {
  const r = ref?.current
  if (!r) return null
  if (typeof (r as { get?: () => OrbitControlsType }).get === 'function') {
    return (r as { get: () => OrbitControlsType }).get()
  }
  return r as OrbitControlsType
}

/** Stops orbit the instant the user releases the mouse (no lingering). */
function CrispOrbitRestore({ orbitControlsRef }: { orbitControlsRef: React.RefObject<unknown> }) {
  const { camera } = useThree()
  const restoreOnNextFrame = useRef(false)
  const positionOnEnd = useRef(new THREE.Vector3())
  const targetOnEnd = useRef(new THREE.Vector3())
  const endListenerAdded = useRef(false)

  useFrame(() => {
    const controls = getControls(orbitControlsRef)
    if (!controls) return

    if (!endListenerAdded.current) {
      endListenerAdded.current = true
      controls.addEventListener('end', () => {
        positionOnEnd.current.copy(camera.position)
        targetOnEnd.current.copy(controls.target)
        restoreOnNextFrame.current = true
      })
    }

    // Match StudioRoom controls: no damping, specific mouse buttons, screen-space panning
    ;(controls as { enableDamping?: boolean; dampingFactor?: number }).enableDamping = false
    ;(controls as { enableDamping?: boolean; dampingFactor?: number }).dampingFactor = 0
    ;(controls as any).mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    }
    ;(controls as any).screenSpacePanning = true

    controls.update()

    if (restoreOnNextFrame.current) {
      camera.position.copy(positionOnEnd.current)
      controls.target.copy(targetOnEnd.current)
      restoreOnNextFrame.current = false
    }
  })

  return null
}

function StudioViewCameraControls({ wallConfig }: { wallConfig: WallConfig | null }) {
  const orbitControlsRef = useRef<OrbitControlsType | null>(null)
  // Match StudioRoom camera layout and scaling logic so view mode feels identical
  const maxWallWidth = wallConfig?.walls ? Math.max(...wallConfig.walls.map(w => w.width)) : 8
  const maxWallHeight = wallConfig?.walls ? Math.max(...wallConfig.walls.map(w => w.height)) : 8

  // Convert to inches (1 unit = 1 inch)
  const maxWallWidthInches = maxWallWidth * 12
  const maxWallHeightInches = maxWallHeight * 12

  // Baseline room: 8ft wide, 8ft tall
  const baseWidthInches = 8 * 12
  const baseHeightInches = 8 * 12

  const wallCount = wallConfig?.walls?.length ?? 1
  const layoutType = wallConfig?.layoutType ?? 'zigzag'
  const layoutFactor =
    layoutType === 'zigzag' || layoutType === 'square' || layoutType === 'lshape'
      ? Math.max(1, wallCount / 2)
      : 1

  // Wider rooms (or more connected walls) push the camera back more.
  const distanceScale = ((maxWallWidthInches * layoutFactor) / baseWidthInches) || 1

  const minDistance = 80 * distanceScale       // Pull camera back a bit more by default
  const maxDistance = 1200 * distanceScale     // Allow zooming further out for very long rooms

  // Aim slightly above mid-wall (where boards typically sit) so zoom goes toward the walls, not the floor.
  const targetHeight = Math.max(60, Math.min(maxWallHeightInches * 0.65, maxWallHeightInches)) || 60

  // Axonometric view: position camera at diagonal angle with moderate elevation
  const baseDistance = 110 * distanceScale
  const elevationAngle = 35 * (Math.PI / 180) // 35 degrees elevation
  const azimuthAngle = 45 * (Math.PI / 180)   // 45 degrees around (diagonal view)

  // Calculate axonometric camera position
  const horizontalDistance = baseDistance * Math.cos(elevationAngle)
  const cameraHeight = targetHeight + (baseDistance * Math.sin(elevationAngle))
  const cameraX = horizontalDistance * Math.sin(azimuthAngle)
  const cameraZ = horizontalDistance * Math.cos(azimuthAngle)

  return (
    <>
      <CrispOrbitRestore orbitControlsRef={orbitControlsRef} />
      <OrbitControls
        ref={orbitControlsRef}
        enableDamping={false}
        dampingFactor={0}
        minDistance={minDistance}
        maxDistance={maxDistance}
        maxPolarAngle={Math.PI / 2}
        // Match StudioRoom: slightly steeper minimum angle so zoom aims toward the walls, not the floor
        minPolarAngle={0.45}
        enablePan={true}
        enableRotate={true}
        enableZoom={true}
        target={[0, targetHeight, 0]}
      />
      <PerspectiveCamera
        makeDefault
        position={[cameraX, cameraHeight, cameraZ]}
        fov={50}
      />
    </>
  )
}

export default function StudioViewPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const studioId = params.id as string
  
  // Check if it's a demo studio (starts with "demo-studio-") or has demo=true param
  const isDemoStudio = studioId.startsWith('demo-studio-')
  const isDemo = searchParams?.get('demo') === 'true' || isDemoStudio
  const initialCache = getCachedStudioData(studioId, isDemo)
  const [boards, setBoards] = useState<Board[]>(initialCache?.boards ?? [])
  const [wallConfig, setWallConfig] = useState<WallConfig | null>(
    (initialCache?.wallConfig as WallConfig) ?? null
  )
  const [loading, setLoading] = useState(!(initialCache?.boards && initialCache?.wallConfig))
  const [error, setError] = useState<string | null>(null)
  const [selectedBoard, setSelectedBoard] = useState<Board | null>(null)
  const [compareBoardIds, setCompareBoardIds] = useState<string[]>([])
  const shiftPressedRef = useRef(false)
  const compareBoardIdsRef = useRef<string[]>([])
  const boardsRef = useRef<Board[]>([])
  const [autoEnterPresentCompare, setAutoEnterPresentCompare] = useState(false)
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

  // Load data: use cache first for instant open when coming from bubble network prefetch
  useEffect(() => {
    const cached = getCachedStudioData(studioId, isDemo)
    if (cached?.boards && cached?.wallConfig) {
      setBoards(cached.boards)
      setWallConfig(cached.wallConfig as WallConfig)
      setLoading(false)
      setError(null)
      return
    }

    let cancelled = false
    const loadWallConfig = async () => {
      try {
        const configUrl = isDemo 
          ? `/api/studios/${studioId}/wall-config?demo=true`
          : `/api/studios/${studioId}/wall-config`
        const resConfig = await fetch(configUrl)
        if (cancelled) return
        if (resConfig.ok) {
          const data = await resConfig.json()
          if (data?.config) {
            setWallConfig(data.config)
            return
          }
        }
      } catch (e) {
        if (!cancelled) console.warn('Wall config API fetch failed, falling back to localStorage', e)
      }

      if (cancelled) return
      const savedConfigKey = `studio-${studioId}-wall-config`
      const savedConfig = localStorage.getItem(savedConfigKey)
      if (savedConfig) {
        setWallConfig(JSON.parse(savedConfig))
      } else {
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
    return () => { cancelled = true }
  }, [studioId, isDemo])

  useEffect(() => {
    compareBoardIdsRef.current = compareBoardIds
  }, [compareBoardIds])

  useEffect(() => {
    boardsRef.current = boards
  }, [boards])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      shiftPressedRef.current = event.shiftKey
    }
    const onKeyUp = (event: KeyboardEvent) => {
      shiftPressedRef.current = event.shiftKey
      if (event.key !== 'Shift') return
      const selectedIds = compareBoardIdsRef.current
      if (selectedIds.length <= 1) return
      const selectedBoards = selectedIds
        .map((id) => boardsRef.current.find((b) => b.id === id))
        .filter((b): b is Board => Boolean(b))
      if (selectedBoards.length <= 1) return
      setAutoEnterPresentCompare(true)
      setSelectedBoard(selectedBoards[0])
    }
    const onBlur = () => {
      shiftPressedRef.current = false
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  useEffect(() => {
    const cached = getCachedStudioData(studioId, isDemo)
    if (cached?.boards?.length !== undefined) {
      setBoards(cached.boards)
      setLoading(false)
      setError(null)
      return
    }
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
      // Avoid flashing loading if cache was populated (e.g. prefetch completed after nav)
      if (!getCachedStudioData(studioId, isDemo)?.boards) setLoading(true)
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
    const clickShift = !!((window as any).event?.shiftKey)
    const shiftActive = shiftPressedRef.current || clickShift
    if (shiftActive) {
      setCompareBoardIds((prev) =>
        prev.includes(board.id)
          ? prev.filter((id) => id !== board.id)
          : [...prev, board.id]
      )
      return
    }
    setAutoEnterPresentCompare(false)
    setCompareBoardIds((prev) => (
      prev.length > 1 && prev.includes(board.id) ? prev : []
    ))
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
      <Canvas
        shadows
        className="w-full h-full"
        gl={{
          shadowMap: { enabled: true, type: THREE.PCFSoftShadowMap },
          alpha: true,
          premultipliedAlpha: false,
        } as any}
        style={{ background: '#D8DEFF' }}
      >
        {/* Background matches wall color */}
        <color attach="background" args={['#D8DEFF']} />
        
        {/* Lighting – match StudioRoom for consistent brightness and color */}
        {/* Ambient light - reduced for better shadow definition */}
        <ambientLight intensity={0.5} />
        
        {/* Main directional light - creates shadows and depth */}
        <directionalLight 
          position={[15, 20, 10]} 
          intensity={1.2} 
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-camera-far={500}
          shadow-camera-left={-200}
          shadow-camera-right={200}
          shadow-camera-top={200}
          shadow-camera-bottom={-200}
          shadow-bias={-0.0001}
        />
        
        {/* Fill light from opposite side - softens shadows */}
        <directionalLight position={[-10, 12, -8]} intensity={0.5} />
        
        {/* Top light for overall illumination */}
        <directionalLight position={[0, 25, 0]} intensity={0.4} />
        
        {/* Rim lighting for wall edges - enhances depth */}
        <directionalLight position={[-8, 10, -12]} intensity={0.3} color="#ffffff" />
        <directionalLight position={[8, 10, 12]} intensity={0.3} color="#ffffff" />
        
        {/* Hemisphere light for natural ambient */}
        <hemisphereLight args={['#ffffff', '#e5e7eb', 0.3]} />
        
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
        
        {/* Camera Controls - scaled by wall size; crisp stop on mouse release (no lingering) */}
        <StudioViewCameraControls wallConfig={wallConfig} />
      </Canvas>

      {/* Lightbox Modal */}
      <LightboxModal 
        board={selectedBoard}
        allBoards={boards}
        autoEnterPresentCompare={autoEnterPresentCompare}
        compareBoards={compareBoardIds
          .map((id) => boards.find((board) => board.id === id))
          .filter((board): board is Board => Boolean(board))}
        onClose={() => {
          setSelectedBoard(null)
          setAutoEnterPresentCompare(false)
          setCompareBoardIds([])
        }}
        onNavigate={handleNavigate}
      />
    </div>
  )
}

