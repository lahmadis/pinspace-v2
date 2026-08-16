'use client'

import { Fragment } from 'react'
import * as THREE from 'three'
import { Text } from '@react-three/drei'
import { Board } from '@/types'
import WallSurface from './WallSurface'
import BoardThumbnail from './BoardThumbnail'
import { getWallTransformResolved, calculateFloorBounds, type WallTextItem } from '@/lib/wallLayout'
import { getBoardSizeInches } from '@/lib/boardDimensions'
import { cleanDisplayName } from '@/lib/displayName'

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
  /**
   * Board ids belonging to the student selected in the roster. Their bay gets a
   * yellow outline — an EDGE, drawn proud of the wall. Yellow never fills a wall
   * or sits behind a sheet; it only ever marks active state.
   */
  highlightedBoardIds?: ReadonlySet<string>
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
  grey: { main: '#FFFCF0', sideEdge: '#EFE9D8', topEdge: '#E7E0CC', bottomEdge: '#DED6C0' },
  white: { main: '#FFFFFF', sideEdge: '#FAFAF9', topEdge: '#F7F7F5', bottomEdge: '#F3F3F0' },
}

/**
 * Room scheme. A saturated field behind a board fights the white sheet and black
 * linework of an architecture drawing, so `yellow` here is used for exactly one
 * thing: the selected student's bay OUTLINE, drawn as lineSegments proud of the
 * wall. It is never a surface colour — not a wall, not the floor, and never the
 * field behind a sheet.
 */
const ROOM_PALETTE = {
  floor: '#D8D3C6',
  green: '#14705C',
  yellow: '#FFC800',
} as const

/**
 * Owner name plate sizing, in inches (1 world unit = 1 inch). 4" cap height
 * subtends roughly 2.4 degrees at the ~96" default camera distance, which reads
 * clearly from the far side of the room without crowding a 24" sheet.
 */
const NAME_PLATE_SIZE_IN = 4
/** Gap between the board's top edge and the baseline of its name plate. */
const NAME_PLATE_GAP_IN = 1.75
/** Vertical step when a plate has to move up to clear one already placed. */
const NAME_PLATE_ROW_STEP_IN = NAME_PLATE_SIZE_IN * 1.35
/**
 * Troika renders no true 600 weight for the default face, so the plates are
 * thickened with a same-colour outline instead. Purely optical — it does not
 * change the glyph metrics used for collision spans below.
 */
const NAME_PLATE_OUTLINE_IN = NAME_PLATE_SIZE_IN * 0.045
/** Mean glyph advance as a fraction of font size, for estimating plate width. */
const NAME_PLATE_ADVANCE_RATIO = 0.55
/** Breathing room between a selected bay's boards and its outline, in inches. */
const BAY_FRAME_PADDING_IN = 3

interface PlateLayoutInput {
  key: string
  centerX: number
  baseY: number
  label: string
}

/**
 * Assign each name plate a row offset so overlapping plates stack upward rather
 * than printing on top of each other.
 *
 * Two plates only conflict when their horizontal spans overlap AND they sit at
 * a similar height, so boards at genuinely different heights keep their natural
 * position. Processed left to right, which makes the result stable: the same
 * board set always produces the same rows, so nothing jitters between frames.
 */
export function assignNamePlateRows(plates: PlateLayoutInput[]): Map<string, number> {
  const rows = new Map<string, number>()
  const placed: Array<{ minX: number; maxX: number; y: number }> = []
  const ordered = [...plates].sort((a, b) => a.centerX - b.centerX || a.key.localeCompare(b.key))

  for (const plate of ordered) {
    const halfWidth = Math.max(
      (plate.label.length * NAME_PLATE_SIZE_IN * NAME_PLATE_ADVANCE_RATIO) / 2,
      NAME_PLATE_SIZE_IN,
    )
    const minX = plate.centerX - halfWidth
    const maxX = plate.centerX + halfWidth

    let row = 0
    // Bounded so a pathological pile-up cannot spin; 12 rows is far past any
    // realistic wall and still lands well inside the wall height.
    while (row < 12) {
      const y = plate.baseY + row * NAME_PLATE_ROW_STEP_IN
      const clashes = placed.some(
        (other) =>
          minX < other.maxX &&
          other.minX < maxX &&
          Math.abs(y - other.y) < NAME_PLATE_ROW_STEP_IN * 0.9,
      )
      if (!clashes) break
      row += 1
    }

    placed.push({ minX, maxX, y: plate.baseY + row * NAME_PLATE_ROW_STEP_IN })
    rows.set(plate.key, row)
  }

  return rows
}


export default function WallSystem({ boards, wallConfig, onWallDoubleClick, onWallHover, editingWall, editUIActive = false, othersEditingWalls, onBoardClick, highlightedBoardId, onBoardHover, wallColor = 'grey', suppressCallouts = false, highlightedBoardIds }: WallSystemProps) {

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
          color={ROOM_PALETTE.floor} // warm neutral floor; never tinted toward the accent
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

        // Resolve every plate for this wall up front so overlapping labels can be
        // stacked against each other. Done per wall (not per board) because the
        // row assignment needs the whole set to decide.
        const plateKeyFor = (board: Board) => board.localId || board.id
        const plateLabels = new Map<string, string>()
        const plateInputs: PlateLayoutInput[] = []
        for (const board of boardsOnWall) {
          if (!board.position) continue
          const label = cleanDisplayName(board.ownerName) || cleanDisplayName(board.studentName)
          if (!label) continue
          const { widthIn, heightIn } = getBoardSizeInches(board)
          if (!widthIn || !heightIn || widthIn <= 0 || heightIn <= 0) continue
          const key = plateKeyFor(board)
          plateLabels.set(key, label)
          plateInputs.push({
            key,
            centerX: ((board.position.x / 100) - 0.5) * transform.width,
            baseY: ((board.position.y / 100) - 0.5) * transform.height + heightIn / 2 + NAME_PLATE_GAP_IN,
            label,
          })
        }
        const plateRows = assignNamePlateRows(plateInputs)

        // Selected student's bay: the bounding box of their boards on THIS wall
        // side, drawn as a yellow outline set proud of the surface. Computed per
        // side so a student with work on both faces gets a frame on each.
        const bayFrames: Array<{
          key: string; cx: number; cy: number; w: number; h: number; side: 'front' | 'back'
        }> = []
        if (highlightedBoardIds && highlightedBoardIds.size > 0) {
          for (const side of ['front', 'back'] as const) {
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
            let found = false
            for (const board of boardsOnWall) {
              if (!board.position || !highlightedBoardIds.has(board.id)) continue
              if ((board.position.side || 'front') !== side) continue
              const { widthIn, heightIn } = getBoardSizeInches(board)
              if (!widthIn || !heightIn || widthIn <= 0 || heightIn <= 0) continue
              const cx = ((board.position.x / 100) - 0.5) * transform.width
              const cy = ((board.position.y / 100) - 0.5) * transform.height
              minX = Math.min(minX, cx - widthIn / 2)
              maxX = Math.max(maxX, cx + widthIn / 2)
              minY = Math.min(minY, cy - heightIn / 2)
              maxY = Math.max(maxY, cy + heightIn / 2)
              found = true
            }
            if (!found) continue
            const pad = BAY_FRAME_PADDING_IN
            bayFrames.push({
              key: `${wallIndex}-${side}`,
              cx: (minX + maxX) / 2,
              cy: (minY + maxY) / 2,
              w: (maxX - minX) + pad * 2,
              h: (maxY - minY) + pad * 2,
              side,
            })
          }
        }

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

              // Owner name plate. The API resolves `ownerName` live from
              // user_profiles; `studentName` backs it up for legacy rows. Both
              // are placeholder-filtered, so an unknown owner renders no plate
              // rather than the word "Anonymous".
              const plateKey = plateKeyFor(board)
              const ownerLabel = plateLabels.get(plateKey) ?? ''
              // Same z convention as the wall labels below — wall half-depth
              // plus 0.25 — so the plate clears both the wall surface and the
              // board at ±3.2 without z-fighting either.
              const PLATE_SURFACE_OFFSET = 3
              const plateZ = boardSide === 'back'
                ? -(PLATE_SURFACE_OFFSET + 0.25)
                : PLATE_SURFACE_OFFSET + 0.25
              const plateY =
                boardY
                + boardHeight / 2
                + NAME_PLATE_GAP_IN
                + (plateRows.get(plateKey) ?? 0) * NAME_PLATE_ROW_STEP_IN

              return (
                // Key by localId (stable across temp→real id swap) when
                // present so the post-edit render path doesn't remount the
                // thumbnail purely because a temp board's id changed. Falls
                // back to board.id for server-loaded boards. A Fragment adds
                // no Object3D, so the scene graph is unchanged.
                <Fragment key={board.localId || board.id}>
                  <BoardThumbnail
                    board={board}
                    position={[boardX, boardY, finalBoardZ]}
                    width={boardWidth}
                    height={boardHeight}
                    onClick={onBoardClick}
                    isHighlighted={highlightedBoardId === board.id}
                    onHover={(hovered) => onBoardHover?.(hovered ? board.id : null)}
                    suppressCountBadge={suppressCallouts}
                  />
                  {ownerLabel && (
                    <Text
                      position={[boardX, plateY, plateZ]}
                      // Back-side plates face into the back room so they read
                      // correctly, matching the wall labels.
                      rotation={boardSide === 'back' ? [0, Math.PI, 0] : [0, 0, 0]}
                      fontSize={NAME_PLATE_SIZE_IN}
                      color={ROOM_PALETTE.green}
                      // Stands in for a 600 weight the default face does not
                      // carry; see NAME_PLATE_OUTLINE_IN.
                      outlineWidth={NAME_PLATE_OUTLINE_IN}
                      outlineColor={ROOM_PALETTE.green}
                      anchorX="center"
                      // Bottom anchor grows the plate upward from the gap above
                      // the board, so a long name never creeps down over the sheet.
                      anchorY="bottom"
                      maxWidth={Math.max(boardWidth, NAME_PLATE_SIZE_IN * 8)}
                    >
                      {ownerLabel}
                    </Text>
                  )}
                </Fragment>
              )
            })}

            {/* Selected student's bay outline. lineSegments, not a filled plane,
                so nothing yellow ever sits behind a sheet. */}
            {bayFrames.map((frame) => (
              <lineSegments
                key={frame.key}
                position={[
                  frame.cx,
                  frame.cy,
                  frame.side === 'back' ? -(3 + 0.3) : 3 + 0.3,
                ]}
                rotation={frame.side === 'back' ? [0, Math.PI, 0] : [0, 0, 0]}
              >
                <edgesGeometry args={[new THREE.PlaneGeometry(frame.w, frame.h)]} />
                <lineBasicMaterial color={ROOM_PALETTE.yellow} />
              </lineSegments>
            ))}

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
                    color={ROOM_PALETTE.green}
                    letterSpacing={0.08}
                    anchorX="center"
                    anchorY="middle"
                    maxWidth={transform.width}
                  >
                    {(t.text || ' ').toUpperCase()}
                  </Text>
                )
              })}
          </group>
        )
      })}
    </group>
  )
}