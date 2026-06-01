'use client'

import * as THREE from 'three'
import { Board } from '@/types'
import WallSurface from './WallSurface'
import BoardThumbnail from './BoardThumbnail'
import { getWallTransformResolved, calculateFloorBounds } from '@/lib/wallLayout'
import { getBoardSizeInches } from '@/lib/boardDimensions'

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
  /**
   * Fires when the pointer enters a wall surface. StudioRoom uses this to
   * fire-and-forget pre-warm board full-image textures for the boards on
   * that wall, so the subsequent wall-click into edit mode doesn't show the
   * grey skeleton placeholder while 2400px JPEGs load.
   */
  onWallHover?: (wallIndex: number, side: 'front' | 'back') => void
  editingWall: number | null
  /**
   * True only once the camera-into-wall transition has completed and DraggableBoards
   * have taken over rendering. While false (during the camera animation) we keep the
   * BoardThumbnails on the wall mounted so there's no empty-wall flicker.
   */
  editUIActive?: boolean
  /**
   * Wall indices currently being edited by OTHER users (from presence). Each such
   * wall gets a faint emissive glow so collaborators can see where others are
   * working. Excludes the local user's own wall.
   */
  othersEditingWalls?: Set<number>
  onBoardClick?: (board: Board) => void
  highlightedBoardId?: string | null
  onBoardHover?: (boardId: string | null) => void
  onFloorClick?: () => void
}


export default function WallSystem({ boards, wallConfig, onWallClick, onWallHover, editingWall, editUIActive = false, othersEditingWalls, onBoardClick, highlightedBoardId, onBoardHover }: WallSystemProps) {

  const getTransform = (index: number) => getWallTransformResolved(wallConfig, index)
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
        // Faint glow when another user is editing this wall (presence).
        const isOthersEditing = othersEditingWalls?.has(wallIndex) ?? false
        // Hide thumbnails on the editing wall ONLY once the edit UI has fully taken over
        // (i.e. DraggableBoards are mounted). During the camera transition we keep the
        // thumbnails mounted so there's no empty-wall flicker.
        const boardsOnWall = boards.filter(b => {
          if (!b.position || b.position.wallIndex !== wallIndex) return false
          if (editUIActive && editingWall === wallIndex) return false
          return true
        })
        
        return (
          <group 
            key={wallIndex}
            position={[transform.x, transform.height / 2, transform.z]}
            rotation={[0, transform.rotationY, 0]}
          >
            {/* Clickable front and back – same wall-local coords so no inversion */}
            <WallSurface
              wallDimensions={wall}
              side="front"
              onSurfaceClick={({ side }) => {
                const position = new THREE.Vector3(transform.x, transform.height / 2, transform.z)
                const rotation = transform.rotationY
                onWallClick?.(wallIndex, wall, position, rotation, side)
              }}
              onSurfaceHover={({ side }) => onWallHover?.(wallIndex, side)}
            />
            <WallSurface
              wallDimensions={wall}
              side="back"
              onSurfaceClick={({ side }) => {
                const position = new THREE.Vector3(transform.x, transform.height / 2, transform.z)
                const rotation = transform.rotationY
                onWallClick?.(wallIndex, wall, position, rotation + Math.PI, side)
              }}
              onSurfaceHover={({ side }) => onWallHover?.(wallIndex, side)}
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
                // Presence highlight: soft brand-violet glow on walls another
                // user is editing. Black/0 = no glow (default). Tunable.
                emissive={isOthersEditing ? '#6366f1' : '#000000'}
                emissiveIntensity={isOthersEditing ? 0.45 : 0}
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

              // Board SIZE is absolute inches, independent of wall geometry —
              // resizing a wall must not stretch the boards. Only POSITION
              // (below) is wall-relative.
              const { widthIn: boardWidth, heightIn: boardHeight } = getBoardSizeInches(board)

              // Ensure we have valid dimensions
              if (boardWidth === undefined || boardHeight === undefined || boardWidth <= 0 || boardHeight <= 0) {
                if (process.env.NODE_ENV === 'development') {
                  console.warn(`⚠️ Board ${board.id} has invalid dimensions - skipping. Re-place in 2D editor to fix.`)
                }
                return null
              }
              
              // Calculate board X position
              // Positions come from API in percentage format (0-100), need to convert to normalized (-0.5 to 0.5)
              const normalizedX = (board.position.x / 100) - 0.5
              const normalizedY = (board.position.y / 100) - 0.5
              // Use one wall-local convention for every wall orientation.
              const boardX = normalizedX * transform.width
              
              // Y-axis: positions are from API format (0-100) where 0 = top, 100 = bottom
              // After normalization: -0.5 = top, +0.5 = bottom
              // In 3D: +height/2 = top, -height/2 = bottom (Y axis goes up)
              const boardY = normalizedY * transform.height

              // Match WallSurface: in wall group local space, front = +3.01, back = -3.01. Place boards at ±3.2.
              const WALL_SURFACE_OFFSET = 3 // 6" wall depth / 2
              const BOARD_OFFSET = 0.2
              const boardSide = board.position?.side || 'front'
              const finalBoardZ = boardSide === 'back' ? -(WALL_SURFACE_OFFSET + BOARD_OFFSET) : WALL_SURFACE_OFFSET + BOARD_OFFSET

              return (
                <BoardThumbnail
                  // Key by localId (stable across temp→real id swap) when
                  // present so the post-edit render path doesn't remount the
                  // thumbnail purely because a temp board's id changed. Falls
                  // back to board.id for server-loaded boards.
                  key={board.localId || board.id}
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