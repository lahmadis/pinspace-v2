'use client'

import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { Text, Grid } from '@react-three/drei'
import { Board } from '@/types'
import WallSurface from './WallSurface'
import BoardThumbnail from './BoardThumbnail'
import { getWallTransformResolved, calculateFloorBounds, type WallTextItem } from '@/lib/wallLayout'
import { ROOM_SKY, ROOM_FONT_3D } from '@/lib/room/palette'
import { studentKeyFor } from '@/lib/room/students'
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
   * Fires on DOUBLE click of a wall surface. A single click is swallowed by the
   * surface without doing anything — see WallSurface's handleClick for why it
   * has to be swallowed rather than simply unhandled.
   */
  onWallDoubleClick: (wallIndex: number, wallDimensions: WallDimensions, position: THREE.Vector3, rotation: number, side: 'front' | 'back') => void
  /**
   * Fires when the pointer enters a wall surface. StudioRoom uses this to
   * fire-and-forget pre-warm board full-image textures for the boards on
   * that wall, so the subsequent double-click into edit mode doesn't show the
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
   * blue-accent outline — an EDGE, drawn proud of the wall. The accent never
   * fills a wall or sits behind a sheet; it only ever marks active state.
   */
  highlightedBoardIds?: ReadonlySet<string>
  /**
   * Wall focus: index of the ONE wall to keep at full strength, ghosting every
   * other wall (and the boards, plates and labels on it) back toward the sky
   * colour. `null`/undefined — the default — means no dimming at all, which is
   * why the guest and share surfaces keep rendering unchanged without opting in.
   *
   * Deliberately a wall index rather than a wall+side: a wall ghosts as a whole
   * object, so focusing the back face of wall 2 still leaves wall 2's front at
   * full strength rather than half-ghosting a single slab.
   */
  dimmedExceptWall?: number | null
  /**
   * Fires on a click of the room floor. Used to dismiss wall focus — clicking
   * off the walls is the natural "never mind" gesture, and it's the only exit
   * that doesn't require finding a button or knowing the Escape shortcut.
   */
  onFloorClick?: () => void
  /**
   * Fires when an owner name plate above a bay is clicked, with the key that
   * person's `RoomStudent.id` uses (see studentKeyFor). Opens their 2D archive.
   * Omit to leave the plates inert, which is what the guest surfaces want.
   */
  onNamePlateClick?: (studentId: string) => void
}

// Wall surface + edge-shadow palette per color.
//
// The FIRST attempt at this recolor (cream/tan -> cool paper/blue) picked
// values that were all within a few percent of each other in lightness — main
// ~98%, edges ~94-96%, the floor ~92%, the sky ~93%. Every surface in the
// room read as the same pale wash with no wall-to-wall seam and no
// wall/floor/sky separation, which is its own "cheap" failure mode even
// though every individual color was "correct" blue/paper. `main` here is
// pulled down a few points from previous (still clearly the brightest, whitest
// surface in the room — architecture sheets should pop against it) and the
// edge tones are real shadow values, not a near-white tint, so the strip
// between two wall panels reads as a recessed seam instead of disappearing.
//
// 'white' is closer to TRUE PAPER WHITE than 'grey': the main surface is
// #FFFFFF so it renders at the same value as a #FFFFFF board texel on the
// same wall (both are metalness-0 meshStandardMaterial, coplanar and
// same-facing → equal albedo → equal shaded value, including identical
// highlight roll-off), making a white-background sheet visually continuous
// with the wall so only the ink stands out. Its edge tones are deepened less
// than grey's, on purpose — over-darkening them would put a visible frame
// around a wall that's supposed to read as one continuous white surface.
const WALL_PALETTES: Record<'grey' | 'white', {
  main: string
  sideEdge: string
  topEdge: string
  bottomEdge: string
}> = {
  grey: { main: '#F1F4F9', sideEdge: '#C7D0E0', topEdge: '#B9C4D6', bottomEdge: '#A8B5CA' },
  white: { main: '#FFFFFF', sideEdge: '#E2E4E4', topEdge: '#D7DAD9', bottomEdge: '#C9CDCB' },
}

/**
 * Room scheme. A saturated field behind a board fights the white sheet and black
 * linework of an architecture drawing, so `accent` here is used for exactly one
 * thing: the selected student's bay OUTLINE, drawn as lineSegments proud of the
 * wall. It is never a surface colour — not a wall, not the floor, and never the
 * field behind a sheet. Matches ROOM.accent in lib/room/palette.ts — "the one
 * accent color" is the same blue everywhere in the app now, not a 3D-room-only
 * yellow.
 *
 * `ink` replaces what used to be a green "identity" color for owner name
 * plates and wall text — plain ink instead, same reasoning as
 * lib/room/palette.ts: a second accent color competing with the blue one reads
 * as inconsistent, not as a deliberate second signal.
 *
 * `floor` is deliberately a full step darker than the walls (see the
 * WALL_PALETTES comment above on why the first recolor pass under-separated
 * these) — a gallery floor reading darker than its walls is what gives the
 * room a sense of standing IN a volume rather than everything being one flat
 * value.
 */
const ROOM_PALETTE = {
  floor: '#B7C2D6',
  ink: '#16181D',
  accent: '#3B6EF6',
} as const

/**
 * The room used to sit on a floor sized to exactly fit the walls, in an
 * otherwise-empty scene with a flat solid background — orbiting past the
 * floor's edge showed nothing, so the room read as a platform floating in a
 * void. `ROOM_SKY_COLOR` is that void's replacement: it's used as BOTH the
 * Canvas background (StudioRoom.tsx) and the scene fog color below, so a
 * much larger ground plane can fade seamlessly into it — the fog color and
 * the sky color must match exactly, or the ground's own edge (where fog
 * reaches 100%) becomes a visible ring instead of an invisible horizon. Sits
 * between the wall's ~F1F4F9 and the floor's ~B7C2D6 in lightness, so both
 * still read as distinct from the sky rather than blending into it.
 */
export const ROOM_SKY_COLOR = ROOM_SKY

/**
 * Pixels of pointer travel above which a floor click is treated as the end of an
 * orbit drag rather than a click. Mirrors DRAG_THRESHOLD_PX in WallSurface.tsx.
 *
 * Used by the clickable owner name plates. NOT by the floor click any more —
 * that only fires while a wall is focused, and focus switches orbit off, so
 * there is no drag for it to be the tail of; guarding it could only reject a
 * real click on the main way out of a locked camera.
 */
const FLOOR_DRAG_THRESHOLD_PX = 4

/**
 * Wall focus de-emphasis. How far an unfocused surface is pulled toward the sky
 * colour — 0 leaves it alone, 1 makes it vanish into the background. High enough
 * that the focused wall clearly wins, short of 1 so the room still reads as a
 * room and you can see where the other walls are to click back onto them.
 */
const WALL_DIM_AMOUNT = 0.74
/** Slightly less for boards: artwork ghosts, but stays identifiable enough to click. */
const BOARD_DIM_AMOUNT = 0.62

/**
 * Blend a colour toward the sky. Used for wall focus, which ghosts surfaces by
 * desaturating them into the background rather than by making them transparent.
 *
 * Transparency would be the obvious approach and is the wrong one here: a single
 * wall is five-plus coplanar meshes with board quads standing 0.2" proud of it,
 * and three.js sorts transparent objects by distance-to-camera, so those
 * near-coplanar surfaces flicker and re-order as you orbit. Blending toward the
 * sky keeps every material opaque — no sort order to get wrong — and matches how
 * CAD tools ghost the parts of a model you aren't working on.
 */
function dimTowardSky(hex: string, amount: number): string {
  return `#${new THREE.Color(hex).lerp(new THREE.Color(ROOM_SKY_COLOR), amount).getHexString()}`
}

// A touch lighter/more muted than the floor plinth — reads as the same
// ground continuing outward, just further away, rather than a visibly
// different material.
const GROUND_COLOR = '#C3CDDE'
/** Horizon reference grid on the ground plane, outside the room's own
 *  footprint (the room's opaque floor/walls occlude it directly underneath).
 *  Minor lines every foot, a heavier line every 10 feet — the same
 *  cell/section convention any CAD or level-editor grid uses. */
// Lines have to carry against GROUND_COLOR (#C3CDDE) without turning the ground
// into a drawing of its own. The foot lines do the visible work; the ten-foot
// lines are a light structural beat, and are told apart by WEIGHT rather than
// darkness (sectionThickness is nearly twice cellThickness below). An earlier
// pass made the ten-foot lines much darker and they read as the loudest thing
// in an otherwise pale room.
const GRID_CELL_COLOR = '#9BAAC6'
const GRID_SECTION_COLOR = '#8CA0C2'

/**
 * The three stacked horizontal planes, top to bottom: the room's floor plate,
 * the reference grid, then the ground that runs out to the horizon.
 *
 * Walls stand on y = 0, so the floor is there too. The gaps below it exist
 * purely for the depth buffer, and they only work because StudioRoom's camera
 * sets `near = 5` rather than three.js's default 0.1 — resolvable depth goes as
 * z²/(near · 2²⁴), so that one change buys ~50x precision and makes a few
 * inches of separation safe even at a large room's maximum zoom-out. With the
 * old 0.1 near plane, even six inches would have flickered out there.
 *
 * If anyone lowers that near plane, these gaps stop being sufficient — the
 * symptom is the grid flickering in and out as the camera orbits.
 *
 * The read-only surfaces (view / crit / share) allow twice the editor's zoom-out
 * distance, so their margin at the far end is four times worse; there the scene
 * fog reaches full strength before the grid gets close to the quantum, which is
 * what covers the tail.
 */
const FLOOR_Y = 0
const GRID_Y = -4
const GROUND_Y = -8

/**
 * Ground plane + fog scale with the room's own footprint rather than a fixed
 * constant, so a large custom-configured room (many walls, wide layout)
 * still comfortably clears whatever distance the orbit camera can reach (see
 * the maxDistance calculation in StudioRoom.tsx) before fog fully takes
 * over. groundSize stays several multiples past fogFar so its own edge is
 * never the thing that becomes visible.
 *
 * Exported (rather than computed inline in WallSystem) because `<fog>` has
 * to be attached at the Canvas/scene level to do anything — nested inside
 * WallSystem's <group>, R3F's attach="fog" would set it on that group
 * instead of the scene, and Three.js only ever reads scene.fog. StudioRoom
 * renders the actual <fog> element; this just gives it the same numbers
 * WallSystem's ground plane below uses, from the same wallConfig.
 */
export function getRoomFogParams(wallConfig: WallConfig): { fogNear: number; fogFar: number } {
  const bounds = calculateFloorBounds(wallConfig)
  const span = Math.max(bounds.floorWidth, bounds.floorDepth, 96)
  return {
    fogNear: Math.max(800, span * 2),
    fogFar: Math.max(3000, span * 6),
  }
}

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


export default function WallSystem({ boards, wallConfig, onWallDoubleClick, onWallHover, editingWall, editUIActive = false, othersEditingWalls, onBoardClick, highlightedBoardId, onBoardHover, wallColor = 'grey', suppressCallouts = false, highlightedBoardIds, dimmedExceptWall = null, onFloorClick, onNamePlateClick }: WallSystemProps) {

  const wallPalette = WALL_PALETTES[wallColor] ?? WALL_PALETTES.grey
  // Ghosted variants for wall focus. Memoized on the palette rather than
  // recomputed inside the wall loop: this is four THREE.Color blends that are
  // identical for every dimmed wall in the room.
  const dimmedWallPalette = useMemo(() => ({
    main: dimTowardSky(wallPalette.main, WALL_DIM_AMOUNT),
    sideEdge: dimTowardSky(wallPalette.sideEdge, WALL_DIM_AMOUNT),
    topEdge: dimTowardSky(wallPalette.topEdge, WALL_DIM_AMOUNT),
    bottomEdge: dimTowardSky(wallPalette.bottomEdge, WALL_DIM_AMOUNT),
  }), [wallPalette])
  const dimmedInk = useMemo(() => dimTowardSky(ROOM_PALETTE.ink, WALL_DIM_AMOUNT), [])
  const dimmedAccent = useMemo(() => dimTowardSky(ROOM_PALETTE.accent, WALL_DIM_AMOUNT), [])

  // Backstop for the hover cursor set by clickable name plates. The click path
  // clears it inline, but a plate can also stop being hoverable without an
  // onPointerOut ever firing — the wall gets dimmed mid-hover, or the room
  // unmounts for another reason — and a stuck 'pointer' cursor is app-wide.
  useEffect(() => () => { document.body.style.cursor = '' }, [])

  const getTransform = (index: number) => getWallTransformResolved(wallConfig, index)
  const floorBounds = calculateFloorBounds(wallConfig)

  // groundSize just needs to clear fogFar by a healthy margin so its own
  // edge stays hidden in fog; the fog numbers themselves are computed by
  // getRoomFogParams and rendered as an actual <fog> element up in
  // StudioRoom's <Canvas> (see that export's comment for why it can't live
  // here as JSX).
  const groundSize = useMemo(() => {
    const span = Math.max(floorBounds.floorWidth, floorBounds.floorDepth, 96)
    return Math.max(8000, span * 10)
  }, [floorBounds.floorWidth, floorBounds.floorDepth])

  // Reuses getRoomFogParams' own numbers (same wallConfig) purely so the grid
  // fades out at the same distance the scene fog does — two different fades
  // disagreeing on where the horizon is would look like two horizons.
  const { fogFar } = useMemo(() => getRoomFogParams(wallConfig), [wallConfig])

  return (
    <group>
      {/* Large ground plane the room sits on, so orbiting out past the floor's
          edge finds more ground (fading into fog) instead of empty background
          — the "floating platform" fix. */}
      <mesh position={[floorBounds.floorCenterX, GROUND_Y, floorBounds.floorCenterZ]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[groundSize, groundSize]} />
        <meshStandardMaterial color={GROUND_COLOR} roughness={0.95} metalness={0} fog />
      </mesh>

      {/* Reference grid — a foot-scale minor line and a 10-foot-scale major
          line, the same convention as any CAD or level-editor floor grid, so
          the surrounding space reads as measurable rather than a flat colour.
          Sits between the ground and the room's floor plate (see FLOOR_Y /
          GRID_Y / GROUND_Y for why they're spaced), so the opaque floor hides
          it inside the room and it only shows on the ground around it.

          `args` is deliberately modest (canonical drei infiniteGrid usage, e.g.
          their own docs example, uses [10,10]) — infiniteGrid's shader already
          multiplies the visible extent by (1 + fadeDistance) on top of whatever
          `args` is, so pairing it with groundSize-scale args would compound into
          tens of millions of vertex-space units and risk float32 precision
          jitter in the shader's line test. fadeDistance alone (matched to the
          scene fog's fogFar) already controls how far out the grid reads. */}
      <Grid
        position={[floorBounds.floorCenterX, GRID_Y, floorBounds.floorCenterZ]}
        args={[10, 10]}
        cellSize={12}
        cellThickness={1}
        cellColor={GRID_CELL_COLOR}
        sectionSize={120}
        sectionThickness={1.8}
        sectionColor={GRID_SECTION_COLOR}
        fadeDistance={fogFar}
        fadeStrength={1}
        followCamera={false}
        infiniteGrid
      />

      {/* Floor: a flat surface sitting on the grid, NOT a slab. It used to be a
          box as deep as the walls, whose side faces read as a thick grey band
          around the room's edge. A plan-like plate reads better and there is
          nothing to see underneath it anyway — the camera can't go below the
          horizon (OrbitControls' maxPolarAngle). */}
      <mesh
        position={[floorBounds.floorCenterX, FLOOR_Y, floorBounds.floorCenterZ]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
        onClick={(e) => {
          // Only bound while a wall is focused; otherwise stay out of the way so
          // a stray floor click can't swallow an orbit gesture.
          //
          // No drag-threshold guard, deliberately. Focus switches OrbitControls
          // off, so there is no orbit for a click to be the tail of — the guard
          // could only ever reject a real click that wandered a few pixels. That
          // matters here because this is the main way out of a state where the
          // camera is locked: a rejected click leaves the user feeling stuck.
          if (!onFloorClick) return
          e.stopPropagation()
          onFloorClick()
        }}
      >
        <planeGeometry args={[floorBounds.floorWidth, floorBounds.floorDepth]} />
        <meshStandardMaterial
          color={ROOM_PALETTE.floor} // cool neutral floor; never tinted toward the accent
          roughness={0.9}
          metalness={0.0}
        />
      </mesh>

      {wallConfig.walls.map((wall, wallIndex) => {
        const transform = getTransform(wallIndex)
        // Wall focus: every wall except the focused one ghosts back. Resolved
        // once here and threaded down, so the wall slab, its edge shadows, its
        // boards, name plates, bay outline and text labels all de-emphasise
        // together — dimming the slab alone would leave the artwork floating at
        // full contrast, which is the opposite of focus.
        const isDimmed = dimmedExceptWall != null && wallIndex !== dimmedExceptWall
        const palette = isDimmed ? dimmedWallPalette : wallPalette
        const inkColor = isDimmed ? dimmedInk : ROOM_PALETTE.ink
        // Faint glow when another user is editing this wall (presence).
        // Suppressed while ghosted: a glowing accent on a wall we're actively
        // pushing into the background reads as a rendering bug, and PresenceBar
        // still reports who's where.
        const isOthersEditing = (othersEditingWalls?.has(wallIndex) ?? false) && !isDimmed
        // Hide thumbnails on the editing wall ONLY once the edit UI has fully taken over
        // (i.e. DraggableBoards are mounted). During the camera transition we keep the
        // thumbnails mounted so there's no empty-wall flicker.
        const boardsOnWall = boards.filter(b => {
          if (!b.position || b.position.wallIndex !== wallIndex) return false
          if (editUIActive && editingWall === wallIndex) return false
          return true
        })

        // One plate per OWNER per side, not per board — a person with a dozen
        // boards on one wall used to get a dozen repeats of their own name
        // stamped above each sheet. Grouped by ownerId when present (falls
        // back to the display name for legacy rows without one, which can
        // only over-merge two different people who happen to share a
        // display name — an acceptable, rare edge case), spanning the
        // bounding box of every board in the group so the plate sits above
        // the group's topmost sheet, centered on the group's horizontal span.
        interface PlateGroup { key: string; studentId: string; label: string; side: 'front' | 'back'; minX: number; maxX: number; topY: number }
        const plateGroups = new Map<string, PlateGroup>()
        for (const board of boardsOnWall) {
          if (!board.position) continue
          const label = cleanDisplayName(board.ownerName) || cleanDisplayName(board.studentName)
          if (!label) continue
          const { widthIn, heightIn } = getBoardSizeInches(board)
          if (!widthIn || !heightIn || widthIn <= 0 || heightIn <= 0) continue
          const side: 'front' | 'back' = board.position.side === 'back' ? 'back' : 'front'
          const identity = board.ownerId || label
          const key = `${identity}|${side}`
          const cx = ((board.position.x / 100) - 0.5) * transform.width
          const cy = ((board.position.y / 100) - 0.5) * transform.height
          const left = cx - widthIn / 2
          const right = cx + widthIn / 2
          const top = cy + heightIn / 2
          const existing = plateGroups.get(key)
          if (!existing) {
            plateGroups.set(key, {
              key,
              // Must match RoomStudent.id so a plate click can resolve to the
              // person the roster and the 2D archive know about.
              studentId: studentKeyFor(board.ownerId, label),
              label,
              side,
              minX: left,
              maxX: right,
              topY: top,
            })
          } else {
            existing.minX = Math.min(existing.minX, left)
            existing.maxX = Math.max(existing.maxX, right)
            existing.topY = Math.max(existing.topY, top)
          }
        }
        const plateInputs: PlateLayoutInput[] = Array.from(plateGroups.values()).map((g) => ({
          key: g.key,
          centerX: (g.minX + g.maxX) / 2,
          baseY: g.topY + NAME_PLATE_GAP_IN,
          label: g.label,
        }))
        const plateRows = assignNamePlateRows(plateInputs)

        // Selected student's bay: the bounding box of their boards on THIS wall
        // side, drawn as a blue-accent outline set proud of the surface. Computed per
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
            {/* Front and back pick surfaces – same wall-local coords so no inversion */}
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
                color={palette.main} // room wall color (grey default / paper white), ghosted when unfocused
                // White mode matches the board material's roughness (0.7) so a
                // white sheet and the wall share the same sheen — no "glossier
                // sheet" cue. Grey is unchanged at 0.85.
                roughness={wallColor === 'white' ? 0.7 : 0.85}
                metalness={0.0}
                depthWrite={true}
                depthTest={true}
                // Presence highlight: soft accent glow on walls another user is
                // editing. Black/0 = no glow (default). Tunable.
                emissive={isOthersEditing ? ROOM_PALETTE.accent : '#000000'}
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
                color={palette.sideEdge} // side edge shadow (per wall color)
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
                color={palette.sideEdge} // side edge shadow (per wall color)
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
                color={palette.topEdge} // top edge shadow (per wall color)
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
                color={palette.bottomEdge} // bottom edge shadow (per wall color)
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
                // Key by localId (stable across temp→real id swap) when
                // present so the post-edit render path doesn't remount the
                // thumbnail purely because a temp board's id changed. Falls
                // back to board.id for server-loaded boards.
                <BoardThumbnail
                  key={board.localId || board.id}
                  board={board}
                  position={[boardX, boardY, finalBoardZ]}
                  width={boardWidth}
                  height={boardHeight}
                  onClick={onBoardClick}
                  isHighlighted={highlightedBoardId === board.id}
                  onHover={(hovered) => onBoardHover?.(hovered ? board.id : null)}
                  suppressCountBadge={suppressCallouts || isDimmed}
                  dimmed={isDimmed}
                />
              )
            })}

            {/* One name plate per owner per side (see plateGroups above) — NOT
                per board. Same z convention as the wall labels below: wall
                half-depth plus 0.25, so the plate clears both the wall
                surface and any board at ±3.2 without z-fighting either. */}
            {Array.from(plateGroups.values()).map((g) => {
              const PLATE_SURFACE_OFFSET = 3
              const plateX = (g.minX + g.maxX) / 2
              const plateZ = g.side === 'back'
                ? -(PLATE_SURFACE_OFFSET + 0.25)
                : PLATE_SURFACE_OFFSET + 0.25
              const plateY = g.topY + NAME_PLATE_GAP_IN + (plateRows.get(g.key) ?? 0) * NAME_PLATE_ROW_STEP_IN
              // A ghosted wall's plates stay inert: they're barely legible, and
              // clicking one would navigate away from the wall being focused.
              const plateClickable = Boolean(onNamePlateClick) && !isDimmed
              return (
                <Text
                  key={g.key}
                  position={[plateX, plateY, plateZ]}
                  onClick={plateClickable ? (e) => {
                    e.stopPropagation()
                    // Same guard the wall surfaces use: a click that ended a
                    // drag was an orbit, not a click.
                    if (e.delta > FLOOR_DRAG_THRESHOLD_PX) return
                    // Clear the hover cursor BEFORE navigating: opening the 2D
                    // archive unmounts this whole Canvas, so onPointerOut will
                    // never fire and the pointer cursor would otherwise stick
                    // across the entire app.
                    document.body.style.cursor = ''
                    onNamePlateClick?.(g.studentId)
                  } : undefined}
                  onPointerOver={plateClickable ? () => { document.body.style.cursor = 'pointer' } : undefined}
                  onPointerOut={plateClickable ? () => { document.body.style.cursor = '' } : undefined}
                  // Back-side plates face into the back room so they read
                  // correctly, matching the wall labels.
                  rotation={g.side === 'back' ? [0, Math.PI, 0] : [0, 0, 0]}
                  font={ROOM_FONT_3D}
                  fontSize={NAME_PLATE_SIZE_IN}
                  color={inkColor}
                  // Stands in for a 600 weight the default face does not
                  // carry; see NAME_PLATE_OUTLINE_IN.
                  outlineWidth={NAME_PLATE_OUTLINE_IN}
                  outlineColor={inkColor}
                  anchorX="center"
                  // Bottom anchor grows the plate upward from the gap above
                  // the board, so a long name never creeps down over the sheet.
                  anchorY="bottom"
                  maxWidth={Math.max(g.maxX - g.minX, NAME_PLATE_SIZE_IN * 8)}
                >
                  {g.label}
                </Text>
              )
            })}

            {/* Selected student's bay outline. lineSegments, not a filled plane,
                so nothing accent-colored ever sits behind a sheet. */}
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
                <lineBasicMaterial color={isDimmed ? dimmedAccent : ROOM_PALETTE.accent} />
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
                    font={ROOM_FONT_3D}
                    fontSize={t.fontSize}
                    color={inkColor}
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