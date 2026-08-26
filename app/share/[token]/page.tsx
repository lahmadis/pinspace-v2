'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, PerspectiveCamera } from '@react-three/drei'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsType } from 'three-stdlib'
import { Board, FloorTable } from '@/types'
import WallSystem, { ROOM_SKY_COLOR, getRoomFogParams } from '@/components/3d/WallSystem'
import RoomLighting from '@/components/3d/RoomLighting'
import TableWithModel from '@/components/3d/TableWithModel'
import ModelViewer from '@/components/3d/ModelViewer'
import LightboxModal from '@/components/LightboxModal'
import { DEFAULT_WALL_CONFIG } from '@/lib/wallLayout'
import { orderBoardsForLightbox } from '@/lib/boardOrder'

interface WallDimensions {
  height: number
  width: number
}

interface WallConfig {
  walls: WallDimensions[]
  layoutType: 'zigzag' | 'square' | 'linear' | 'lshape'
}

type LoadState = 'loading' | 'ok' | 'not-found' | 'error'

function getControls(ref: React.RefObject<unknown>): OrbitControlsType | null {
  const r = ref?.current
  if (!r) return null
  if (typeof (r as { get?: () => OrbitControlsType }).get === 'function') {
    return (r as { get: () => OrbitControlsType }).get()
  }
  return r as OrbitControlsType
}

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

    ;(controls as { enableDamping?: boolean; dampingFactor?: number }).enableDamping = false
    ;(controls as { enableDamping?: boolean; dampingFactor?: number }).dampingFactor = 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(controls as any).mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

function ShareViewCameraControls({ wallConfig }: { wallConfig: WallConfig | null }) {
  const orbitControlsRef = useRef<OrbitControlsType | null>(null)
  const maxWallWidth = wallConfig?.walls ? Math.max(...wallConfig.walls.map(w => w.width)) : 8
  const maxWallHeight = wallConfig?.walls ? Math.max(...wallConfig.walls.map(w => w.height)) : 8

  const maxWallWidthInches = maxWallWidth * 12
  const maxWallHeightInches = maxWallHeight * 12
  const baseWidthInches = 8 * 12

  const wallCount = wallConfig?.walls?.length ?? 1
  const layoutType = wallConfig?.layoutType ?? 'zigzag'
  const layoutFactor =
    layoutType === 'zigzag' || layoutType === 'square' || layoutType === 'lshape'
      ? Math.max(1, wallCount / 2)
      : 1

  const distanceScale = ((maxWallWidthInches * layoutFactor) / baseWidthInches) || 1

  const minDistance = 80 * distanceScale
  const maxDistance = 1200 * distanceScale
  const targetHeight = Math.max(60, Math.min(maxWallHeightInches * 0.65, maxWallHeightInches)) || 60

  const baseDistance = 110 * distanceScale
  const elevationAngle = 35 * (Math.PI / 180)
  const azimuthAngle = 45 * (Math.PI / 180)

  const horizontalDistance = baseDistance * Math.cos(elevationAngle)
  const cameraHeight = targetHeight + baseDistance * Math.sin(elevationAngle)
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
        // See StudioRoom's camera: a 0.1 near plane leaves only inches of
        // depth precision at full zoom-out, which makes WallSystem's stacked
        // floor/grid/ground planes flicker. Nothing is ever within 5 inches
        // of the camera here either.
        near={5}
        // maxDistance below can exceed three.js's default far of 2000 on a
        // large room, which clips boards away as you zoom out. Same formula
        // StudioRoom uses.
        far={maxDistance + maxWallWidthInches * layoutFactor + 1000}
      />
    </>
  )
}

export default function SharePage() {
  const params = useParams()
  const token = params.token as string

  const [boards, setBoards] = useState<Board[]>([])
  const [wallConfig, setWallConfig] = useState<WallConfig | null>(null)
  const [roomName, setRoomName] = useState<string | null>(null)
  // Room wall color (migration 031) so shared viewers see the room's chosen look.
  const [wallColor, setWallColor] = useState<'grey' | 'white'>('white')
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [selectedBoard, setSelectedBoard] = useState<Board | null>(null)
  const [compareBoardIds, setCompareBoardIds] = useState<string[]>([])
  const [autoEnterPresentCompare, setAutoEnterPresentCompare] = useState(false)
  const [modelViewerUrl, setModelViewerUrl] = useState<string | null>(null)

  const shiftPressedRef = useRef(false)
  const compareBoardIdsRef = useRef<string[]>([])
  const boardsRef = useRef<Board[]>([])

  const tables: FloorTable[] = (() => {
    const raw = (wallConfig as { tables?: FloorTable[] })?.tables
    const list = Array.isArray(raw) ? raw : []
    return list.map((t) => ({
      ...t,
      modelUrl: t.modelUrl?.startsWith('blob:') ? undefined : t.modelUrl,
    }))
  })()

  useEffect(() => {
    compareBoardIdsRef.current = compareBoardIds
  }, [compareBoardIds])

  useEffect(() => {
    boardsRef.current = boards
  }, [boards])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { shiftPressedRef.current = e.shiftKey }
    const onKeyUp = (e: KeyboardEvent) => {
      shiftPressedRef.current = e.shiftKey
      if (e.key !== 'Shift') return
      const selectedIds = compareBoardIdsRef.current
      if (selectedIds.length <= 1) return
      const selectedBoards = selectedIds
        .map((id) => boardsRef.current.find((b) => b.id === id))
        .filter((b): b is Board => Boolean(b))
      if (selectedBoards.length <= 1) return
      setAutoEnterPresentCompare(true)
      setSelectedBoard(selectedBoards[0])
    }
    const onBlur = () => { shiftPressedRef.current = false }
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
    if (!token) return
    let cancelled = false

    const load = async () => {
      try {
        const res = await fetch(`/api/share/${token}/boards`, { cache: 'no-store' })
        if (cancelled) return
        if (res.status === 404) { setLoadState('not-found'); return }
        if (!res.ok) { setLoadState('error'); return }

        const data = await res.json()
        setBoards(data.boards || [])
        const workspaceId: string | null = data.room?.workspaceId ?? null
        const roomId: string | null = data.room?.id ?? null
        setRoomName(data.room?.name ?? null)
        setWallColor(data.room?.wallColor === 'grey' ? 'grey' : 'white')

        // Phase 2b: pass roomId so the route reads the per-room wall-config blob
        // (which has its own legacy fallback). Without it the route only reads
        // the workspace-level blob and returns config:null for rooms created or
        // edited after the per-room migration — which left the room blank.
        let resolvedConfig: WallConfig | null = null
        if (workspaceId) {
          try {
            const configUrl = roomId
              ? `/api/studios/${workspaceId}/wall-config?roomId=${encodeURIComponent(roomId)}`
              : `/api/studios/${workspaceId}/wall-config`
            const configRes = await fetch(configUrl, { cache: 'no-store' })
            if (!cancelled && configRes.ok) {
              const configData = await configRes.json()
              if (configData?.config) resolvedConfig = configData.config
            }
          } catch {
            // wall config fetch failed — fall back to a default below.
          }
        }

        // Never leave the room blank: boards render only inside <WallSystem>,
        // which is gated on wallConfig. If config is genuinely missing or the
        // fetch failed, render boards on a default wall layout rather than
        // showing an empty room.
        if (!cancelled) setWallConfig(resolvedConfig ?? DEFAULT_WALL_CONFIG)

        if (!cancelled) setLoadState('ok')
      } catch {
        if (!cancelled) setLoadState('error')
      }
    }

    load()
    return () => { cancelled = true }
  }, [token])

  useEffect(() => {
    document.title = roomName ? `${roomName} – pinspace` : 'Shared Space – pinspace'
  }, [roomName])

  const handleBoardClick = (board: Board) => {
    if (shiftPressedRef.current) {
      setCompareBoardIds((prev) =>
        prev.includes(board.id)
          ? prev.filter((id) => id !== board.id)
          : [...prev, board.id]
      )
      return
    }
    setAutoEnterPresentCompare(false)
    setCompareBoardIds((prev) => (prev.length > 1 && prev.includes(board.id) ? prev : []))
    setSelectedBoard(board)
  }

  // Lightbox-only slideshow order (boards.sort_order). A SEPARATE sorted copy —
  // `boards` itself stays in server order for the 3D scene. The arrows here and
  // the counter inside the modal must read THIS array or they'd disagree.
  const lightboxBoards = useMemo(() => orderBoardsForLightbox(boards), [boards])

  const handleNavigate = (direction: 'prev' | 'next') => {
    if (!selectedBoard) return
    const currentIndex = lightboxBoards.findIndex((b) => b.id === selectedBoard.id)
    const newIndex = direction === 'prev' ? currentIndex - 1 : currentIndex + 1
    if (newIndex >= 0 && newIndex < lightboxBoards.length) setSelectedBoard(lightboxBoards[newIndex])
  }

  if (loadState === 'loading') {
    return (
      <div className="w-full h-screen flex items-center justify-center" style={{ background: '#3B6EF6' }}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-4 border-white/20 border-t-white mx-auto mb-4" />
          <p className="text-white/90 font-medium">Loading space…</p>
        </div>
      </div>
    )
  }

  if (loadState === 'not-found') {
    return (
      <div className="w-full h-screen flex items-center justify-center" style={{ background: '#E7ECF5' }}>
        <div className="text-center max-w-md p-8 bg-white/95 rounded-xl shadow-lg">
          <div className="text-6xl mb-4">🔗</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Link not found</h2>
          <p className="text-gray-600">This share link is invalid or has been revoked.</p>
        </div>
      </div>
    )
  }

  if (loadState === 'error') {
    return (
      <div className="w-full h-screen flex items-center justify-center" style={{ background: '#E7ECF5' }}>
        <div className="text-center max-w-md p-8 bg-white/95 rounded-xl shadow-lg">
          <div className="text-6xl mb-4">😕</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Something went wrong</h2>
          <p className="text-gray-600 mb-6">We had trouble loading this space.</p>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-3 bg-[#3B6EF6] text-white rounded-lg hover:bg-[#2F5CD6] transition-colors font-medium"
          >
            Try Again
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="relative w-full h-screen overflow-hidden" style={{ background: '#E7ECF5' }}>
      {/* Flat, neutral field matching ROOM_SKY_COLOR — see the comment on the
          equivalent wrapper in app/studio/[id]/page.tsx for why the previous
          pulsing indigo blur orbs were removed rather than recolored. */}

      <div className="fixed top-4 left-4 z-40 flex items-center gap-2.5">
        <a
          href="/"
          className="px-5 py-2.5 bg-[#3B6EF6] hover:bg-[#2F5CD6] text-white rounded-xl shadow-lg shadow-[#3B6EF6]/30 transition-all duration-300 font-semibold text-base backdrop-blur-sm border border-white/10"
        >
          pinspace
        </a>
        {roomName && (
          <div
            className="px-3 py-2 bg-white/10 backdrop-blur-md text-white rounded-xl shadow-lg border border-white/20 text-sm font-medium max-w-[40vw] sm:max-w-xs truncate"
            title={roomName}
          >
            {roomName}
          </div>
        )}
      </div>

      <div className="fixed top-4 right-4 z-40">
        <div className="px-4 py-2.5 bg-white/10 backdrop-blur-md text-white rounded-xl shadow-lg border border-white/20 font-medium text-sm flex items-center gap-2">
          <div className="w-2 h-2 bg-[#3B6EF6] rounded-full animate-pulse" />
          <span>View Mode</span>
          <span className="opacity-80">• {boards.length} boards</span>
        </div>
      </div>

      <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 z-10 bg-white/90 backdrop-blur-sm px-6 py-3 rounded-full shadow-lg border border-gray-200">
        <p className="text-sm text-gray-700">
          <span className="font-semibold">💬 Click boards</span> to view
          <span className="mx-3 text-gray-400">•</span>
          <span className="font-semibold">🖱️ Click table/model</span> for 3D view
          <span className="mx-3 text-gray-400">•</span>
          <span className="font-semibold">Drag</span> to rotate camera
        </p>
      </div>

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

      <Canvas
        dpr={[1, 2]}
        className="w-full h-full"
        gl={{
          shadowMap: { enabled: true, type: THREE.PCFSoftShadowMap },
          alpha: true,
          premultipliedAlpha: false,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any}
        style={{ background: ROOM_SKY_COLOR }}
      >
        {/* Must match ROOM_SKY_COLOR/getRoomFogParams — see the comment on
            those exports in components/3d/WallSystem.tsx. */}
        <color attach="background" args={[ROOM_SKY_COLOR]} />
        {wallConfig && (() => {
          const { fogNear, fogFar } = getRoomFogParams(wallConfig)
          return <fog attach="fog" args={[ROOM_SKY_COLOR, fogNear, fogFar]} />
        })()}
        {/* One shared rig for every room surface — see RoomLighting. */}
        <RoomLighting />

        {wallConfig && (
          <WallSystem
            boards={boards}
            wallConfig={wallConfig}
            onWallDoubleClick={() => {}}
            editingWall={null}
            onBoardClick={handleBoardClick}
            wallColor={wallColor}
          />
        )}

        {tables.map((table) => (
          <TableWithModel
            key={table.id}
            table={table}
            onTableClick={(url) => setModelViewerUrl(url)}
          />
        ))}

        <ShareViewCameraControls wallConfig={wallConfig} />
      </Canvas>

      <LightboxModal
        board={selectedBoard}
        allBoards={lightboxBoards}
        autoEnterPresentCompare={autoEnterPresentCompare}
        compareBoards={compareBoardIds
          .map((id) => boards.find((b) => b.id === id))
          .filter((b): b is Board => Boolean(b))}
        onClose={() => {
          setSelectedBoard(null)
          setAutoEnterPresentCompare(false)
          setCompareBoardIds([])
        }}
        onNavigate={handleNavigate}
        isEditMode={false}
        currentUserRole={null}
      />
    </div>
  )
}
