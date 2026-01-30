'use client'

import * as THREE from 'three'
import { Board } from '@/types'
import WallSurface from './WallSurface'
import BoardThumbnail from './BoardThumbnail'
import { getWallTransform, calculateFloorBounds } from '@/lib/wallLayout'

interface WallDimensions {
  height: number
  width: number
}

type LayoutType = 'zigzag' | 'square' | 'linear' | 'lshape'

interface WallConfig {
  walls: WallDimensions[]
  layoutType: LayoutType
}

interface WallSystemProps {
  boards: Board[]
  wallConfig: WallConfig
  onWallClick: (wallIndex: number, wallDimensions: WallDimensions, position: THREE.Vector3, rotation: number, side: 'front' | 'back') => void
  editingWall: number | null
  onBoardClick?: (board: Board) => void
  highlightedBoardId?: string | null
  onBoardHover?: (boardId: string | null) => void
  onFloorClick?: () => void
}


export default function WallSystem({ boards, wallConfig, onWallClick, editingWall, onBoardClick, highlightedBoardId, onBoardHover, onFloorClick }: WallSystemProps) {
  const SCALE = 12

  const getOutwardZDirection = (rotation: number): number => {
    // Normalize rotation to 0-2π range
    const normalizedRotation = ((rotation % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
    
    // For zigzag walls:
    // - Horizontal walls (rotation ≈ 0 or π): front is +Z
    // - Vertical walls (rotation ≈ π/2 or 3π/2): front is -Z (because of rotation)
    
    // Check if rotation is closer to π/2 (90°) or 3π/2 (270°)
    const isVerticalWall = (
      (normalizedRotation > Math.PI/4 && normalizedRotation < 3*Math.PI/4) ||
      (normalizedRotation > 5*Math.PI/4 && normalizedRotation < 7*Math.PI/4)
    )
    
    // Return direction: -1 for vertical walls (front faces -Z), +1 for horizontal walls (front faces +Z)
    return isVerticalWall ? -1 : 1
  }
  
  const getTransform = (index: number) => getWallTransform(wallConfig, index)
  const floorBounds = calculateFloorBounds(wallConfig)
  const wallDepth = 6 // Wall thickness in inches (same as walls)
  const floorThickness = wallDepth // Floor thickness matches wall thickness

  return (
    <group>
      {/* Dynamic floor with thickness matching walls */}
      <mesh 
        position={[floorBounds.floorCenterX, -floorThickness / 2, floorBounds.floorCenterZ]} 
        receiveShadow
        castShadow
      >
        <boxGeometry args={[floorBounds.floorWidth, floorThickness, floorBounds.floorDepth]} />
        <meshStandardMaterial 
          color="#D8DEFF" // very light, white-leaning blue for floor
          roughness={0.9}
          metalness={0.0}
        />
      </mesh>

      {wallConfig.walls.map((wall, wallIndex) => {
        const transform = getTransform(wallIndex)
        // Only show boards that are NOT being edited (or on different side)
        const boardsOnWall = boards.filter(b => {
          if (!b.position || b.position.wallIndex !== wallIndex) return false
          // If this wall is being edited, only show boards on the opposite side
          if (editingWall === wallIndex) {
            // This will be handled by DraggableBoard in edit mode
            return false
          }
          return true
        })
        
        
        // Log 3D wall aspect ratio
        const wall3DAspectRatio = transform.width / transform.height
        const originalAspectRatio = wall.width / wall.height
        console.log('═══════════════════════════════════════')
        console.log(`🧊 3D WALL ${wallIndex + 1} ASPECT RATIO`)
        console.log('═══════════════════════════════════════')
        console.log(`Original dimensions: ${wall.width}ft × ${wall.height}ft`)
        console.log(`3D dimensions: ${transform.width.toFixed(2)} × ${transform.height.toFixed(2)} units (${transform.width.toFixed(2)}" × ${transform.height.toFixed(2)}", 1 unit = 1 inch)`)
        console.log(`Original aspect ratio: ${originalAspectRatio.toFixed(4)} (${wall.width}/${wall.height})`)
        console.log(`3D aspect ratio: ${wall3DAspectRatio.toFixed(4)} (${transform.width.toFixed(2)}/${transform.height.toFixed(2)})`)
        console.log(`✓ Aspect ratios ${Math.abs(wall3DAspectRatio - originalAspectRatio) < 0.01 ? 'MATCH' : 'MISMATCH!'} (should match 2D)`)
        console.log('═══════════════════════════════════════')

        return (
          <group 
            key={wallIndex}
            position={[transform.x, transform.height / 2, transform.z]}
            rotation={[0, transform.rotationY, 0]}
          >
            {/* Clickable front/back surfaces */}
            <WallSurface
              wallDimensions={wall}
              side="front"
              onSurfaceClick={({ side }) => {
                const position = new THREE.Vector3(transform.x, transform.height / 2, transform.z)
                const rotation = transform.rotationY
                const adjustedRotation = rotation
                onWallClick?.(wallIndex, wall, position, adjustedRotation, side)
              }}
            />
            <WallSurface
              wallDimensions={wall}
              side="back"
              onSurfaceClick={({ side }) => {
                const position = new THREE.Vector3(transform.x, transform.height / 2, transform.z)
                const rotation = transform.rotationY
                const adjustedRotation = rotation + Math.PI
                onWallClick?.(wallIndex, wall, position, adjustedRotation, side)
              }}
            />

            {/* Modern off-white wall with depth and shadows */}
            {/* Main wall surface - off-white with subtle depth */}
            {/* Increased thickness for more visible depth */}
            <mesh castShadow receiveShadow renderOrder={0}>
              <boxGeometry args={[transform.width, transform.height, 6]} />
              <meshStandardMaterial 
                color="#D8DEFF" // very light, white-leaning blue for walls
                roughness={0.85} // Slight sheen for subtle depth
                metalness={0.0}
                depthWrite={true}
                depthTest={true}
              />
            </mesh>

            {/* Subtle edge shadows for depth - creates modern panel effect */}
            {/* Left edge shadow */}
            <mesh 
              position={[-transform.width / 2 + 0.1, 0, 2.1]} 
              castShadow 
              receiveShadow
            >
              <boxGeometry args={[0.2, transform.height, 0.2]} />
              <meshStandardMaterial 
                color="#B3C4FF" // slightly darker blue for side edge shadows
                roughness={0.9}
                metalness={0.0}
              />
            </mesh>

            {/* Right edge shadow */}
            <mesh 
              position={[transform.width / 2 - 0.1, 0, 2.1]} 
              castShadow 
              receiveShadow
            >
              <boxGeometry args={[0.2, transform.height, 0.2]} />
              <meshStandardMaterial 
                color="#B3C4FF" // slightly darker blue for side edge shadows
                roughness={0.9}
                metalness={0.0}
              />
            </mesh>

            {/* Top edge shadow */}
            <mesh 
              position={[0, transform.height / 2 - 0.1, 2.1]} 
              castShadow 
              receiveShadow
            >
              <boxGeometry args={[transform.width, 0.2, 0.2]} />
              <meshStandardMaterial 
                color="#A1B2FF" // darker blue for top edge shadow
                roughness={0.9}
                metalness={0.0}
              />
            </mesh>

            {/* Bottom edge shadow */}
            <mesh 
              position={[0, -transform.height / 2 + 0.1, 2.1]} 
              castShadow 
              receiveShadow
            >
              <boxGeometry args={[transform.width, 0.2, 0.2]} />
              <meshStandardMaterial 
                color="#E0E0DB" // Darker for bottom shadow
                roughness={0.9}
                metalness={0.0}
              />
            </mesh>

            {boardsOnWall.map((board) => {
              if (!board.position) return null

              // Get wall dimensions in feet (from wallConfig)
              const wallDimensions = wallConfig.walls[wallIndex]
              
              // Calculate board dimensions using physical dimensions directly in inches
              // With 1 unit = 1 inch, physical dimensions map directly to 3D units
              let boardWidth: number | undefined
              let boardHeight: number | undefined
              
              // First, try to use physical dimensions if available (they represent the actual board size)
              if (board.physicalWidth && board.physicalHeight) {
                boardWidth = board.physicalWidth  // Direct: inches → units
                boardHeight = board.physicalHeight // Direct: inches → units
                
                // Clamp to ensure board doesn't exceed wall size
                const wallWidthInches = wallDimensions.width * 12
                const wallHeightInches = wallDimensions.height * 12
                boardWidth = Math.min(boardWidth, wallWidthInches)
                boardHeight = Math.min(boardHeight, wallHeightInches)
                
                console.log(`📐 [WallSystem] Using physical dimensions: ${board.physicalWidth}" x ${board.physicalHeight}" = ${boardWidth.toFixed(2)} x ${boardHeight.toFixed(2)} units`)
              }
              
              // Fallback for existing boards without physical dimensions: default to 8.5×11 inches (standard letter size)
              if (boardWidth === undefined || boardHeight === undefined) {
                const DEFAULT_WIDTH_INCHES = 8.5
                const DEFAULT_HEIGHT_INCHES = 11
                
                // Try to use saved percentage dimensions if available
                if (board.position.width && board.position.height) {
                  const wallWidthInches = wallDimensions.width * 12
                  const wallHeightInches = wallDimensions.height * 12
                  boardWidth = board.position.width * wallWidthInches
                  boardHeight = board.position.height * wallHeightInches
                  console.log(`📐 [WallSystem] Using saved percentage dimensions: ${(board.position.width * 100).toFixed(1)}% x ${(board.position.height * 100).toFixed(1)}% = ${boardWidth.toFixed(2)} x ${boardHeight.toFixed(2)} units`)
                } else {
                  // Final fallback: use default 8.5×11 inches
                  boardWidth = DEFAULT_WIDTH_INCHES
                  boardHeight = DEFAULT_HEIGHT_INCHES
                  console.log(`📐 [WallSystem] No dimensions found - using default: ${DEFAULT_WIDTH_INCHES}" x ${DEFAULT_HEIGHT_INCHES}" = ${boardWidth} x ${boardHeight} units`)
                }
              }
              
              // Ensure we have valid dimensions
              if (boardWidth === undefined || boardHeight === undefined || boardWidth <= 0 || boardHeight <= 0) {
                console.warn(`⚠️ Board ${board.id} has invalid dimensions - skipping. Re-place in 2D editor to fix.`)
                return null
              }
              
              console.log('=== 3D RENDERING ===')
              console.log(`📍 Board: ${board.title}`)
              console.log(`   Wall size (feet): ${wallDimensions.width}ft x ${wallDimensions.height}ft (${wallDimensions.width * 12}" x ${wallDimensions.height * 12}")`)
              console.log(`   Wall size (3D units): ${transform.width.toFixed(2)} x ${transform.height.toFixed(2)} units (1 unit = 1 inch)`)
              
              // Calculate board X position
              // Positions come from API in percentage format (0-100), need to convert to normalized (-0.5 to 0.5)
              const normalizedX = (board.position.x / 100) - 0.5
              const normalizedY = (board.position.y / 100) - 0.5
              const boardX = normalizedX * transform.width
              
              // Y-axis: positions are from API format (0-100) where 0 = top, 100 = bottom
              // After normalization: -0.5 = top, +0.5 = bottom
              // In 3D: +height/2 = top, -height/2 = bottom (Y axis goes up)
              const boardY = normalizedY * transform.height

              // 🎯 Position board flush with wall surface
              // Wall depth is 6 inches, so wall surface is at WALL_DEPTH/2 = 3 inches from center
              // Board should be positioned at the wall surface, not sticking out
              const WALL_DEPTH = 6 // Wall thickness: 6 inches (increased for more visible depth)
              const WALL_SURFACE_OFFSET = WALL_DEPTH / 2 // 3 inches from wall center to surface
              const BOARD_OFFSET = 0.2 // Offset to prevent z-fighting and ensure boards are always visible (0.2 inches = 5mm)
              
              // Determine which direction is "outward" for this wall (1 for +Z, -1 for -Z)
              const outwardDirection = getOutwardZDirection(transform.rotationY)
              
              // Get board's side (front or back) - this determines which face of the wall it's on
              const boardSide = board.position?.side || 'front' // Default to front if not specified
              
              // Position board at wall surface based on which side it's on:
              // - Front side: same direction as outward (outwardDirection * WALL_SURFACE_OFFSET)
              // - Back side: opposite direction (-outwardDirection * WALL_SURFACE_OFFSET)
              // Ensure boards are ALWAYS outside the wall geometry (z > 3 or z < -3)
              const baseZ = outwardDirection * WALL_SURFACE_OFFSET
              let boardZ: number
              if (boardSide === 'back') {
                boardZ = -baseZ - BOARD_OFFSET // Opposite direction for back face
              } else {
                boardZ = baseZ + BOARD_OFFSET // Same direction for front face
              }
              
              // Safety check: ensure board is never inside the wall (between -3 and +3)
              // Wall geometry extends from -3 to +3 inches (WALL_DEPTH = 6, so ±3 from center)
              const WALL_INNER_BOUND = WALL_SURFACE_OFFSET // 3 inches
              const WALL_OUTER_BOUND = WALL_SURFACE_OFFSET + BOARD_OFFSET // 3.2 inches
              
              // Clamp board Z to ensure it's always outside the wall
              let finalBoardZ: number
              if (boardSide === 'back') {
                finalBoardZ = Math.min(boardZ, -WALL_OUTER_BOUND) // Clamp to outer bound on negative side
              } else {
                finalBoardZ = Math.max(boardZ, WALL_OUTER_BOUND) // Clamp to outer bound on positive side
              }
              
              console.log(`🧱 Board on wall ${wallIndex}: rotation=${transform.rotationY.toFixed(2)}, outwardDirection=${outwardDirection}, side=${boardSide}, finalZ=${finalBoardZ.toFixed(2)}`)
              
              console.log(`   📍 LOADED: x=${board.position.x.toFixed(3)}, y=${board.position.y.toFixed(3)}, side=${boardSide}`)
              console.log(`   🎯 3D Position: x=${boardX.toFixed(2)}, y=${boardY.toFixed(2)}, z=${finalBoardZ.toFixed(2)}`)
              console.log(`   📏 3D Size: ${boardWidth.toFixed(2)} x ${boardHeight.toFixed(2)} units (${boardWidth.toFixed(2)}" x ${boardHeight.toFixed(2)}")`)
              if (board.physicalWidth && board.physicalHeight) {
                console.log(`   ✅ Physical dimensions: ${board.physicalWidth}" x ${board.physicalHeight}"`)
              } else {
                console.log(`   ⚠️ Using fallback/default dimensions`)
              }
              console.log('====================')

              return (
                <BoardThumbnail
                  key={board.id}
                  board={board}
                  position={[boardX, boardY, finalBoardZ]}
                  width={boardWidth}
                  height={boardHeight}
                  onClick={onBoardClick}
                  isHighlighted={highlightedBoardId === board.id}
                  onHover={(hovered) => onBoardHover?.(hovered ? board.id : null)}
                />
              )
            })}
          </group>
        )
      })}
    </group>
  )
}