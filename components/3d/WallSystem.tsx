'use client'

import * as THREE from 'three'
import { Board } from '@/types'
import BoardThumbnail from './BoardThumbnail'

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
  onWallClick: (wallIndex: number, wallDimensions: WallDimensions, position: THREE.Vector3, rotation: number, isBackFace?: boolean) => void
  editingWall: number | null
  onBoardClick?: (board: Board) => void
  highlightedBoardId?: string | null // ID of the board currently in camera view (for blue tint)
}


export default function WallSystem({ boards, wallConfig, onWallClick, editingWall, onBoardClick, highlightedBoardId }: WallSystemProps) {
  // Scene scale: 1 unit = 1 inch
  // So an 8ft × 10ft wall = 96 × 120 units
  const SCALE = 12 // Convert feet to inches (1 ft = 12 inches)
  
  // 🎯 Helper function to determine which Z direction is "outward" for a wall
  // Returns 1 for +Z direction, -1 for -Z direction
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
  
  const getWallTransform = (index: number) => {
    const wall = wallConfig.walls[index]
    const width = wall.width * SCALE
    const height = wall.height * SCALE
    
    let x = 0
    let z = 0
    let rotationY = 0
    
    const { layoutType } = wallConfig
    
    switch (layoutType) {
      case 'zigzag': {
        // Zigzag pattern: walls connected at 90-degree angles with overlapping corners
        const WALL_DEPTH = 4  // Wall thickness: 4 inches (typical interior wall)
        const OVERLAP = WALL_DEPTH / 2  // Overlap at corners for flush appearance
        
        let currentX = 0
        let currentZ = 0
        
        // Track the path by following each wall's end point
        for (let i = 0; i < index; i++) {
          const prevWidth = wallConfig.walls[i].width * SCALE
          
          if (i % 2 === 0) {
            // Horizontal wall - extends along +X axis
            currentX += prevWidth - (i > 0 ? OVERLAP : 0)  // Subtract overlap except for first wall
          } else {
            // Vertical wall - extends along +Z axis
            currentZ += prevWidth - OVERLAP  // Always overlap with previous
          }
        }
        
        // Position this wall's center
        if (index % 2 === 0) {
          // This is a horizontal wall
          x = currentX + width / 2 - (index > 0 ? OVERLAP / 2 : 0)
          z = currentZ
          rotationY = 0
        } else {
          // This is a vertical wall (90° turn)
          x = currentX
          z = currentZ + width / 2 - OVERLAP / 2
          rotationY = Math.PI / 2
        }
        
        // Center the entire zigzag around the origin
        let totalXExtent = 0
        let totalZExtent = 0
        let tempX = 0
        let tempZ = 0
        
        for (let i = 0; i < wallConfig.walls.length; i++) {
          const w = wallConfig.walls[i].width * SCALE
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
      
      case 'linear': {
        // Linear: parallel walls in a row
        const spacing = width + 2
        
        x = index * spacing - (wallConfig.walls.length * spacing) / 2
        z = 0
        rotationY = 0
        break
      }
      
      case 'square': {
        // Square: four walls forming a closed room
        const wallWidths = wallConfig.walls.map(w => w.width * SCALE)
        
        if (index === 0) {
          // Front wall
          x = 0
          z = wallWidths[0] / 2
          rotationY = 0
        } else if (index === 1) {
          // Right wall
          x = wallWidths[0] / 2
          z = 0
          rotationY = Math.PI / 2
        } else if (index === 2) {
          // Back wall
          x = 0
          z = -wallWidths[2] / 2
          rotationY = Math.PI
        } else if (index === 3) {
          // Left wall
          x = -wallWidths[0] / 2
          z = 0
          rotationY = -Math.PI / 2
        }
        break
      }
      
      case 'lshape': {
        // L-shape: two perpendicular walls
        const wallWidths = wallConfig.walls.map(w => w.width * SCALE)
        
        if (index === 0) {
          // Horizontal part of L
          x = 0
          z = 0
          rotationY = 0
        } else if (index === 1) {
          // Vertical part of L (right side)
          x = wallWidths[0] / 2
          z = -wallWidths[1] / 2
          rotationY = Math.PI / 2
        } else if (index >= 2) {
          // Additional walls extend the L
          const prevWall = wallWidths[1]
          x = wallWidths[0] / 2
          z = -prevWall - (index - 1) * wallWidths[index]
          rotationY = Math.PI / 2
        }
        break
      }
      
      default: {
        // Fallback to circular arrangement
        const angle = (index * Math.PI) / 2
        const radius = 5 + (index - 4) * 2
        x = Math.cos(angle) * radius
        z = Math.sin(angle) * radius
        rotationY = angle + Math.PI / 2
      }
    }
    
    return { x, z, rotationY, width, height }
  }

  return (
    <group>
      {/* Floor removed - using gallery's unified floor instead */}

      {wallConfig.walls.map((wall, wallIndex) => {
        const transform = getWallTransform(wallIndex)
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
            {/* Both faces clickable - detect which side was clicked */}
            <mesh
  onClick={(e) => {
    e.stopPropagation()
    
    // 🎯 ALWAYS edit front side for simplicity and consistency
    // This prevents confusion with zigzag layouts where walls face different directions
    const isBackFace = false
    
    const position = new THREE.Vector3(transform.x, transform.height / 2, transform.z)
    const rotation = transform.rotationY
    
    console.log('🖼️ [WallSystem] Wall clicked:', {
      wallIndex,
      side: 'front',
      rotation,
      position: { x: position.x, y: position.y, z: position.z }
    })
    
    onWallClick?.(wallIndex, wall, position, rotation, isBackFace)
  }}
  castShadow
  receiveShadow
  renderOrder={0}
>
              <boxGeometry args={[transform.width, transform.height, 4]} />
              <meshStandardMaterial 
                color="#f8f8f5" 
                roughness={0.9} 
                metalness={0.0}
                depthWrite={true}
                depthTest={true}
              />
            </mesh>

            {boardsOnWall.map((board) => {
              if (!board.position) return null

              // Determine which side this board is on (default to 'front' for backwards compatibility)
              const boardSide = board.position.side || 'front'
              
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
              
              // Calculate board X position (saved positions are in wall's local coordinate system)
              // Position is stored as normalized coordinates (-0.5 to 0.5), convert to inches
              const boardX = board.position.x * transform.width
              
              // Y-axis: Still needs inversion because CSS top goes down, Three.js Y goes up
              // Saved y=-0.5 means top in 2D → should be +height/2 in 3D
              // Saved y=+0.5 means bottom in 2D → should be -height/2 in 3D
              const boardY = board.position.y * transform.height

              // 🎯 Position board flush with wall surface
              // Wall depth is 4 inches, so wall surface is at WALL_DEPTH/2 = 2 inches from center
              // Board should be positioned at the wall surface, not sticking out
              const WALL_DEPTH = 4 // Wall thickness: 4 inches
              const WALL_SURFACE_OFFSET = WALL_DEPTH / 2 // 2 inches from wall center to surface
              const BOARD_OFFSET = 0.2 // Offset to prevent z-fighting and ensure boards are always visible (0.2 inches = 5mm)
              
              // Determine which direction is "outward" for this wall (1 for +Z, -1 for -Z)
              const outwardDirection = getOutwardZDirection(transform.rotationY)
              
              // Position board at wall surface:
              // - Front side: same direction as outward (outwardDirection * WALL_SURFACE_OFFSET)
              // - Back side: opposite direction (-outwardDirection * WALL_SURFACE_OFFSET)
              // Ensure boards are ALWAYS outside the wall geometry (z > 2 or z < -2)
              const baseZ = (boardSide === 'back' ? -outwardDirection : outwardDirection) * WALL_SURFACE_OFFSET
              const boardZ = baseZ + (boardSide === 'back' ? -BOARD_OFFSET : BOARD_OFFSET)
              
              // Safety check: ensure board is never inside the wall (between -2 and +2)
              // Wall geometry extends from -2 to +2 inches (WALL_DEPTH = 4, so ±2 from center)
              const WALL_INNER_BOUND = WALL_SURFACE_OFFSET // 2 inches
              const WALL_OUTER_BOUND = WALL_SURFACE_OFFSET + BOARD_OFFSET // 2.2 inches
              
              // Clamp board Z to ensure it's always outside the wall
              let finalBoardZ = boardZ
              if (boardSide === 'back') {
                // Back boards must be at z <= -WALL_OUTER_BOUND (at least -2.2)
                finalBoardZ = Math.min(boardZ, -WALL_OUTER_BOUND)
                if (finalBoardZ !== boardZ) {
                  console.warn(`⚠️ Board ${board.id} on back side clamped from z=${boardZ.toFixed(2)} to ${finalBoardZ.toFixed(2)}`)
                }
              } else {
                // Front boards must be at z >= WALL_OUTER_BOUND (at least 2.2)
                finalBoardZ = Math.max(boardZ, WALL_OUTER_BOUND)
                if (finalBoardZ !== boardZ) {
                  console.warn(`⚠️ Board ${board.id} on front side clamped from z=${boardZ.toFixed(2)} to ${finalBoardZ.toFixed(2)}`)
                }
              }
              
              console.log(`🧱 Board on wall ${wallIndex}: rotation=${transform.rotationY.toFixed(2)}, outwardDirection=${outwardDirection}, side=${boardSide}, finalZ=${finalBoardZ.toFixed(2)}`)
              
              console.log(`   💾 LOADED: x=${board.position.x.toFixed(3)}, y=${board.position.y.toFixed(3)}, side=${boardSide}`)
              console.log(`   🎯 3D Position: x=${boardX.toFixed(2)}, y=${boardY.toFixed(2)}, z=${finalBoardZ.toFixed(2)} (side: ${boardSide})`)
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
                />
              )
            })}
          </group>
        )
      })}
    </group>
  )
}