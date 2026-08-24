'use client'

import { useMemo } from 'react'
import { Grid2x2, Box } from 'lucide-react'
import type { Board } from '@/types'
import { ROOM, MONO_STACK, SANS_STACK } from '@/lib/room/palette'
import { wallSegments, planBounds, type WallConfigLike } from '@/lib/room/planGeometry'
import { makePlanProjection } from '@/lib/room/planProjection'
import { getBoardSizeInches } from '@/lib/boardDimensions'
import type { RoomStudent } from '@/lib/room/students'

interface PlanViewProps {
  wallConfig: WallConfigLike
  boards: Board[]
  students: RoomStudent[]
  selectedStudentId: string | null
  onSelectStudent: (student: RoomStudent) => void
  /** Click a board's tick — opens it full-screen in the lightbox. */
  onBoardClick?: (board: Board) => void
  /**
   * Click a wall line — jumps to the 3D space framed head-on to that wall. The
   * side is decided here rather than by the caller: a plan carries no notion of
   * which face you meant, and this component already knows which face each
   * board is on.
   */
  onWallClick?: (wallIndex: number, side: 'front' | 'back') => void
  /**
   * Open the wall editor. Omit to hide the button — a viewer who cannot edit
   * the room's configuration should not be shown a control that no-ops.
   *
   * These two live HERE, on the plan, rather than in a menu over the 3D view.
   * The plan IS the room's layout seen from above: it is where you can already
   * see the walls you would be reconfiguring and the floor you would be
   * placing a model on. A hamburger over the 3D view asked you to hold that
   * layout in your head while you edited it.
   */
  onReconfigureWalls?: () => void
  /** Open the floor editor to add or position a 3D model. */
  onPlaceModel?: () => void
}

const VIEW = 1000
const MARGIN = 90
/** Label offset from its wall, in plan units, before collision resolution. */
const LABEL_OFFSET = 46
/** Vertical step when two labels would overlap. */
const LABEL_STEP = 26
/** How far a board tick sits off the wall centre-line, per face. */
const TICK_OFFSET = 7
/** Thickness of a board tick. */
const TICK_WEIGHT = 5
/** Hit-target thickness for a tick. Narrower than the wall's own 30-unit band —
 *  it wins the click by being drawn later (SVG hit-tests in document order),
 *  not by being wider. */
const TICK_HIT_WEIGHT = 18
const NAME_FONT = 15
/**
 * Rough advance width per character as a fraction of font size, for the
 * name-or-initials fit test. Onest is a touch narrow; 0.52 slightly
 * under-estimates, which fails safe — we shrink to initials a hair sooner than
 * strictly needed rather than letting a name overrun its neighbour.
 */
const CHAR_W = 0.52

interface PlacedLabel {
  student: RoomStudent
  text: string
  x: number
  y: number
  anchor: 'start' | 'middle' | 'end'
}

interface BoardTick {
  board: Board
  x1: number
  y1: number
  x2: number
  y2: number
}

/**
 * Top-down plan of the space.
 *
 * Walls are heavy stroke. Every board is drawn as a thin accent tick at its real
 * position along its wall, spanning its actual width — so the plan shows how
 * full each wall is and where the gaps are, which is the thing you actually want
 * from a plan and which no other view answers. Front-face boards tick on the
 * room-inward side of the wall line, back-face boards on the outward side, so a
 * double-sided wall reads as two runs rather than one muddled one.
 *
 * Each person's name sits with THEIR boards rather than at an even interval
 * along the wall, so the label points at the work it belongs to. It degrades to
 * initials when the person's run of boards is too narrow for the full name, and
 * disappears entirely when even initials won't fit — better a nameless tick than
 * two overlapping labels.
 */
export default function PlanView({
  wallConfig,
  boards,
  students,
  selectedStudentId,
  onSelectStudent,
  onBoardClick,
  onWallClick,
  onReconfigureWalls,
  onPlaceModel,
}: PlanViewProps) {
  const { segments, toPlan, scaleBar, labels, ticks, emptyWalls, dominantSide } = useMemo(() => {
    const segs = wallSegments(wallConfig)
    const b = planBounds(segs, 36)
    // Shared with the wall editor (lib/room/planProjection.ts) so the two plans
    // are provably the same drawing — same scale, same orientation — rather than
    // two hand-rolled mappings that drifted into mirroring each other.
    const proj = makePlanProjection(b, VIEW, VIEW, MARGIN)
    const s = proj.scale
    const toPlan = proj.toPx

    const studentByBoardId = new Map<string, RoomStudent>()
    for (const st of students) for (const id of st.boardIds) studentByBoardId.set(id, st)

    const allTicks: BoardTick[] = []
    const placed: PlacedLabel[] = []
    const empty: Array<{ x: number; y: number }> = []
    /** Fuller face per wall — what a wall click should frame in 3D. */
    const dominantSide = new Map<number, 'front' | 'back'>()

    for (const seg of segs) {
      const onWall = boards.filter((bd) => bd.position?.wallIndex === seg.index)

      // Local -X is (x2,z2) and local +X is (x1,z1) — see wallSegments — which
      // is why the lerp below runs from point 2 to point 1.
      const dx = seg.x1 - seg.x2
      const dz = seg.z1 - seg.z2
      const len = Math.hypot(dx, dz) || 1

      // TWO different normals, for two different jobs — conflating them is a
      // bug that renders plausibly, so they're kept apart deliberately.
      //
      // `face` is geometric truth: dx = cos(r)·w and dz = -sin(r)·w, so this
      // works out to (sin r, cos r) — local +Z rotated by the wall's rotation,
      // which is exactly the side WallSystem puts front-face boards on. Ticks
      // MUST use this, or a board shows up on the wrong side of its wall.
      const faceX = -dz / len
      const faceZ = dx / len

      // `out` is a presentation heuristic: push text away from the room's
      // bounding-box centre so labels don't land on top of the plan. It is NOT
      // the front/back axis and must never be used for ticks — for a zigzag or
      // square layout it disagrees with `face` on some walls, which is what
      // previously mirrored their ticks.
      const towardCentre = (b.centerX - seg.cx) * faceX + (b.centerZ - seg.cz) * faceZ
      const flip = towardCentre > 0 ? -1 : 1
      const outX = faceX * flip
      const outZ = faceZ * flip

      if (onWall.length === 0) {
        // Offset in plan units (hence /s), matching LABEL_OFFSET — a raw world
        // offset here would drift with room size.
        const [ex, ey] = toPlan(seg.cx + outX * (30 / s), seg.cz + outZ * (30 / s))
        empty.push({ x: ex, y: ey })
        continue
      }

      // Framing the empty back of a single-sided wall would look like the jump
      // to 3D had failed, so a wall click goes to whichever face has more work.
      const backCount = onWall.filter((bd) => bd.position?.side === 'back').length
      dominantSide.set(seg.index, backCount > onWall.length - backCount ? 'back' : 'front')

      // Per-person span along this wall, in normalised 0..1 wall coordinates,
      // so a label can sit over its own boards.
      const spans = new Map<string, { student: RoomStudent; min: number; max: number }>()

      for (const bd of onWall) {
        if (!bd.position) continue
        // position.x is a 0-100 percentage along the wall; /100 is exactly the
        // lerp parameter from the local -X end to the local +X end.
        const t = bd.position.x / 100
        if (!Number.isFinite(t)) continue
        const { widthIn } = getBoardSizeInches(bd)
        const halfT = widthIn && seg.width ? widthIn / 2 / seg.width : 0.01
        const tA = Math.max(0, t - halfT)
        const tB = Math.min(1, t + halfT)

        // Front boards sit on the wall's +face side, back boards opposite —
        // using the true face normal, not the outward heuristic.
        const dir = (bd.position.side === 'back' ? -1 : 1) * TICK_OFFSET / s
        const [x1, y1] = toPlan(seg.x2 + dx * tA + faceX * dir, seg.z2 + dz * tA + faceZ * dir)
        const [x2, y2] = toPlan(seg.x2 + dx * tB + faceX * dir, seg.z2 + dz * tB + faceZ * dir)
        allTicks.push({ board: bd, x1, y1, x2, y2 })

        const student = studentByBoardId.get(bd.id)
        if (!student) continue
        const existing = spans.get(student.id)
        if (!existing) spans.set(student.id, { student, min: tA, max: tB })
        else { existing.min = Math.min(existing.min, tA); existing.max = Math.max(existing.max, tB) }
      }

      for (const { student, min, max } of spans.values()) {
        const mid = (min + max) / 2
        // Width of this person's run, in plan units — the budget the label has.
        const spanPx = (max - min) * seg.width * s
        const full = student.name
        const text =
          full.length * CHAR_W * NAME_FONT <= spanPx ? full
          : student.initials.length * CHAR_W * NAME_FONT <= spanPx ? student.initials
          : ''
        if (!text) continue
        const [lx, ly] = toPlan(
          seg.x2 + dx * mid + outX * (LABEL_OFFSET / s),
          seg.z2 + dz * mid + outZ * (LABEL_OFFSET / s),
        )
        placed.push({ student, text, x: lx, y: ly, anchor: 'middle' })
      }
    }

    // Greedy de-collision: nudge downward until clear of everything placed.
    const settled: PlacedLabel[] = []
    for (const label of [...placed].sort((a, b2) => a.y - b2.y || a.x - b2.x)) {
      let y = label.y
      let guard = 0
      while (
        guard++ < 20 &&
        settled.some((o) => Math.abs(o.x - label.x) < 110 && Math.abs(o.y - y) < LABEL_STEP)
      ) {
        y += LABEL_STEP
      }
      settled.push({ ...label, y })
    }

    // Scale bar: a round number of feet that fits comfortably.
    const targetPx = 160
    const feet = Math.max(1, Math.round(targetPx / (s * 12)))
    return {
      segments: segs,
      toPlan,
      scaleBar: { feet, px: feet * 12 * s },
      labels: settled,
      ticks: allTicks,
      emptyWalls: empty,
      dominantSide,
    }
  }, [wallConfig, boards, students])

  const selectedBoardIds = useMemo(() => {
    if (!selectedStudentId) return null
    const st = students.find((x) => x.id === selectedStudentId)
    return st ? new Set(st.boardIds) : null
  }, [selectedStudentId, students])

  const canConfigure = Boolean(onReconfigureWalls || onPlaceModel)

  return (
    <div className="absolute inset-0 overflow-auto" style={{ background: ROOM.background }}>
      {/* Room configuration, on the drawing it configures.
          Absolutely positioned over the plan rather than inside the SVG: these
          are DOM buttons with text, and scaling them with the viewBox would
          shrink the labels as the plan zoomed to fit.
          BOTTOM-left, not top-left. Every other corner is taken by chrome that
          paints above this panel: the breadcrumb is fixed top-left at z-40 (it
          covered these buttons entirely and ate their clicks), Share is fixed
          top-right, and the roster is fixed right at top-20. The revision strip
          is bottom-CENTRE, and this panel is already inset above it, so the
          bottom-left corner is the one piece of clear space. */}
      {canConfigure && (
        <div
          style={{
            position: 'absolute',
            bottom: 16,
            left: 16,
            zIndex: 1,
            width: 208,
            background: ROOM.wall,
            border: `1px solid ${ROOM.hairline}`,
            borderRadius: 12,
            boxShadow: '0 4px 16px rgba(22,24,29,0.10)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '9px 12px 7px',
              fontFamily: MONO_STACK,
              fontSize: 9.5,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: ROOM.ink2,
              borderBottom: `1px solid ${ROOM.hairline}`,
            }}
          >
            Edit room
          </div>
          <div style={{ padding: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {onReconfigureWalls && (
              <PlanAction
                label="Reconfigure walls"
                icon={<Grid2x2 size={14} strokeWidth={2} />}
                onClick={onReconfigureWalls}
              />
            )}
            {onPlaceModel && (
              <PlanAction
                label="Place 3D model"
                icon={<Box size={14} strokeWidth={2} />}
                onClick={onPlaceModel}
              />
            )}
          </div>
        </div>
      )}

      {/* A room with no walls yet draws an empty sheet, which says nothing
          about what to do next. The plan IS the wall editor's front door, so
          the empty state points at it rather than leaving a blank page. */}
      {segments.length === 0 && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none"
          style={{ gap: 6, padding: 24 }}
        >
          <p style={{ fontFamily: SANS_STACK, fontSize: 14, fontWeight: 600, color: ROOM.ink }}>
            No walls yet
          </p>
          <p style={{ fontFamily: MONO_STACK, fontSize: 11, color: ROOM.ink2, textAlign: 'center' }}>
            {onReconfigureWalls
              ? 'Use Reconfigure walls, bottom left, to lay out the room.'
              : 'Nobody has laid out this room yet.'}
          </p>
        </div>
      )}

      <svg viewBox={`0 0 ${VIEW} ${VIEW}`} className="w-full h-full" role="img" aria-label="Space floor plan">
        {/* Floor field */}
        <rect x={0} y={0} width={VIEW} height={VIEW} fill={ROOM.background} />

        {segments.map((seg) => {
          const [x1, y1] = toPlan(seg.x1, seg.z1)
          const [x2, y2] = toPlan(seg.x2, seg.z2)
          return (
            <g key={seg.index}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={ROOM.ink} strokeWidth={9} strokeLinecap="square" />
              {/* Fat transparent hit line — the drawn wall is only 9 units and
                  hard to hit; this keeps the click target comfortable without
                  thickening the drawing. */}
              {onWallClick && (
                <line
                  x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke="transparent" strokeWidth={30} strokeLinecap="square"
                  style={{ cursor: 'pointer' }}
                  onClick={() => onWallClick(seg.index, dominantSide.get(seg.index) ?? 'front')}
                >
                  <title>{`Wall ${String(seg.index + 1).padStart(2, '0')} — open in 3D`}</title>
                </line>
              )}
              <text
                x={(x1 + x2) / 2}
                y={(y1 + y2) / 2 - 12}
                textAnchor="middle"
                style={{ fontFamily: MONO_STACK, fontSize: 13, letterSpacing: '0.16em', pointerEvents: 'none' }}
                fill={ROOM.ink2}
              >
                W{String(seg.index + 1).padStart(2, '0')}
              </text>
            </g>
          )
        })}

        {/* Board ticks — one per board, spanning its real width on the wall. */}
        {ticks.map(({ board, x1, y1, x2, y2 }) => {
          const dimmed = selectedBoardIds != null && !selectedBoardIds.has(board.id)
          return (
            <g key={board.id}>
              <line
                x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={ROOM.accent}
                strokeWidth={TICK_WEIGHT}
                strokeLinecap="round"
                opacity={dimmed ? 0.25 : 1}
                pointerEvents="none"
              />
              {/* Fat transparent hit line, same trick the walls use. Without it
                  the tick's own ~4px target sits INSIDE the wall's 30-unit hit
                  band, so a near-miss doesn't do nothing — it navigates to 3D
                  instead of opening the board you were aiming at. Drawn after
                  the wall group, so SVG document order puts it on top. */}
              {onBoardClick && (
                <line
                  x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke="transparent"
                  strokeWidth={TICK_HIT_WEIGHT}
                  strokeLinecap="round"
                  style={{ cursor: 'pointer' }}
                  onClick={() => onBoardClick(board)}
                >
                  <title>{board.title?.trim() || 'Untitled board'}</title>
                </line>
              )}
            </g>
          )
        })}

        {/* Walls with nothing pinned up — the plan's most useful signal for an
            instructor, and one no other view reports at a glance. */}
        {emptyWalls.map((e, i) => (
          <text
            key={i}
            x={e.x}
            y={e.y}
            textAnchor="middle"
            style={{ fontFamily: MONO_STACK, fontSize: 11, letterSpacing: '0.14em', pointerEvents: 'none' }}
            fill={ROOM.ink2}
            opacity={0.6}
          >
            EMPTY
          </text>
        ))}

        {labels.map(({ student, text, x, y, anchor }) => {
          const isSelected = student.id === selectedStudentId
          return (
            <g
              key={`${student.id}-${x}-${y}`}
              onClick={() => onSelectStudent(student)}
              style={{ cursor: 'pointer' }}
            >
              {isSelected && (
                <rect
                  x={x - 95}
                  y={y - 15}
                  width={190}
                  height={22}
                  fill={ROOM.accent}
                  opacity={0.28}
                  rx={3}
                />
              )}
              <text
                x={x}
                y={y}
                textAnchor={anchor}
                style={{ fontFamily: SANS_STACK, fontSize: NAME_FONT, fontWeight: 700 }}
                fill={ROOM.ink}
              >
                {text}
                <title>{student.name}</title>
              </text>
              {/* Callout dots beside the name — one per open callout, capped. */}
              {Array.from({ length: Math.min(student.calloutCount, 6) }).map((_, i) => (
                <circle
                  key={i}
                  cx={x - 88 + i * 11}
                  cy={y + 10}
                  r={3.5}
                  fill={ROOM.accent}
                />
              ))}
            </g>
          )
        })}

        {/* North arrow */}
        <g transform={`translate(${VIEW - 70}, 60)`}>
          <line x1={0} y1={26} x2={0} y2={-20} stroke={ROOM.ink} strokeWidth={2.5} />
          <polygon points="0,-28 -7,-12 7,-12" fill={ROOM.ink} />
          <text x={0} y={44} textAnchor="middle" style={{ fontFamily: MONO_STACK, fontSize: 13, letterSpacing: '0.2em' }} fill={ROOM.ink}>
            N
          </text>
        </g>

        {/* Scale bar */}
        <g transform={`translate(60, ${VIEW - 56})`}>
          <line x1={0} y1={0} x2={scaleBar.px} y2={0} stroke={ROOM.ink} strokeWidth={3} />
          <line x1={0} y1={-6} x2={0} y2={6} stroke={ROOM.ink} strokeWidth={3} />
          <line x1={scaleBar.px} y1={-6} x2={scaleBar.px} y2={6} stroke={ROOM.ink} strokeWidth={3} />
          <text x={scaleBar.px / 2} y={22} textAnchor="middle" style={{ fontFamily: MONO_STACK, fontSize: 12, letterSpacing: '0.14em' }} fill={ROOM.ink}>
            {scaleBar.feet}′
          </text>
        </g>
      </svg>
    </div>
  )
}

/**
 * One plan-level action. Plain and quiet: the plan is a drawing, and these sit
 * on top of it, so they should read as an overlay rather than compete with the
 * linework.
 */
function PlanAction({
  label,
  icon,
  onClick,
}: {
  label: string
  icon: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        width: '100%',
        padding: '8px 9px',
        borderRadius: 8,
        border: 'none',
        background: 'transparent',
        color: ROOM.ink,
        fontFamily: SANS_STACK,
        fontSize: 12.5,
        fontWeight: 600,
        cursor: 'pointer',
        textAlign: 'left',
      }}
      className="hover:bg-[#16181D]/[0.055] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3B6EF6]/40"
    >
      <span style={{ color: ROOM.ink2, display: 'flex', flexShrink: 0 }}>{icon}</span>
      {label}
    </button>
  )
}
