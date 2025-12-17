'use client'

import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Text, Html } from '@react-three/drei'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Board } from '@/types'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import WallSystem from './3d/WallSystem'

type Vec3 = { x: number; y: number; z: number }

interface Gallery3DProps {
  avatarColor?: string
  avatarPosition?: Vec3
  department?: string | null
  year?: string | null
  isDemo?: boolean
}

type GalleryStudio = {
  id: string
  name: string
  department?: string
  year?: string | number
  studioId?: string
  boundingBox?: { width: number; depth: number }
  boards?: Board[]
  galleryPosition?: { x: number; z: number }
  galleryRotation?: number // Rotation in radians around Y axis
  studentCount?: number
  wallConfig?: { walls: Array<{ width: number; height: number }>; layoutType?: string }
  isMock?: boolean
}

const DEFAULT_FLOOR = { width: 12, depth: 10 }
const SPACING = 6
const AVATAR_RADIUS = 0.6
// Movement speed scaled for 1 unit = 1 inch
// Normal walking speed: ~3-4 mph = ~70-90 inches/second
// Scale from old 3.2 units/sec to ~80 inches/sec
const MOVE_SPEED = 80 // 80 inches per second (~4.5 mph walking speed)
const SPRINT_MULTIPLIER = 1.8
// Camera settings scaled for 1 unit = 1 inch
// Camera should be about 66 inches (5.5ft) away for comfortable third-person view
const CAMERA_RADIUS = 66 // 66 inches = 5.5 feet
// Camera height should be at eye level with avatar's head (head is at 58 inches)
const CAMERA_HEIGHT = 58 // 58 inches = eye level with avatar head
// When aiming, camera gets closer
const AIM_RADIUS = 40 // 40 inches = ~3.3 feet
const AIM_FOV = 48
// Gravity and jump scaled for 1 unit = 1 inch
// Gravity: ~386 inches/sec² (32 ft/sec²)
// Scale from old 12 to ~386
const GRAVITY = 386 // 386 inches/sec² ≈ 32 ft/sec²
// Jump velocity: enough to jump ~12 inches (1 foot)
// Scale from old 5 to ~120 inches/sec
const JUMP_VELOCITY = 120 // 120 inches/sec initial jump velocity
const ORBIT_LERP = 0.1
const PITCH_MIN = -0.6
const PITCH_MAX = 1.2
const MINIMAP_SCALE = 4
// Entrance detection distance in inches
const ENTRANCE_DISTANCE = 36 // 36 inches = 3 feet
// Reduced from 30 to 15 for better performance - only render closest studios
const MAX_RENDER_STUDIOS = 15
const BOARD_RENDER_DISTANCE = 28
const DEFAULT_ROOM: { width: number; depth: number; height: number } = { width: 20, depth: 15, height: 10 }
// Reduce booth spacing: ~1.5 units (~4-5ft) between studios
const WALKWAY = 1.5

const lerpAngle = (a: number, b: number, t: number) => {
  const diff = THREE.MathUtils.euclideanModulo(b - a + Math.PI, Math.PI * 2) - Math.PI
  return a + diff * t
}

// For gallery studios, use a fixed 60ft x 60ft square border
// The walls must fit inside this fixed size
const calculateZigzagBounds = (wallConfig: { walls: Array<{ width: number; height: number }>; layoutType?: string } | undefined, forGallery: boolean = false) => {
  // Calculate actual bounds of zigzag walls
  if (!wallConfig || wallConfig.layoutType !== 'zigzag' || !wallConfig.walls || wallConfig.walls.length === 0) {
    return forGallery ? { width: 60, depth: 30 } : { width: DEFAULT_ROOM.width, depth: DEFAULT_ROOM.depth }
  }
  
  const SCALE = 12 // 1 unit = 1 inch, so convert feet to inches
  const WALL_DEPTH = 4 // Wall thickness in inches
  const OVERLAP = WALL_DEPTH / 2
  
  // Calculate total extent of zigzag pattern
  let totalXExtent = 0
  let totalZExtent = 0
  let currentX = 0
  let currentZ = 0
  
  for (let i = 0; i < wallConfig.walls.length; i++) {
    const wallWidth = wallConfig.walls[i].width * SCALE
    if (i % 2 === 0) {
      // Horizontal wall - extends along X axis
      currentX += wallWidth - (i > 0 ? OVERLAP : 0)
      totalXExtent = Math.max(totalXExtent, currentX)
    } else {
      // Vertical wall - extends along Z axis
      currentZ += wallWidth - OVERLAP
      totalZExtent = Math.max(totalZExtent, currentZ)
    }
  }
  
  // Find the maximum wall width to account for wall half-widths at the edges
  const maxWallWidth = Math.max(...wallConfig.walls.map(w => w.width * SCALE))
  
  // The bounds are: total extent plus half a wall width on each end (for the wall thickness)
  // Add some padding (2 feet) around the walls for visual breathing room
  const PADDING_INCHES = 2 * SCALE // 2 feet padding
  const boundsWidth = totalXExtent + maxWallWidth + PADDING_INCHES * 2
  const boundsDepth = totalZExtent + maxWallWidth + PADDING_INCHES * 2
  
  return {
    width: boundsWidth / SCALE,
    depth: boundsDepth / SCALE
  }
}

const getFootprint = (studio: GalleryStudio) => {
  // Use boundingBox if available (it contains the calculated actual bounds)
  const boundingBox = studio.boundingBox
  if (boundingBox) {
    return { width: boundingBox.width, depth: boundingBox.depth }
  }
  
  // For gallery studios with zigzag layout, calculate actual bounds
  if (studio.wallConfig?.layoutType === 'zigzag') {
    return calculateZigzagBounds(studio.wallConfig, true)
  }
  
  // Fallback to old method for non-zigzag layouts
  const wallWidth = studio.wallConfig?.walls?.[0]?.width
  const wallDepth = studio.wallConfig?.walls?.[1]?.width
  const width = wallWidth ?? DEFAULT_ROOM.width
  const depth = wallDepth ?? DEFAULT_ROOM.depth
  return { width, depth }
}

const getEntrancePosition = (studio: GalleryStudio) => {
  const pos = studio.galleryPosition || { x: 0, z: 0 }
  const rotation = studio.galleryRotation ?? 0
  const { depth } = getFootprint(studio)
  // Entrance is in front of the studio (along +Z when rotation is 0)
  // Rotate the entrance position based on studio rotation
  const entranceLocalZ = depth / 2 + 0.2
  const entranceX = pos.x + Math.sin(rotation) * entranceLocalZ
  const entranceZ = pos.z + Math.cos(rotation) * entranceLocalZ
  return new THREE.Vector3(entranceX, 0, entranceZ)
}

const buildWallConfig = (footprint?: { width: number; depth: number }, forGallery: boolean = false) => {
  const width = footprint?.width ?? DEFAULT_ROOM.width
  const depth = footprint?.depth ?? DEFAULT_ROOM.depth
  
  // For gallery studios, create zigzag walls that fit inside a fixed 60ft x 30ft rectangle
  if (forGallery) {
    const STUDIO_WIDTH = 60 // 60ft wide
    const STUDIO_DEPTH = 30 // 30ft deep
    // Walls need to fit within 60x30ft rectangle
    // Horizontal walls (even indices) can be up to 60ft
    // Vertical walls (odd indices) can be up to 30ft
    const HORIZONTAL_WALL_WIDTH = 20 // Horizontal walls: 20ft wide (fits in 60ft)
    const VERTICAL_WALL_WIDTH = 15 // Vertical walls: 15ft wide (fits in 30ft)
    const wallCount = 5 // 4-6 walls, using 5 as middle ground
    
    const walls: Array<{ height: number; width: number }> = []
    
    // Create alternating horizontal and vertical walls
    // Horizontal walls (even indices) use HORIZONTAL_WALL_WIDTH
    // Vertical walls (odd indices) use VERTICAL_WALL_WIDTH
    for (let i = 0; i < wallCount; i++) {
      walls.push({ 
        height: DEFAULT_ROOM.height, 
        width: i % 2 === 0 ? HORIZONTAL_WALL_WIDTH : VERTICAL_WALL_WIDTH
      })
    }
    
    return {
      layoutType: 'zigzag' as const,
      walls,
    }
  }
  
  // For regular studios, use standard 4-wall configuration
  return {
    layoutType: 'zigzag' as const,
    walls: [
      { height: DEFAULT_ROOM.height, width },
      { height: DEFAULT_ROOM.height, width: depth },
      { height: DEFAULT_ROOM.height, width },
      { height: DEFAULT_ROOM.height, width: depth },
    ],
  }
}

const mockNames = [
  'Urban Design Lab',
  'Creative Studio',
  'Tech Collective',
  'Material Futures',
  'Adaptive Habitat',
  'Light & Space',
  'Civic Ideas',
  'Digital Fabrication',
  'Eco Systems',
  'Narrative Spaces',
  'Interface Studio',
  'Color Field'
]

const mockDepartments = ['Design', 'Engineering', 'Art', 'Architecture', 'Media', 'Computation']

const randomBetween = (min: number, max: number) => Math.random() * (max - min) + min

function generateMockStudios(count = 9): GalleryStudio[] {
  const studios: GalleryStudio[] = []
  const cols = 3
  const spacingX = DEFAULT_ROOM.width + WALKWAY + 5 // ~30
  const spacingZ = DEFAULT_ROOM.depth + WALKWAY + 5 // ~25

  for (let i = 0; i < count; i++) {
    const width = parseFloat(randomBetween(18, 24).toFixed(1))
    const depth = parseFloat(randomBetween(14, 20).toFixed(1))
    const row = Math.floor(i / cols)
    const col = i % cols
    const x = col * spacingX
    const z = row * spacingZ
    const name = mockNames[i % mockNames.length]
    const dept = mockDepartments[i % mockDepartments.length]

    const boards: Board[] = Array.from({ length: Math.floor(randomBetween(6, 10)) }).map((_, idx) => {
      const id = `mock-board-${i}-${idx}`
      const title = `${name} Pin ${idx + 1}`
      const wallIndex = Math.floor(Math.random() * 4)
      const px = parseFloat(randomBetween(-0.3, 0.3).toFixed(3))
      const py = parseFloat(randomBetween(-0.2, 0.2).toFixed(3))
      const w = parseFloat(randomBetween(0.2, 0.35).toFixed(3))
      const h = parseFloat(randomBetween(0.2, 0.35).toFixed(3))
      return {
        id,
        studioId: `mock-studio-${i}`,
        studentName: 'Mock User',
        title,
        thumbnailUrl: '',
        fullImageUrl: '',
        uploadedAt: new Date(),
        position: { wallIndex, x: px, y: py, width: w, height: h },
        ownerColor: `hsl(${(i * 35 + idx * 20) % 360}, 70%, 60%)`,
      }
    })

    const wallConfig = buildWallConfig({ width, depth }, true) // true = for gallery

    studios.push({
      id: `mock-studio-${i}`,
      studioId: `mock-studio-${i}`,
      name,
      department: dept,
      year: 2024,
      studentCount: Math.floor(randomBetween(8, 24)),
      boundingBox: { width, depth },
      galleryPosition: { x, z },
      boards,
      wallConfig,
      isMock: true,
    })
  }

  // Center grid around origin
  const maxRow = Math.ceil(count / 3)
  const offsetX = ((cols - 1) * spacingX) / 2
  const offsetZ = ((maxRow - 1) * spacingZ) / 2
  return studios.map((s) => ({
    ...s,
    galleryPosition: { x: (s.galleryPosition?.x || 0) - offsetX, z: (s.galleryPosition?.z || 0) - offsetZ },
  }))
}

type MoveKeys = {
  forward: boolean
  back: boolean
  left: boolean
  right: boolean
}

function Ground({ onHover }: { onHover: (hovered: boolean) => void }) {
  // Make floor almost infinite - 50,000 inches = ~4167 feet = ~0.8 miles
  // This ensures walls never look like they're floating
  const FLOOR_SIZE = 50000 // 50,000 inches = ~4167 feet
  
  return (
    <mesh
      position={[0, 0, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      receiveShadow
      onPointerMove={(e) => {
        e.stopPropagation()
        onHover(true)
      }}
      onPointerOut={() => onHover(false)}
    >
      <planeGeometry args={[FLOOR_SIZE, FLOOR_SIZE]} />
      <meshStandardMaterial
        color="#e5e7eb"
        roughness={0.95}
        metalness={0}
        polygonOffset
        polygonOffsetFactor={-1}
        polygonOffsetUnits={-1}
        flatShading={false}
      />
    </mesh>
  )
}

function Avatar({ position, color = '#6366f1', isWalking, heading }: { position: Vec3; color?: string; isWalking: boolean; heading: number }) {
  const groupRef = useRef<THREE.Group>(null)
  const bodyRef = useRef<THREE.Mesh>(null)
  
  // Scale factor: 5.5 feet = 66 inches
  // Original avatar was ~2.9 units tall, so scale by 66/2.9 ≈ 22.76
  // For cleaner numbers, let's make it exactly 66" tall
  // Body: 2.2 units tall, positioned at y=1.5, so top is at 2.6
  // Head: at y=2.7 with radius 0.2, so top is at 2.9
  // Total: 2.9 units → should be 66 inches
  const SCALE = 66 / 2.9 // ≈ 22.76
  const BODY_HEIGHT = 2.2 * SCALE // ≈ 50 inches
  const BODY_Y = 33 // Body center at 33" (half of 66")
  const HEAD_Y = 58 // Head center at 58" (body top ~58" + head radius)
  const HEAD_RADIUS = 4.5 // Head radius ~4.5"
  const ARM_LENGTH = 0.6 * SCALE // ≈ 13.6"
  const LEG_LENGTH = 1.2 * SCALE // ≈ 27.3"
  const ARM_Y = 50 // Arms at ~50" height
  const LEG_Y = 13.6 // Legs at ~13.6" height
  
  useFrame((state) => {
    const t = state.clock.getElapsedTime()
    const bob = isWalking ? Math.sin(t * 8) * 0.9 : 0 // Scale bob animation too
    if (bodyRef.current) {
      bodyRef.current.position.y = BODY_Y + bob
    }
    if (groupRef.current) {
      groupRef.current.rotation.y = THREE.MathUtils.lerp(groupRef.current.rotation.y, heading, 0.2)
    }
  })

  return (
    <group position={[position.x, position.y, position.z]} ref={groupRef}>
      {/* Head */}
      <mesh position={[0, HEAD_Y, 0]} castShadow>
        <sphereGeometry args={[HEAD_RADIUS, 24, 24]} />
        <meshStandardMaterial color={color} roughness={0.4} metalness={0.1} />
      </mesh>

      {/* Body (capsule-like) */}
      <mesh ref={bodyRef} position={[0, BODY_Y, 0]} castShadow>
        <cylinderGeometry args={[0.22 * SCALE, 0.26 * SCALE, BODY_HEIGHT, 16]} />
        <meshStandardMaterial color={color} roughness={0.4} metalness={0.1} />
      </mesh>

      {/* Arms */}
      <mesh position={[0.32 * SCALE, ARM_Y, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.07 * SCALE, 0.07 * SCALE, ARM_LENGTH, 12]} />
        <meshStandardMaterial color={color} roughness={0.4} metalness={0.1} />
      </mesh>
      <mesh position={[-0.32 * SCALE, ARM_Y, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.07 * SCALE, 0.07 * SCALE, ARM_LENGTH, 12]} />
        <meshStandardMaterial color={color} roughness={0.4} metalness={0.1} />
      </mesh>

      {/* Legs */}
      <mesh position={[0.1 * SCALE, LEG_Y, 0]} rotation={[0, 0, Math.PI / 2.2]} castShadow>
        <cylinderGeometry args={[0.1 * SCALE, 0.1 * SCALE, LEG_LENGTH, 12]} />
        <meshStandardMaterial color={color} roughness={0.4} metalness={0.1} />
      </mesh>
      <mesh position={[-0.1 * SCALE, LEG_Y, 0]} rotation={[0, 0, -Math.PI / 2.2]} castShadow>
        <cylinderGeometry args={[0.1 * SCALE, 0.1 * SCALE, LEG_LENGTH, 12]} />
        <meshStandardMaterial color={color} roughness={0.4} metalness={0.1} />
      </mesh>

      {/* Soft shadow decal */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} receiveShadow>
        <circleGeometry args={[0.35 * SCALE, 32]} />
        <meshBasicMaterial color="#000000" opacity={0.18} transparent />
      </mesh>
    </group>
  )
}

function CameraRig({
  targetRef,
  orbitState,
  aimingRef,
}: {
  targetRef: React.MutableRefObject<Vec3>
  orbitState: React.MutableRefObject<{ yaw: number; pitch: number; radius: number }>
  aimingRef: React.MutableRefObject<boolean>
}) {
  const lookAt = useRef(new THREE.Vector3())
  const isRestoringRef = useRef(false)
  const restoreFrameCount = useRef(0)

  // Check if we need to restore camera position immediately (returning from board view)
  useEffect(() => {
    const savedState = sessionStorage.getItem('galleryState')
    if (savedState) {
      try {
        const state = JSON.parse(savedState)
        if (state.cameraYaw !== undefined || state.cameraPitch !== undefined || state.cameraRadius !== undefined) {
          // Mark that we're restoring - use immediate positioning for first frame
          isRestoringRef.current = true
          restoreFrameCount.current = 0
        }
      } catch (e) {
        // Ignore
      }
    }
  }, [])

  useFrame((state, delta) => {
    const camera = state.camera as THREE.PerspectiveCamera
    const target = targetRef.current
    const { yaw } = orbitState.current
    const pitch = THREE.MathUtils.clamp(orbitState.current.pitch, PITCH_MIN, PITCH_MAX)
    const targetRadius = aimingRef.current ? AIM_RADIUS : CAMERA_RADIUS
    const targetHeight = aimingRef.current ? CAMERA_HEIGHT * 0.9 : CAMERA_HEIGHT

    const horizontal = Math.cos(pitch) * targetRadius
    const desired = new THREE.Vector3(
      target.x + Math.sin(yaw) * horizontal,
      target.y + targetHeight + Math.sin(pitch) * targetRadius,
      target.z + Math.cos(yaw) * horizontal
    )

    // If restoring, use immediate positioning for first frame, then lerp
    if (isRestoringRef.current && restoreFrameCount.current === 0) {
      camera.position.copy(desired)
      isRestoringRef.current = false
    } else {
      camera.position.lerp(desired, ORBIT_LERP)
    }
    restoreFrameCount.current++
    // Look at avatar's head level (58 inches = eye level)
    lookAt.current.set(target.x, target.y + 58, target.z)
    camera.lookAt(lookAt.current.x, lookAt.current.y, lookAt.current.z)
    const targetFov = aimingRef.current ? AIM_FOV : 55
    camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, 0.1)
    camera.updateProjectionMatrix()
  })

  return null
}

function StudioLabel({
  name,
  width,
  depth,
  height,
  highlighted,
  onClick,
}: {
  name: string
  width: number
  depth: number
  height: number
  highlighted?: boolean
  onClick?: () => void
}) {
  const fontSize = Math.min(width * 0.12, 1.4)
  // Place text almost touching the wall top; anchor from its bottom
  const y = Math.max(0.8, height - 0.05)
  const z = depth / 2 + 0.05
  return (
    <group position={[0, y, z]}>
      <Text
        fontSize={fontSize}
        color={highlighted ? '#6366f1' : '#94a3b8'}
        outlineColor={highlighted ? '#6366f1' : '#cbd5e1'}
        outlineWidth={highlighted ? 0.06 : 0.03}
        outlineOpacity={0.45}
        anchorX="center"
        anchorY="bottom"
        onPointerOver={(e) => e.stopPropagation()}
        onPointerDown={(e) => {
          e.stopPropagation()
          onClick?.()
        }}
      >
        {name}
      </Text>
    </group>
  )
}

function StudioPlot({
  studio,
  position,
  onTeleport,
  nearby,
  renderBoards,
  highlightedBoardId,
}: {
  studio: GalleryStudio
  position: Vec3
  onTeleport: () => void
  nearby?: boolean
  renderBoards: boolean
  highlightedBoardId?: string | null
}) {
  const { width, depth } = getFootprint(studio)
  const wallConfig = studio.wallConfig || buildWallConfig({ width, depth }, true) // true = for gallery
  const wallHeight = wallConfig?.walls?.[0]?.height ?? DEFAULT_ROOM.height

  const rotation = studio.galleryRotation ?? 0
  
  // Convert feet to inches for rendering (scene uses 1 unit = 1 inch)
  // Avatar is 66 inches (5.5ft), square is 60ft = 720 inches
  const INCHES_PER_FOOT = 12
  const squareWidthInches = width * INCHES_PER_FOOT
  const squareDepthInches = depth * INCHES_PER_FOOT
  
  // Ensure wallConfig has zigzag layout type
  const finalWallConfig = { ...wallConfig, layoutType: 'zigzag' as const }
  
  return (
    <group position={[position.x, 0, position.z]} rotation={[0, rotation, 0]}>
      {/* Studio border removed - no blue squares visible */}
      
      {/* Walls with boards - zigzag layout */}
      {/* Always render walls, but only render boards when close for performance */}
      <WallSystem
        boards={renderBoards ? (studio.boards || []) : []}
        wallConfig={finalWallConfig}
        onWallClick={() => {}} // No wall editing in gallery view
        editingWall={null}
        onBoardClick={undefined} // Disable board clicks in gallery - only E key opens boards
        highlightedBoardId={highlightedBoardId}
      />
      
      <StudioLabel
        name={studio.name}
        width={width}
        depth={depth}
        height={wallHeight}
        highlighted={nearby}
        onClick={onTeleport}
      />
    </group>
  )
}

function BoardProximityDetector({
  studios,
  avatarPos,
  onNearbyBoardChange,
}: {
  studios: GalleryStudio[]
  avatarPos: Vec3
  onNearbyBoardChange: (board: { board: Board; studio: GalleryStudio; position: THREE.Vector3 } | null) => void
}) {
  const INTERACTION_DISTANCE = 300 // 300 inches = 25 feet - increased for better detection
  const frameCount = useRef(0)
  const lastUpdateRef = useRef<{ board: Board; studio: GalleryStudio; position: THREE.Vector3 } | null>(null)
  const lastCheckTime = useRef(0)
  const forceUpdateRef = useRef(false)
  
  // Force immediate detection when component mounts (e.g., returning from board view)
  useEffect(() => {
    forceUpdateRef.current = true
    const timer = setTimeout(() => {
      forceUpdateRef.current = false
    }, 2000) // Force immediate updates for 2 seconds after mount
    return () => clearTimeout(timer)
  }, [])
  
  // Run every frame for maximum responsiveness (60fps)
  // Skip throttling if we need to force an immediate update
  useFrame((state, delta) => {
    const now = state.clock.elapsedTime * 1000 // Convert to milliseconds
    // Only throttle if we just updated very recently AND we're not forcing an update
    if (!forceUpdateRef.current && now - lastCheckTime.current < 16) return
    
    frameCount.current++
    lastCheckTime.current = now
    
    // Use avatar position (not camera) for distance calculation - avatar is where the player actually is
    const avatarWorldPos = new THREE.Vector3(avatarPos.x, avatarPos.y + 58, avatarPos.z) // Avatar eye level
    
    // Use distance-based detection to detect ALL nearby boards
    type ClosestBoardType = { board: Board; studio: GalleryStudio; position: THREE.Vector3 }
    let closestBoard: ClosestBoardType | null = null
    let closestDistance = Infinity
    
    // Check all boards in rendered studios
    studios.forEach((studio) => {
      const studioPos = studio.galleryPosition || { x: 0, z: 0 }
      
      // Early exit: skip studios that are too far away
      const studioDistance = Math.hypot(
        studioPos.x - avatarPos.x,
        studioPos.z - avatarPos.z
      )
      if (studioDistance > INTERACTION_DISTANCE * 1.5) return // Skip studios beyond interaction range
      
      const wallConfig = studio.wallConfig || buildWallConfig(getFootprint(studio), true) // true = for gallery
      const boards = studio.boards || []
      
      boards.forEach((board: Board) => {
        if (!board.position) return
        
        // Calculate board world position (same logic as WallSystem)
        const wallIndex = board.position.wallIndex ?? 0
        const wall = wallConfig.walls?.[wallIndex]
        if (!wall) return
        
        const wallTransform = getWallTransform(wall, wallIndex, wallConfig)
        const boardX = board.position.x * wallTransform.width
        const boardY = board.position.y * wallTransform.height
        
        // Use correct Z positioning (matching WallSystem logic exactly)
        const WALL_DEPTH = 4
        const WALL_SURFACE_OFFSET = WALL_DEPTH / 2 // 2 inches from wall center to surface
        const BOARD_OFFSET = 0.2 // Match WallSystem offset (0.2 inches)
        
        // Determine which direction is "outward" for this wall (1 for +Z, -1 for -Z)
        // This matches the getOutwardZDirection logic from WallSystem
        const normalizedRotation = ((wallTransform.rotationY % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
        const isVerticalWall = (
          (normalizedRotation > Math.PI/4 && normalizedRotation < 3*Math.PI/4) ||
          (normalizedRotation > 5*Math.PI/4 && normalizedRotation < 7*Math.PI/4)
        )
        const outwardDirection = isVerticalWall ? -1 : 1
        
        // Position board at wall surface (matching WallSystem exactly)
        const boardSide = board.position.side || 'front'
        const baseZ = (boardSide === 'back' ? -outwardDirection : outwardDirection) * WALL_SURFACE_OFFSET
        const boardZ = baseZ + (boardSide === 'back' ? -BOARD_OFFSET : BOARD_OFFSET)
        
        // Clamp to ensure board is outside wall (matching WallSystem safety check)
        const WALL_OUTER_BOUND = WALL_SURFACE_OFFSET + BOARD_OFFSET // 2.2 inches
        const finalBoardZ = boardSide === 'back' 
          ? Math.min(boardZ, -WALL_OUTER_BOUND)
          : Math.max(boardZ, WALL_OUTER_BOUND)
        
        const localPos = new THREE.Vector3(boardX, boardY, finalBoardZ)
        localPos.applyAxisAngle(new THREE.Vector3(0, 1, 0), wallTransform.rotationY)
        
        const worldPos = new THREE.Vector3(
          studioPos.x + wallTransform.x + localPos.x,
          wallTransform.height / 2 + localPos.y,
          studioPos.z + wallTransform.z + localPos.z
        )
        
        // Calculate distance from avatar (not camera) to board center
        const distance = avatarWorldPos.distanceTo(worldPos)
        
        // Check if board is within interaction distance
        if (distance > INTERACTION_DISTANCE || distance >= closestDistance) return
        
        // No angle restriction - player can interact with boards from any angle
        // The 3D distance check is sufficient to ensure boards are nearby
        
        // This board is the closest so far
        closestBoard = { board, studio, position: worldPos }
        closestDistance = distance
      })
    })
    
    // Update nearby board - only call callback if board actually changed
    if (closestBoard) {
      // TypeScript type narrowing fix - explicitly type the destructured values
      const board = (closestBoard as ClosestBoardType).board
      const studio = (closestBoard as ClosestBoardType).studio
      const position = (closestBoard as ClosestBoardType).position
      // Check if this is actually a different board to avoid unnecessary updates
      const lastBoard = lastUpdateRef.current
      if (!lastBoard || lastBoard.board.id !== board.id) {
        lastUpdateRef.current = { board, studio, position }
        onNearbyBoardChange({ board, studio, position })
      }
    } else {
      // Only clear if we had a board before
      if (lastUpdateRef.current) {
        lastUpdateRef.current = null
        onNearbyBoardChange(null)
      }
    }
  })
  
  return null
}

// Helper function to get wall transform (matches WallSystem logic exactly)
function getWallTransform(wall: { width: number; height: number }, wallIndex: number, wallConfig: any) {
  const SCALE = 12 // 1 unit = 1 inch, so 8ft = 96 units
  const layoutType = wallConfig.layoutType || 'square'
  const walls = wallConfig.walls || []
  const width = wall.width * SCALE
  const height = wall.height * SCALE
  let x = 0
  let z = 0
  let rotationY = 0
  
  switch (layoutType) {
    case 'zigzag': {
      const WALL_DEPTH = 4
      const OVERLAP = WALL_DEPTH / 2
      let currentX = 0
      let currentZ = 0
      
      for (let i = 0; i < wallIndex; i++) {
        const prevWidth = walls[i].width * SCALE
        if (i % 2 === 0) {
          currentX += prevWidth - (i > 0 ? OVERLAP : 0)
        } else {
          currentZ += prevWidth - OVERLAP
        }
      }
      
      if (wallIndex % 2 === 0) {
        x = currentX + width / 2 - (wallIndex > 0 ? OVERLAP / 2 : 0)
        z = currentZ
        rotationY = 0
      } else {
        x = currentX
        z = currentZ + width / 2 - OVERLAP / 2
        rotationY = Math.PI / 2
      }
      
      // Center the entire zigzag around the origin
      let totalXExtent = 0
      let totalZExtent = 0
      let tempX = 0
      let tempZ = 0
      
      for (let i = 0; i < walls.length; i++) {
        const w = walls[i].width * SCALE
        if (i % 2 === 0) {
          tempX += w - (i > 0 ? OVERLAP : 0)
          totalXExtent = Math.max(totalXExtent, tempX)
        } else {
          tempZ += w - OVERLAP
          totalZExtent = Math.max(totalZExtent, tempZ)
        }
      }
      
      x -= totalXExtent / 2
      z -= totalZExtent / 2
      break
    }
    
    case 'square': {
      const wallWidths = walls.map((w: { width: number; height: number }) => w.width * SCALE)
      if (wallIndex === 0) {
        x = 0
        z = wallWidths[0] / 2
        rotationY = 0
      } else if (wallIndex === 1) {
        x = wallWidths[0] / 2
        z = 0
        rotationY = Math.PI / 2
      } else if (wallIndex === 2) {
        x = 0
        z = -wallWidths[2] / 2
        rotationY = Math.PI
      } else if (wallIndex === 3) {
        x = -wallWidths[0] / 2
        z = 0
        rotationY = -Math.PI / 2
      }
      break
    }
    
    default: {
      // Fallback for other layouts
      const spacing = width + 24
      x = wallIndex * spacing - (walls.length * spacing) / 2
      z = 0
      rotationY = 0
    }
  }
  
  return { x, z, rotationY, width, height }
}

function SceneContents({
  studios,
  onTeleport,
  nearbyStudioId,
  avatarPos,
  onNearbyBoardChange,
  highlightedBoardId,
  nearbyBoard,
}: {
  studios: GalleryStudio[]
  onTeleport: (studio: GalleryStudio) => void
  nearbyStudioId?: string | null
  avatarPos: Vec3
  onNearbyBoardChange: (board: { board: Board; studio: GalleryStudio; position: THREE.Vector3 } | null) => void
  highlightedBoardId?: string | null
  nearbyBoard?: { board: Board; studio: GalleryStudio; position: THREE.Vector3 } | null
}) {
  const studiosSorted = useMemo(() => {
    const withDist = studios.map((s) => {
      const pos = s.galleryPosition || { x: 0, z: 0 }
      const dx = pos.x - avatarPos.x
      const dz = pos.z - avatarPos.z
      return { studio: s, dist: Math.hypot(dx, dz) }
    })
    withDist.sort((a, b) => a.dist - b.dist)
    return withDist.slice(0, MAX_RENDER_STUDIOS)
  }, [studios, avatarPos])

  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight
        position={[96, 144, 72]} // Scaled: 8ft, 12ft, 6ft
        intensity={1}
        castShadow
        shadow-bias={-0.0001}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={6} // 6 inches
        shadow-camera-far={1440} // 1440 inches = 120 feet
        shadow-camera-left={-720} // -720 inches = -60 feet
        shadow-camera-right={720} // 720 inches = 60 feet
        shadow-camera-top={720} // 720 inches = 60 feet
        shadow-camera-bottom={-720} // -720 inches = -60 feet
      />
      {/* Soft spotlights */}
      {studiosSorted.map(({ studio }, i) => {
        const pos = studio.galleryPosition || { x: 0, z: 0 }
        return (
          <spotLight
            key={`spot-${studio.id}`}
            position={[pos.x, 108, pos.z]} // 108 inches = 9 feet high
            angle={0.9}
            intensity={0.35}
            distance={216} // 216 inches = 18 feet
            penumbra={0.6}
            color={i % 2 === 0 ? '#c7d2fe' : '#e0f2fe'}
            shadow-bias={-0.0001}
          />
        )
      })}

      {/* Ambient particles */}
      <Particles />
      
      {/* Board proximity detector - only check rendered studios for performance */}
      <BoardProximityDetector
        studios={studiosSorted.map(({ studio }) => studio)}
        avatarPos={avatarPos}
        onNearbyBoardChange={onNearbyBoardChange}
      />

      {studiosSorted.map(({ studio, dist }) => {
        // Render boards for studios within 1000 inches (~83 feet) so they're always visible
        const MAX_BOARD_RENDER_DISTANCE = 1000
        const shouldRenderBoards = dist < MAX_BOARD_RENDER_DISTANCE
        
        return (
          <StudioPlot
            key={studio.id}
            studio={studio}
            position={{ x: studio.galleryPosition?.x ?? 0, y: 0, z: studio.galleryPosition?.z ?? 0 }}
            onTeleport={() => onTeleport(studio)}
            nearby={nearbyStudioId === studio.id}
            renderBoards={shouldRenderBoards}
            highlightedBoardId={highlightedBoardId}
          />
        )
      })}
      
      {/* "E" interaction prompt for nearby boards - must be inside Canvas */}
      {nearbyBoard && (
        <Html
          position={[nearbyBoard.position.x, nearbyBoard.position.y + 12, nearbyBoard.position.z]}
          center
          style={{ pointerEvents: 'none' }}
        >
          <div className="bg-black/80 text-white px-4 py-2 rounded-lg font-bold text-xl border-2 border-white shadow-lg">
            E
          </div>
        </Html>
      )}
    </>
  )
}

export default function Gallery3D({ avatarColor, avatarPosition, department, year, isDemo = false }: Gallery3DProps) {
  const [studios, setStudios] = useState<GalleryStudio[]>([])
  const [loading, setLoading] = useState(false)
  const [avatarPos, setAvatarPos] = useState<Vec3>(avatarPosition ?? { x: 0, y: 0, z: 0 })
  const [avatarDir, setAvatarDir] = useState<number>(0)
  const [hoverFloor, setHoverFloor] = useState(false)
  const moveKeysRef = useRef<MoveKeys>({ forward: false, back: false, left: false, right: false })
  const sprintRef = useRef<boolean>(false)
  const jumpRequestRef = useRef<boolean>(false)
  const velocityYRef = useRef<number>(0)
  const groundedRef = useRef<boolean>(true)
  const aimingRef = useRef<boolean>(false)
  const avatarRef = useRef<Vec3>(avatarPos)
  const [isWalking, setIsWalking] = useState(false)
  const [hoveredPin, setHoveredPin] = useState<{ id: string; name: string; position: THREE.Vector3 } | null>(null)
  const orbitRef = useRef<{ yaw: number; pitch: number; radius: number }>({ yaw: 0, pitch: 0.15, radius: CAMERA_RADIUS })
  const [cursorMode, setCursorMode] = useState<'crosshair' | 'cell' | 'pointer' | 'zoom-in'>('crosshair')
  const [pointerLocked, setPointerLocked] = useState(false)
  const [nearEntrance, setNearEntrance] = useState(false)
  const [promptStudio, setPromptStudio] = useState<{ studio: GalleryStudio; entrance: THREE.Vector3 } | null>(null)
  const [selectedBoard, setSelectedBoard] = useState<{ board: Board; studio: GalleryStudio } | null>(null)
  const [nearbyBoard, setNearbyBoard] = useState<{ board: Board; studio: GalleryStudio; position: THREE.Vector3 } | null>(null)
  const nearbyBoardRef = useRef<{ board: Board; studio: GalleryStudio; position: THREE.Vector3 } | null>(null)
  const router = useRouter()
  
  // Keep ref in sync with state - update immediately for responsive E key handling
  useEffect(() => {
    nearbyBoardRef.current = nearbyBoard
    // Log for debugging
    if (nearbyBoard) {
      console.log('🎯 [Gallery] Nearby board updated:', nearbyBoard.board.id, nearbyBoard.board.title)
    } else {
      console.log('🎯 [Gallery] Nearby board cleared')
    }
  }, [nearbyBoard])
  
  // Reset board detection when returning from view page
  useEffect(() => {
    // Check if we just returned from a view page by checking if there's saved state
    const savedState = sessionStorage.getItem('galleryState')
    if (savedState) {
      // Clear nearby board to force fresh detection immediately
      setNearbyBoard(null)
      nearbyBoardRef.current = null
      console.log('🔄 [Gallery] Reset board detection after returning from view page')
    }
  }, [])
  // Start avatar near center of expected cluster, or restore from saved position
  useEffect(() => {
    const savedState = sessionStorage.getItem('galleryState')
    if (savedState) {
      try {
        const state = JSON.parse(savedState)
        if (state.avatarPos) {
          // Immediately restore position (no lerp delay)
          avatarRef.current = state.avatarPos
          setAvatarPos(state.avatarPos)
          // Immediately restore camera state (no lerp delay)
          if (state.cameraYaw !== undefined) {
            orbitRef.current.yaw = state.cameraYaw
          }
          if (state.cameraPitch !== undefined) {
            orbitRef.current.pitch = state.cameraPitch
          }
          if (state.cameraRadius !== undefined) {
            orbitRef.current.radius = state.cameraRadius
          }
          console.log('📍 [Gallery] Restored position from session:', state)
        }
      } catch (e) {
        console.warn('Failed to restore gallery state:', e)
        // Fallback to default
        avatarRef.current = { x: 25, y: 0, z: 15 }
        setAvatarPos({ x: 25, y: 0, z: 15 })
      }
    } else {
      avatarRef.current = { x: 25, y: 0, z: 15 }
      setAvatarPos({ x: 25, y: 0, z: 15 })
    }
  }, [])
  
  // Also restore camera when component becomes visible again (e.g., returning from board view)
  useEffect(() => {
    // Check if we're returning from a board view by checking if there's saved state
    const savedState = sessionStorage.getItem('galleryState')
    if (savedState) {
      try {
        const state = JSON.parse(savedState)
        // Restore camera state immediately when component is visible
        if (state.cameraYaw !== undefined) {
          orbitRef.current.yaw = state.cameraYaw
        }
        if (state.cameraPitch !== undefined) {
          orbitRef.current.pitch = state.cameraPitch
        }
        if (state.cameraRadius !== undefined) {
          orbitRef.current.radius = state.cameraRadius
        }
        // Also ensure avatar position is restored
        if (state.avatarPos) {
          avatarRef.current = state.avatarPos
          setAvatarPos(state.avatarPos)
        }
      } catch (e) {
        // Ignore errors
      }
    }
  }, []) // Run on mount and when component becomes visible
  const teleportToStudio = (studio: GalleryStudio) => {
    const entrance = getEntrancePosition(studio)
    avatarRef.current = { x: entrance.x, y: 0, z: entrance.z }
    setAvatarPos({ x: entrance.x, y: 0, z: entrance.z })
  }

  const enterStudio = (studio: GalleryStudio) => {
    const slug = studio.studioId || studio.id
    router.push(`/studio/${slug}`)
  }

  useEffect(() => {
    avatarRef.current = avatarPos
  }, [avatarPos])

  // Track pointer lock for continuous turning even at screen edges
  useEffect(() => {
    const handleLockChange = () => setPointerLocked(document.pointerLockElement !== null)
    document.addEventListener('pointerlockchange', handleLockChange)
    return () => document.removeEventListener('pointerlockchange', handleLockChange)
  }, [])

  // Keyboard controls
  useEffect(() => {
    const handler = (e: KeyboardEvent, isDown: boolean) => {
      if (e.repeat) return
      const mk = moveKeysRef.current
      const key = e.key.toLowerCase()
      if (key === 'w') mk.forward = isDown
      if (key === 's' || e.key === 'ArrowDown') mk.back = isDown
      if (key === 'a') mk.left = isDown
      if (key === 'd') mk.right = isDown
      if (e.key === 'Shift') sprintRef.current = isDown
      if (isDown && e.code === 'Space') jumpRequestRef.current = true

      if (e.key === 'ArrowLeft') orbitRef.current.yaw -= 0.1
      if (e.key === 'ArrowRight') orbitRef.current.yaw += 0.1

      if (isDown && e.key.toLowerCase() === 'e') {
        // Check if near a board first (priority over studio entrance)
        // Use ref to get the most current value at the moment E is pressed
        // Also check state directly as a fallback for immediate response
        const currentNearbyBoard = nearbyBoardRef.current || nearbyBoard
        if (currentNearbyBoard) {
          console.log('⌨️ [Gallery] E key pressed, nearby board:', {
            fromRef: !!nearbyBoardRef.current,
            fromState: !!nearbyBoard,
            boardId: currentNearbyBoard.board.id,
            boardTitle: currentNearbyBoard.board.title
          })
          // Save current gallery position before navigating
          const galleryState = {
            avatarPos: { ...avatarRef.current },
            cameraYaw: orbitRef.current.yaw,
            cameraPitch: orbitRef.current.pitch,
            cameraRadius: orbitRef.current.radius
          }
          sessionStorage.setItem('galleryState', JSON.stringify(galleryState))
          console.log('💾 [Gallery] Saved position before navigation:', galleryState)
          
          // Navigate to studio view page with boardId query param to open lightbox directly
          const studioId = currentNearbyBoard.studio.studioId || currentNearbyBoard.studio.id
          console.log('🎯 [Gallery] Pressing E on board:', {
            boardId: currentNearbyBoard.board.id,
            boardTitle: currentNearbyBoard.board.title,
            studioId: studioId,
            isDemo: isDemo,
            allBoardIds: currentNearbyBoard.studio.boards?.map(b => ({ id: b.id, title: b.title }))
          })
          
          // Use regular studio view page - it handles demo mode automatically
          // The view page detects demo mode by checking if studioId starts with "demo-studio-"
          // or by the demo=true param
          // Preserve gallery filters (department, year) when navigating to board view
          const params = new URLSearchParams()
          params.set('boardId', currentNearbyBoard.board.id)
          params.set('returnTo', 'gallery')
          if (isDemo) params.set('demo', 'true')
          if (department) params.set('department', department)
          if (year) params.set('year', year)
          const url = `/studio/${studioId}/view?${params.toString()}`
          router.push(url)
        } else if (promptStudio?.studio) {
          enterStudio(promptStudio.studio)
        }
      }
    }
    const down = (e: KeyboardEvent) => handler(e, true)
    const up = (e: KeyboardEvent) => handler(e, false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [nearbyBoard, promptStudio, router, isDemo])

  useEffect(() => {
    const fetchStudios = async () => {
      // Create cache key that includes filters to prevent invalid cache usage
      const cacheKey = `galleryStudiosCache_${department || 'all'}_${year || 'all'}_${isDemo ? 'demo' : 'real'}`
      
      // Check for cached studios data first for instant loading
      const cachedData = sessionStorage.getItem(cacheKey)
      if (cachedData) {
        try {
          const cached = JSON.parse(cachedData)
          const cacheTimestamp = cached.timestamp || 0
          const cacheAge = Date.now() - cacheTimestamp
          // Use cache if it's less than 30 minutes old (much longer for better performance)
          if (cacheAge < 30 * 60 * 1000) {
            console.log('📦 [Gallery] Using cached studios data for instant load')
            setStudios(cached.studios || [])
            setLoading(false)
            // Don't fetch fresh data in background - use cache until user explicitly refreshes
            // This prevents blocking board detection
            return
          } else {
            console.log('📦 [Gallery] Cache expired, fetching fresh data')
            setLoading(true)
          }
        } catch (e) {
          console.error('Error parsing cached studios:', e)
          setLoading(true)
        }
      } else {
        setLoading(true)
      }
      
      try {
        // Pass filters to API to filter server-side (much more efficient)
        const params = new URLSearchParams()
        if (isDemo) params.set('demo', 'true')
        if (department) params.set('department', department)
        if (year) params.set('year', year)
        const url = `/api/explore/studios?${params.toString()}`
        const res = await fetch(url)
        if (!res.ok) throw new Error('Failed to load studios')
        const data = await res.json()
        // Studios are already filtered by the API
        const filtered = data.studios || []

        const studiosWithDefaults: GalleryStudio[] = filtered.map((s: any) => ({
          id: s.id || s.studioId || crypto.randomUUID(),
          studioId: s.studioId || s.id,
          name: s.name || s.label || 'Studio',
          department: s.department,
          year: s.year,
          boundingBox: s.boundingBox || DEFAULT_ROOM,
          wallConfig: s.wallConfig || buildWallConfig(s.boundingBox, true), // true = for gallery
        }))

        // Fetch boards + wallConfig for each studio
        const dataByStudio = await Promise.all(
          studiosWithDefaults.map(async (studio) => {
            if (!studio.studioId) return { id: studio.id, boards: [] as Board[], wallConfig: studio.wallConfig }

            const boardsUrl = isDemo ? `/api/boards?workspaceId=${studio.studioId}&demo=true` : `/api/boards?workspaceId=${studio.studioId}`
            const [boardsRes, configRes] = await Promise.all([
              fetch(boardsUrl),
              fetch(`/api/studios/${studio.studioId}/wall-config`)
            ])

            let boards: Board[] = []
            if (boardsRes.ok) {
              const payload = await boardsRes.json()
              boards = (payload.boards || []) as Board[]
            }

            let wallConfig = studio.wallConfig
            if (configRes.ok) {
              const cfgPayload = await configRes.json()
              if (cfgPayload?.config) {
                wallConfig = cfgPayload.config
              }
            }

            return { id: studio.id, boards, wallConfig }
          })
        )

        const studiosWithBoards = studiosWithDefaults.map((studio) => {
          const match = dataByStudio.find((b) => b.id === studio.id)
          return { ...studio, boards: match?.boards || [], wallConfig: match?.wallConfig || studio.wallConfig }
        })

        // Random scattered layout - studios placed randomly with good spacing
        const n = studiosWithBoards.length
        // Studios are now 60ft x 30ft rectangles
        const STUDIO_WIDTH_FEET = 60
        const STUDIO_DEPTH_FEET = 30
        const STUDIO_WIDTH_INCHES = STUDIO_WIDTH_FEET * 12 // 720 inches
        const STUDIO_DEPTH_INCHES = STUDIO_DEPTH_FEET * 12 // 360 inches
        const GAP_BETWEEN_RECTANGLES = 36 // 3 feet = 36 inches (equal spacing)
        // Grid spacing: rectangle dimension + 3ft gap (equal spacing in both directions)
        // X direction: 60ft + 3ft = 63ft = 756 inches
        // Z direction: 30ft + 3ft = 33ft = 396 inches
        const GRID_SPACING_X = STUDIO_WIDTH_INCHES + GAP_BETWEEN_RECTANGLES // 756 inches
        const GRID_SPACING_Z = STUDIO_DEPTH_INCHES + GAP_BETWEEN_RECTANGLES // 396 inches
        const SPREAD_RADIUS = Math.max(1000, Math.sqrt(n) * 200) // Spread studios in a larger area
        
        // Generate random positions with proper bounding box collision detection
        const placed: GalleryStudio[] = []
        const usedStudios: Array<{ x: number; z: number; width: number; depth: number }> = []
        
        // Helper function to check if two bounding boxes overlap or touch (with minimum spacing)
        // Returns true if boxes overlap or are too close
        const boxesOverlap = (
          x1: number, z1: number, w1: number, d1: number,
          x2: number, z2: number, w2: number, d2: number
        ): boolean => {
          // Convert feet to inches for comparison (positions x1, z1, x2, z2 are in inches)
          // w1, d1, w2, d2 are in feet from getFootprint
          const INCHES_PER_FOOT = 12
          const w1Inches = w1 * INCHES_PER_FOOT
          const d1Inches = d1 * INCHES_PER_FOOT
          const w2Inches = w2 * INCHES_PER_FOOT
          const d2Inches = d2 * INCHES_PER_FOOT
          
          // Calculate half-dimensions for each box (in inches)
          const halfW1 = w1Inches / 2
          const halfD1 = d1Inches / 2
          const halfW2 = w2Inches / 2
          const halfD2 = d2Inches / 2
          
          // Calculate the minimum distance needed between centers to avoid overlap
          // This ensures 3ft gap between edges: (half1 + half2 + 3ft gap)
          const minDistanceX = halfW1 + halfW2 + GAP_BETWEEN_RECTANGLES
          const minDistanceZ = halfD1 + halfD2 + GAP_BETWEEN_RECTANGLES
          
          // Check actual distance between centers (positions are in inches)
          const dx = Math.abs(x1 - x2)
          const dz = Math.abs(z1 - z2)
          
          // Boxes overlap if BOTH distances are less than minimum (meaning they're too close in both axes)
          // This ensures clear separation - if either axis has enough space, they don't overlap
          return dx < minDistanceX && dz < minDistanceZ
        }
        
        // Grid layout - place studios in a grid with proper spacing
        // Studios are now 60ft x 30ft rectangles
        const STUDIO_WIDTH = 60 // 60ft wide
        const STUDIO_DEPTH = 30 // 30ft deep
        
        // Calculate grid dimensions
        const cols = Math.ceil(Math.sqrt(n))
        const rows = Math.ceil(n / cols)
        
        // Grid spacing: rectangle dimension + 3ft gap (equal spacing in both directions)
        // X direction: 60ft + 3ft = 63ft = 756 inches
        // Z direction: 30ft + 3ft = 33ft = 396 inches
        const gridSpacingX = GRID_SPACING_X // 756 inches (60ft + 3ft gap)
        const gridSpacingZ = GRID_SPACING_Z // 396 inches (30ft + 3ft gap)
        
        // Calculate grid offset to center it around origin
        const gridWidth = (cols - 1) * gridSpacingX
        const gridDepth = (rows - 1) * gridSpacingZ
        const offsetX = -gridWidth / 2
        const offsetZ = -gridDepth / 2
        
        for (let i = 0; i < n; i++) {
          const studio = studiosWithBoards[i]
          
          // Build wall config for 60x30ft rectangle
          const wallConfig = studio.wallConfig || buildWallConfig({ width: STUDIO_WIDTH, depth: STUDIO_DEPTH }, true) // true = for gallery
          const finalWallConfig = { ...wallConfig, layoutType: 'zigzag' as const }
          
          // For gallery studios, use fixed 60x30ft rectangle bounds
          // Walls are calculated to fit inside this rectangle
          const actualWidth = STUDIO_WIDTH
          const actualDepth = STUDIO_DEPTH
          
          // Calculate grid position with equal 3ft spacing
          const col = i % cols
          const row = Math.floor(i / cols)
          const x = offsetX + col * gridSpacingX
          const z = offsetZ + row * gridSpacingZ
          
          // All studios have the same orientation (no rotation)
          const rotation = 0
          
          // Store this studio's position and size for collision detection (using actual bounds)
          usedStudios.push({ x, z, width: actualWidth, depth: actualDepth })
          
          placed.push({ 
            ...studio, 
            boundingBox: { width: actualWidth, depth: actualDepth }, 
            galleryPosition: { x, z }, 
            galleryRotation: rotation,
            wallConfig: finalWallConfig
          })
        }

        console.log(`✅ [Gallery] Loaded ${placed.length} studios with positions:`, placed.map(s => ({
          id: s.id,
          name: s.name,
          position: s.galleryPosition,
          boards: s.boards?.length || 0
        })))
        setStudios(placed)
        // Cache the studios data for instant loading next time
        // Include filters in cache key to prevent invalid cache usage
        const cacheKey = `galleryStudiosCache_${department || 'all'}_${year || 'all'}_${isDemo ? 'demo' : 'real'}`
        sessionStorage.setItem(cacheKey, JSON.stringify({
          studios: placed,
          timestamp: Date.now()
        }))
      } catch (err) {
        console.error(err)
        setStudios([])
      } finally {
        setLoading(false)
      }
    }

    fetchStudios()
  }, [department, year, isDemo])

  useEffect(() => {
    if (!Object.values(moveKeysRef.current).some(Boolean)) {
      setIsWalking(false)
    }
  }, [])

  const canvasCursor =
    pointerLocked
      ? 'none'
      : hoveredPin
      ? 'pointer'
      : nearEntrance
      ? 'zoom-in'
      : hoverFloor
      ? 'cell'
      : cursorMode === 'zoom-in'
      ? 'zoom-in'
      : 'crosshair'

  return (
    <div className="relative w-full h-full">
      <Canvas
        shadows
        camera={{ position: [0, 60, 96], fov: 55 }} // 60" high, 96" away (8 feet) - scaled for 1 unit = 1 inch
        style={{ cursor: canvasCursor }}
        onContextMenu={(e) => e.preventDefault()}
        onWheel={(e) => {
          e.preventDefault()
          const delta = e.deltaY
          const next = THREE.MathUtils.clamp(
            orbitRef.current.radius + (delta > 0 ? 6 : -6), // 6 inches per scroll step
            40, // Minimum zoom: 40 inches (~3.3ft)
            120 // Maximum zoom: 120 inches (10ft)
          )
          orbitRef.current.radius = next
        }}
        onPointerDown={(e) => {
          const canvasEl = e.target as HTMLElement
          if (canvasEl?.requestPointerLock) {
            canvasEl.requestPointerLock()
          }
          if (e.button === 2) {
            aimingRef.current = true
          }
        }}
        onPointerUp={(e) => {
          if (e.button === 2) {
            aimingRef.current = false
          }
        }}
        onPointerMove={(e) => {
          const dx = e.movementX || 0
          const dy = e.movementY || 0
          // Invert yaw so dragging left rotates left (natural orbit feel)
          orbitRef.current.yaw -= dx * 0.004
          // Increase pitch responsiveness for easier up/down look
          // Invert pitch so dragging up looks up, dragging down looks down
          orbitRef.current.pitch = THREE.MathUtils.clamp(orbitRef.current.pitch + dy * 0.006, PITCH_MIN, PITCH_MAX)
        }}
      >
        <color attach="background" args={['#f8fafc']} />
        <fog attach="fog" args={['#f8fafc', 480, 1680]} /> {/* Scaled: 40ft near, 140ft far */}
        <SceneContents
          studios={studios}
          avatarPos={avatarPos}
          highlightedBoardId={nearbyBoard?.board.id}
          onTeleport={teleportToStudio}
          nearbyStudioId={promptStudio?.studio.id}
          onNearbyBoardChange={setNearbyBoard}
          nearbyBoard={nearbyBoard}
        />
        {/* Ground interaction layer */}
        <Ground
          onHover={(h) => setHoverFloor(h)}
        />
      {/* Avatar visual */}
      <Avatar position={avatarPos} color={avatarColor} isWalking={isWalking} heading={avatarDir} />
      <CameraRig targetRef={avatarRef} orbitState={orbitRef} aimingRef={aimingRef} />
      <MovementController
        studios={studios}
        moveKeysRef={moveKeysRef}
        avatarRef={avatarRef}
        velocityYRef={velocityYRef}
        groundedRef={groundedRef}
        jumpRequestRef={jumpRequestRef}
        setAvatarPos={setAvatarPos}
        setAvatarDir={setAvatarDir}
        setIsWalking={setIsWalking}
        setNearEntrance={setNearEntrance}
        setPromptStudio={setPromptStudio}
        sprintRef={sprintRef}
      />
      </Canvas>
      <Minimap studios={studios} avatarPos={avatarPos} />
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/60 backdrop-blur-sm text-sm text-text-secondary">
          Loading studios...
        </div>
      )}
      {!loading && studios.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/70 backdrop-blur-sm text-sm text-text-secondary">
          No studios found for this selection.
        </div>
      )}
    </div>
  )
}

function MovementController({
  studios,
  moveKeysRef,
  sprintRef,
  velocityYRef,
  groundedRef,
  jumpRequestRef,
  avatarRef,
  setAvatarPos,
  setAvatarDir,
  setIsWalking,
  setNearEntrance,
  setPromptStudio,
}: {
  studios: GalleryStudio[]
  moveKeysRef: React.MutableRefObject<MoveKeys>
  sprintRef: React.MutableRefObject<boolean>
  velocityYRef: React.MutableRefObject<number>
  groundedRef: React.MutableRefObject<boolean>
  jumpRequestRef: React.MutableRefObject<boolean>
  avatarRef: React.MutableRefObject<Vec3>
  setAvatarPos: (v: Vec3) => void
  setAvatarDir: (v: number | ((prev: number) => number)) => void
  setIsWalking: (v: boolean) => void
  setNearEntrance: (v: boolean) => void
  setPromptStudio: (v: { studio: GalleryStudio; entrance: THREE.Vector3 } | null) => void
}) {
  const safeSetPromptStudio = setPromptStudio ?? (() => {})

  useFrame((state, delta) => {
    const moveVec = new THREE.Vector3(0, 0, 0)

    // Keyboard vector (Fortnite-style WASD)
    const mk = moveKeysRef.current
    if (mk.forward || mk.back || mk.left || mk.right) {
      const camDir = new THREE.Vector3()
      state.camera.getWorldDirection(camDir)
      camDir.y = 0
      camDir.normalize()
      const right = new THREE.Vector3().crossVectors(camDir, new THREE.Vector3(0, 1, 0)).normalize()
      if (mk.forward) moveVec.add(camDir)
      if (mk.back) moveVec.add(camDir.clone().multiplyScalar(-1))
      if (mk.right) moveVec.add(right)
      if (mk.left) moveVec.add(right.clone().multiplyScalar(-1))
    }

    const hasInput = moveVec.lengthSq() > 0
    const speed = sprintRef.current ? MOVE_SPEED * SPRINT_MULTIPLIER : MOVE_SPEED
    if (hasInput) {
      moveVec.normalize().multiplyScalar(speed * delta)
      const angle = Math.atan2(moveVec.x, moveVec.z)
      setAvatarDir((prev) => lerpAngle(prev, angle, 0.2))
      setIsWalking(true)
    } else {
      moveVec.set(0, 0, 0)
      setIsWalking(false)
    }

    // Jump impulse
    if (jumpRequestRef.current && groundedRef.current) {
      velocityYRef.current = JUMP_VELOCITY
      groundedRef.current = false
    }
    jumpRequestRef.current = false

    // Gravity
    velocityYRef.current -= GRAVITY * delta

    // Apply movement and vertical velocity
    const next = new THREE.Vector3(
      avatarRef.current.x + moveVec.x,
      avatarRef.current.y + velocityYRef.current * delta,
      avatarRef.current.z + moveVec.z
    )

    if (next.y <= 0) {
      next.y = 0
      velocityYRef.current = 0
      groundedRef.current = true
    } else {
      groundedRef.current = false
    }

    const updated = { x: next.x, y: next.y, z: next.z }
    avatarRef.current = updated
    setAvatarPos(updated)

    // Entrance proximity (front edge center of closest studio)
    type ClosestStudio = { studio: GalleryStudio; entrance: THREE.Vector3; dist: number }
    let closest: ClosestStudio | null = null
    let entranceNear = false
    
    for (const studio of studios) {
      const entrance = getEntrancePosition(studio)
      const dist = entrance.distanceTo(new THREE.Vector3(updated.x, 0, updated.z))
      if (closest === null || dist < closest.dist) {
        closest = { studio, entrance, dist }
      }
      if (dist < ENTRANCE_DISTANCE) {
        entranceNear = true
      }
    }
    
    setNearEntrance(entranceNear)
    if (closest !== null && closest.dist < ENTRANCE_DISTANCE) {
      safeSetPromptStudio({ studio: closest.studio, entrance: closest.entrance })
    } else {
      safeSetPromptStudio(null)
    }
  })

  return null
}

function Minimap({ studios, avatarPos }: { studios: GalleryStudio[]; avatarPos: Vec3 }) {
  const [mounted, setMounted] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  
  useEffect(() => {
    // Use requestAnimationFrame to ensure DOM is ready
    const timer = requestAnimationFrame(() => {
      if (containerRef.current) {
        setMounted(true)
      }
    })
    return () => cancelAnimationFrame(timer)
  }, [])
  
  // Calculate bounds of all studios to determine view size
  const bounds = useMemo(() => {
    if (studios.length === 0) {
      return { minX: -100, maxX: 100, minZ: -100, maxZ: 100, centerX: 0, centerZ: 0, width: 200, depth: 200 }
    }
    
    let minX = Infinity, maxX = -Infinity
    let minZ = Infinity, maxZ = -Infinity
    
    studios.forEach(studio => {
      const pos = studio.galleryPosition || { x: 0, z: 0 }
      const { width, depth } = getFootprint(studio)
      const halfW = width / 2
      const halfD = depth / 2
      
      minX = Math.min(minX, pos.x - halfW)
      maxX = Math.max(maxX, pos.x + halfW)
      minZ = Math.min(minZ, pos.z - halfD)
      maxZ = Math.max(maxZ, pos.z + halfD)
    })
    
    // Include avatar position in bounds
    minX = Math.min(minX, avatarPos.x - 10)
    maxX = Math.max(maxX, avatarPos.x + 10)
    minZ = Math.min(minZ, avatarPos.z - 10)
    maxZ = Math.max(maxZ, avatarPos.z + 10)
    
    // Add padding
    const padding = 100
    minX -= padding
    maxX += padding
    minZ -= padding
    maxZ += padding
    
    const centerX = (minX + maxX) / 2
    const centerZ = (minZ + maxZ) / 2
    const width = maxX - minX
    const depth = maxZ - minZ
    const viewSize = Math.max(width, depth, 200) // Minimum 200 units
    
    return { minX, maxX, minZ, maxZ, centerX, centerZ, width, depth, viewSize }
  }, [studios, avatarPos])
  
  // Calculate zoom to fit all studios in the minimap
  // For orthographic cameras: zoom controls visible area
  // We want to show bounds.viewSize units, so set camera bounds and adjust zoom
  const padding = 1.2 // 20% padding around bounds
  const visibleSize = (bounds?.viewSize ?? 200) * padding
  
  if (!mounted) {
    return (
      <div 
        ref={containerRef}
        className="absolute top-4 right-4 w-40 h-40 rounded-lg border border-primary/20 bg-white/80 shadow-lg backdrop-blur-sm" 
      />
    )
  }
  
  return (
    <div 
      ref={containerRef}
      className="absolute top-4 right-4 w-40 h-40 rounded-lg border border-primary/20 bg-white/80 shadow-lg backdrop-blur-sm overflow-hidden"
    >
      {mounted && (
        <Canvas 
          orthographic 
          camera={{ 
            zoom: 1,
            position: [bounds.centerX, 40, bounds.centerZ],
            left: -visibleSize / 2,
            right: visibleSize / 2,
            top: visibleSize / 2,
            bottom: -visibleSize / 2,
            near: 0.1,
            far: 100
          }}
          gl={{ antialias: false, alpha: false }}
          dpr={1}
          onCreated={(state) => {
            // Ensure the canvas is properly initialized
            if (!state.gl || !state.gl.domElement) {
              console.warn('Minimap Canvas failed to initialize')
            }
          }}
        >
        <MinimapCamera bounds={bounds} visibleSize={visibleSize} />
        <ambientLight intensity={0.6} />
        <color attach="background" args={['#f8fafc']} />
        {/* Floor guide - covers the entire bounds */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[bounds.centerX, 0, bounds.centerZ]} receiveShadow>
          <planeGeometry args={[bounds.viewSize, bounds.viewSize]} />
          <meshBasicMaterial color="#eef2ff" />
        </mesh>

        {/* Studios - each as a distinct square/rectangle with border matching 3D view */}
        {studios.map((studio) => {
          const pos = studio.galleryPosition || { x: 0, z: 0 }
          const { width, depth } = getFootprint(studio)
          // Convert feet to inches to match 3D view (scene uses 1 unit = 1 inch)
          const INCHES_PER_FOOT = 12
          const displayWidth = width * INCHES_PER_FOOT
          const displayDepth = depth * INCHES_PER_FOOT
          
          return (
            <group key={studio.id}>
              {/* Studio borders removed from minimap - no blue squares visible */}
            </group>
          )
        })}

        {/* Avatar - make it more visible */}
        <mesh position={[avatarPos.x, 0.4, avatarPos.z]}>
          <circleGeometry args={[2, 24]} />
          <meshBasicMaterial color="#ef4444" />
        </mesh>
        {/* Avatar border */}
        <lineSegments position={[avatarPos.x, 0.45, avatarPos.z]}>
          <ringGeometry args={[1.8, 2.2, 32]} />
          <lineBasicMaterial attach="material" color="#dc2626" linewidth={2} />
        </lineSegments>
        </Canvas>
      )}
    </div>
  )
}

function MinimapCamera({ bounds, visibleSize }: { bounds: { centerX: number; centerZ: number }, visibleSize: number }) {
  useFrame((state) => {
    if (!state.camera || !state.gl || !state.gl.domElement) return
    try {
      const cam = state.camera as THREE.OrthographicCamera
      if (!cam) return
      // Center camera on the center of all studios to show everything
      cam.position.set(bounds.centerX, 40, bounds.centerZ)
      cam.up.set(0, 0, -1)
      cam.lookAt(bounds.centerX, 0, bounds.centerZ)
      // Set orthographic bounds to show the calculated visible area
      cam.left = -visibleSize / 2
      cam.right = visibleSize / 2
      cam.top = visibleSize / 2
      cam.bottom = -visibleSize / 2
      cam.updateProjectionMatrix()
    } catch (error) {
      // Silently handle any camera update errors
      console.warn('MinimapCamera update error:', error)
    }
  })
  return null
}

function Particles() {
  const positions = useMemo(() => {
    const arr = []
    for (let i = 0; i < 200; i++) {
      arr.push((Math.random() - 0.5) * 80)
      arr.push(Math.random() * 8 + 4)
      arr.push((Math.random() - 0.5) * 80)
    }
    return new Float32Array(arr)
  }, [])

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={positions.length / 3} array={positions} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial size={0.12} color="#cbd5e1" transparent opacity={0.45} />
    </points>
  )
}