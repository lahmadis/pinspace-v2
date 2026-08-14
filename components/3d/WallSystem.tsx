'use client'

import * as THREE from 'three'
import { Text } from '@react-three/drei'
import { Board } from '@/types'
import WallSurface from './WallSurface'
import BoardThumbnail from './BoardThumbnail'
import { getWallTransformResolved, calculateFloorBounds, type WallTextItem } from '@/lib/wallLayout'
import { getBoardSizeInches } from '@/lib/boardDimensions'

interface WallDimensions {
  height: number
  width: number
}

type LayoutType = 'zigzag' | 'square' | 'linear' | 'lshape'

interface WallConfig {
  walls: WallDimensions[]
  layoutType: LayoutType
  /** Free-floating wall text labels, read from the wall-config blob. */
  textItems?: WallTextItem[]
}

interface WallSystemProps {
  boards: Board[]
  wallConfig: WallConfig
  /**
   * Fires on DOUBLE click of a wall surface (single click is inert, leaving it
   * free for orbit/drag). StudioRoom uses this to enter 2D edit mode.
   */
  onWallDoubleClick: (wallIndex: number, wallDimensions: WallDimensions, position: THREE.Vector3, rotation: number, side: 'front' | 'back') => void
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
  /**
   * Room-level wall color. 'grey' (default) is the exact current look; 'white'
   * is true paper white (#FFFFFF) so a white-background sheet reads as the same
   * white as the wall (see WALL_PALETTES). Only the wall surface + its edge
   * accents change — the floor and background are untouched.
   */
  wallColor?: 'grey' | 'white'
  /**
   * Hide the boards' callout-count badges while a 2D panel is open over this
   * room — currently the lightbox and the floor-plan editor.
   *
   * Both are z-50 fixed overlays; the badges are <Html> DOM overlays at z-index
   * 60 that live OUTSIDE the canvas, and the room stays mounted behind the panel.
   * 60 > 50, so every badge in the room paints on top of it. Named for the effect
   * rather than for any one panel: the next z-50 overlay over the room will need
   * exactly this and shouldn't have to pretend a lightbox is open to get it.
   *
   * Nothing else about the boards changes.
   */
  suppressCallouts?: boolean
}

// Wall surface + edge-shadow palette per color. The 'grey' values are
// byte-identical to the pre-feature hardcoded colors, so grey rooms render
// exactly as before.
//
// 'white' is TRUE PAPER WHITE: the main surface is #FFFFFF so it renders at the
// same value as a #FFFFFF board texel on the same wall (both are metalness-0
// meshStandardMaterial, coplanar and same-facing → equal albedo → equal shaded
// value, including identical highlight roll-off). This makes a white-background
// sheet visually continuous with the wall so only the ink stands out. The edge
// accents are pulled to near-white (barely below #FFFFFF) so they hold the wall
// corners without reintroducing a grey frame around each panel.
const WALL_PALETTES: Record<'grey' | 'white', {
  main: string
  sideEdge: string
  topEdge: string
  bottomEdge: string
}> = {
  grey: { main: '#D8DEFF', sideEdge: '#B3C4FF', topEdge: '#A1B2FF', bottomEdge: '#E0E0DB' },
  white: { main: '#FFFFFF', sideEdge: '#FAFAF9', topEdge: '#F7F7F5', bottomEdge: '#F3F3F0' },
}


export default function WallSystem({ boards, wallConfig, onWallDoubleClick, onWallHover, editingWall, editUIActive = false, othersEditingWalls, onBoardClick, highlightedBoardId, onBoardHover, wallColor = 'grey', suppressCallouts = false }: WallSystemProps) {

  const wallPalette = WALL_PALETTES[wallColor] ?? WALL_PALETTES.grey
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
              onSurfaceDoubleClick={({ side }) => {
                const position = new THREE.Vector3(transform.x, transform.height / 2, transform.z)
                const rotation = transform.rotationY
                onWallDoubleClick?.(wallIndex, wall, position, rotation, side)
              }}
              onSurfaceHover={({ side }) => onWallHover?.(wallIndex, side)}
            />
            <WallSurface
              wallDimensions={wall}
              side="back"
              onSurfaceDoubleClick={({ side }) => {
                const position = new THREE.Vector3(transform.x, transform.height / 2, transform.z)
                const rotation = transform.rotationY
                onWallDoubleClick?.(wallIndex, wall, position, rotation + Math.PI, side)
              }}
              onSurfaceHover={({ side }) => onWallHover?.(wallIndex, side)}
            />

            {/* Modern off-white wall with depth and shadows */}
            {/* Main wall surface - off-white with subtle depth */}
            {/* Increased thickness for more visible depth */}
            <mesh castShadow receiveShadow renderOrder={0}>
              <boxGeometry args={[transform.width, transform.height, 6]} />
              <meshStandardMaterial
                color={wallPalette.main} // room wall color (grey default / paper white)
                // White mode matches the board material's roughness (0.7) so a
                // white sheet and the wall share the same sheen — no "glossier
                // sheet" cue. Grey is unchanged at 0.85.
                roughness={wallColor === 'white' ? 0.7 : 0.85}
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
                color={wallPalette.sideEdge} // side edge shadow (per wall color)
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
                color={wallPalette.sideEdge} // side edge shadow (per wall color)
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
                color={wallPalette.topEdge} // top edge shadow (per wall color)
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
                color={wallPalette.bottomEdge} // bottom edge shadow (per wall color)
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
                  suppressCountBadge={suppressCallouts}
                />
              )
            })}

            {/* Free-floating wall text labels (blob-persisted). Positioned by
                the SAME normalized→world convention as boards. Hidden on the
                wall currently being edited (DraggableText takes over there),
                matching how BoardThumbnails are hidden above. */}
            {(wallConfig.textItems ?? [])
              .filter((t) => {
                if (t.wallIndex !== wallIndex) return false
                if (editUIActive && editingWall === wallIndex) return false
                return true
              })
              .map((t) => {
                const textX = t.x * transform.width
                const textY = t.y * transform.height
                const isBack = t.side === 'back'
                // Match the board Z offsets (wall half-depth = 3), a hair
                // further out so labels never z-fight with a board on the same
                // wall.
                const TEXT_SURFACE_OFFSET = 3
                const textZ = isBack ? -(TEXT_SURFACE_OFFSET + 0.25) : TEXT_SURFACE_OFFSET + 0.25
                return (
                  <Text
                    key={t.id}
                    position={[textX, textY, textZ]}
                    // Back labels face into the back room so they read correctly.
                    rotation={isBack ? [0, Math.PI, 0] : [0, 0, 0]}
                    fontSize={t.fontSize}
                    color="#111827"
                    anchorX="center"
                    anchorY="middle"
                    maxWidth={transform.width}
                  >
                    {t.text || ' '}
                  </Text>
                )
              })}
          </group>
        )
      })}
    </group>
  )
}