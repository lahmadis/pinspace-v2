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
  onWallClick: (wallIndex: number, wallDimensions: WallDimensions, position: THREE.Vector3, rotation: number) => void
  editingWall: number | null
  onBoardClick?: (board: Board) => void
}


export default function WallSystem({ boards, wallConfig, onWallClick, editingWall, onBoardClick }: WallSystemProps) {
  const SCALE = 0.5
  
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
        const WALL_DEPTH = 0.1  // Wall thickness
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
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[50, 50]} />
        <meshStandardMaterial color="#cccccc" />
      </mesh>

      {wallConfig.walls.map((wall, wallIndex) => {
        const transform = getWallTransform(wallIndex)
        const boardsOnWall = boards.filter(
          b => b.position?.wallIndex === wallIndex && editingWall !== wallIndex
        )
        
        
        // Log 3D wall aspect ratio
        const wall3DAspectRatio = transform.width / transform.height
        const originalAspectRatio = wall.width / wall.height
        console.log('═══════════════════════════════════════')
        console.log(`🧊 3D WALL ${wallIndex + 1} ASPECT RATIO`)
        console.log('═══════════════════════════════════════')
        console.log(`Original dimensions: ${wall.width}ft × ${wall.height}ft`)
        console.log(`3D dimensions: ${transform.width.toFixed(2)} × ${transform.height.toFixed(2)} units (SCALE=${SCALE})`)
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
            <mesh
  onClick={(e) => {
    e.stopPropagation()
    const position = new THREE.Vector3(transform.x, transform.height / 2, transform.z)
    onWallClick?.(wallIndex, wall, position, transform.rotationY)
  }}
  castShadow
  receiveShadow
>
              <boxGeometry args={[transform.width, transform.height, 0.1]} />
              <meshStandardMaterial color="#e8e4dc" />
            </mesh>

            {boardsOnWall.map((board) => {
              if (!board.position) return null

              // Skip boards without saved dimensions (old data)
              if (!board.position.width || !board.position.height) {
                console.warn(`⚠️ Board ${board.id} missing dimensions - skipping. Re-place in 2D editor to fix.`)
                return null
              }

              console.log('=== 3D RENDERING ===')
              console.log(`📍 Board: ${board.title}`)
              console.log(`   Wall size (3D units): ${transform.width.toFixed(2)} x ${transform.height.toFixed(2)}`)
              console.log(`   💾 LOADED: x=${board.position.x.toFixed(3)}, y=${board.position.y.toFixed(3)}, w=${board.position.width.toFixed(3)}, h=${board.position.height.toFixed(3)}`)
              
              // NEW UNIFIED SYSTEM:
              // Saved positions are wall-centered: -0.5 to +0.5, where 0 = center
              // Just multiply by wall dimensions to get 3D coordinates!
              const boardX = board.position.x * transform.width
              
              // Y-axis: Still needs inversion because CSS top goes down, Three.js Y goes up
              // Saved y=-0.5 means top in 2D → should be +height/2 in 3D
              // Saved y=+0.5 means bottom in 2D → should be -height/2 in 3D
              // Formula: negate the y coordinate
              const boardY = board.position.y * transform.height

              // Calculate actual board dimensions
              const boardWidth = board.position.width * transform.width
              const boardHeight = board.position.height * transform.height

              console.log(`   🎯 3D Position: x=${boardX.toFixed(2)}, y=${boardY.toFixed(2)}`)
              console.log(`   📏 3D Size: ${boardWidth.toFixed(2)} x ${boardHeight.toFixed(2)}`)
              console.log(`   📊 Percentage: ${(board.position.width * 100).toFixed(1)}% x ${(board.position.height * 100).toFixed(1)}%`)
              console.log('====================')

              return (
                <BoardThumbnail
                  key={board.id}
                  board={board}
                  position={[boardX, boardY, 0.06]}
                  width={boardWidth}
                  height={boardHeight}
                  onClick={onBoardClick}
                />
              )
            })}
          </group>
        )
      })}
    </group>
  )
}