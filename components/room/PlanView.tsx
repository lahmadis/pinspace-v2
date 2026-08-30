'use client'

import { useMemo } from 'react'
import type { Board } from '@/types'
import { ROOM, MONO_STACK, SANS_STACK } from '@/lib/room/palette'
import { wallSegments, planBounds, type WallConfigLike } from '@/lib/room/planGeometry'
import { makePlanProjection } from '@/lib/room/planProjection'
import { getFloorRect, floorRectBounds } from '@/lib/wallLayout'
import { getBoardSizeInches } from '@/lib/boardDimensions'
import { deriveRoomStudents, type RoomStudent } from '@/lib/room/students'

interface PlanViewProps {
  wallConfig: WallConfigLike
  /**
   * Boards are NOT drawn on the plan — see the component note below. They are
   * still needed to decide which FACE of a wall a click should frame in 3D,
   * which is a property of where the work actually hangs and cannot be
   * recovered from the geometry alone.
   */
  boards: Board[]
  /**
   * Click a wall line — jumps to the 3D space framed head-on to that wall. The
   * side is decided here rather than by the caller: a plan carries no notion of
   * which face you meant, and this component already knows which face each
   * board is on.
   */
  onWallClick?: (wallIndex: number, side: 'front' | 'back') => void
}

/**
 * Plan viewBox size and margin. Exported because the inline room editor draws
 * into the same square through the same projection helper — passing these
 * rather than letting it fall back to its own modal dimensions is what makes
 * "the editor is the plan" true geometrically and not just visually.
 */
export const PLAN_VIEW = 1000
export const PLAN_MARGIN = 90

const VIEW = PLAN_VIEW
const MARGIN = PLAN_MARGIN

/** How far a name sits off the wall centre-line, in plan units. */
const LABEL_OFFSET = 46
/** Vertical step when two names would overlap. */
const LABEL_STEP = 26
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
}

/**
 * Top-down plan of the space — architecture only.
 *
 * Walls are heavy stroke, labelled by index, over a scale bar — and each
 * person's NAME sits over their own run of boards.
 *
 * The names were stripped out once, along with a tick per board and a dot per
 * open callout, on the argument that the plan's job is the room's layout and
 * board-level annotation competed with the linework. Half of that held: the
 * ticks and callout dots are still gone and should stay gone. The names came
 * back, because "whose work is on this wall" is the one question a plan gets
 * asked in a crit that no other view answers spatially — the roster and the 2D
 * archive both organise BY person and so can't show you the room.
 *
 * The north arrow is gone too: the plan's orientation is the room's own, not a
 * compass bearing, so an N pointing up the page asserted something untrue.
 *
 * Board ticks, if ever wanted again, are in git at bde4737 — and note the
 * detail that took two passes to get right, preserved below in the label
 * placement: the wall's TRUE face normal and the outward label heuristic are
 * two different vectors and must not be conflated.
 */
export default function PlanView({
  wallConfig,
  boards,
  onWallClick,
}: PlanViewProps) {
  const { segments, toPlan, scaleBar, dominantSide, floorRect, labels } = useMemo(() => {
    const segs = wallSegments(wallConfig)
    const wb = planBounds(segs, 36)
    // The slab is its own surface and may extend past the walls, so the sheet
    // has to frame both — see getFloorRect.
    const floorRect = getFloorRect(wallConfig as Parameters<typeof getFloorRect>[0])
    const fb = floorRectBounds(floorRect)
    const b = segs.length === 0 ? wb : {
      minX: Math.min(wb.minX, fb.minX - 36),
      maxX: Math.max(wb.maxX, fb.maxX + 36),
      minZ: Math.min(wb.minZ, fb.minZ - 36),
      maxZ: Math.max(wb.maxZ, fb.maxZ + 36),
    }
    // Shared with the wall editor (lib/room/planProjection.ts) so the two plans
    // are provably the same drawing — same scale, same orientation — rather than
    // two hand-rolled mappings that drifted into mirroring each other.
    const proj = makePlanProjection(b, VIEW, VIEW, MARGIN)
    const s = proj.scale
    const toPlan = proj.toPx

    /** Fuller face per wall — what a wall click should frame in 3D. */
    const dominantSide = new Map<number, 'front' | 'back'>()

    // Who is pinned up, and on which boards. Derived here rather than taken as
    // a prop so this stays a two-prop component: it is the same grouping the
    // roster and the 2D archive use, so a person is one person everywhere.
    const students = deriveRoomStudents(boards)
    const studentByBoardId = new Map<string, RoomStudent>()
    for (const st of students) for (const id of st.boardIds) studentByBoardId.set(id, st)
    const centerX = (b.minX + b.maxX) / 2
    const centerZ = (b.minZ + b.maxZ) / 2

    const placed: PlacedLabel[] = []

    for (const seg of segs) {
      const onWall = boards.filter((bd) => bd.position?.wallIndex === seg.index)
      if (onWall.length === 0) continue
      // Framing the empty back of a single-sided wall would look like the jump
      // to 3D had failed, so a wall click goes to whichever face has more work.
      const backCount = onWall.filter((bd) => bd.position?.side === 'back').length
      dominantSide.set(seg.index, backCount > onWall.length - backCount ? 'back' : 'front')

      // Local -X is (x2,z2) and local +X is (x1,z1) — see wallSegments — which
      // is why the lerp below runs from point 2 to point 1.
      const dx = seg.x1 - seg.x2
      const dz = seg.z1 - seg.z2
      const len = Math.hypot(dx, dz) || 1

      // `face` is geometric truth: dx = cos(r)·w and dz = -sin(r)·w, so this
      // works out to (sin r, cos r) — local +Z rotated by the wall's rotation,
      // which is exactly the side WallSystem puts front-face boards on.
      //
      // `out` is a PRESENTATION heuristic layered on top: push text away from
      // the room's bounding-box centre so a name lands on the page rather than
      // on the plan. The two are kept apart deliberately — for a zigzag or
      // square layout they disagree on some walls, and conflating them is a bug
      // that renders plausibly.
      const faceX = -dz / len
      const faceZ = dx / len
      const towardCentre = (centerX - seg.cx) * faceX + (centerZ - seg.cz) * faceZ
      const flip = towardCentre > 0 ? -1 : 1
      const outX = faceX * flip
      const outZ = faceZ * flip

      // Per-person span along this wall, in normalised 0..1 wall coordinates,
      // so a name sits over that person's own run of work rather than at an
      // even interval along the wall.
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
        const student = studentByBoardId.get(bd.id)
        if (!student) continue
        const existing = spans.get(student.id)
        if (!existing) spans.set(student.id, { student, min: tA, max: tB })
        else { existing.min = Math.min(existing.min, tA); existing.max = Math.max(existing.max, tB) }
      }

      for (const { student, min, max } of spans.values()) {
        const mid = (min + max) / 2
        // Width of this person's run, in plan units — the budget the name has.
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
        placed.push({ student, text, x: lx, y: ly })
      }
    }

    // Greedy de-collision: nudge downward until clear of everything placed.
    const labels: PlacedLabel[] = []
    for (const label of [...placed].sort((a, b2) => a.y - b2.y || a.x - b2.x)) {
      let y = label.y
      let guard = 0
      while (
        guard++ < 20 &&
        labels.some((o) => Math.abs(o.x - label.x) < 110 && Math.abs(o.y - y) < LABEL_STEP)
      ) {
        y += LABEL_STEP
      }
      labels.push({ ...label, y })
    }

    // Scale bar: a round number of feet that fits comfortably.
    const targetPx = 160
    const feet = Math.max(1, Math.round(targetPx / (s * 12)))
    return {
      segments: segs,
      toPlan,
      scaleBar: { feet, px: feet * 12 * s },
      dominantSide,
      floorRect,
      labels,
    }
  }, [wallConfig, boards])


  return (
    <div className="absolute inset-0 overflow-auto" style={{ background: ROOM.background }}>
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
            Nobody has laid out this room yet.
          </p>
        </div>
      )}

      <svg viewBox={`0 0 ${VIEW} ${VIEW}`} className="w-full h-full" role="img" aria-label="Space floor plan">
        {/* Floor field */}
        <rect x={0} y={0} width={VIEW} height={VIEW} fill={ROOM.background} />

        {/* Floor slab. Read-only here, but drawn so this view shows the same
            room the editor does rather than walls floating on nothing. */}
        {(() => {
          const [fx1, fy1] = toPlan(
            floorRect.centerX - floorRect.width / 2,
            floorRect.centerZ - floorRect.depth / 2,
          )
          const [fx2, fy2] = toPlan(
            floorRect.centerX + floorRect.width / 2,
            floorRect.centerZ + floorRect.depth / 2,
          )
          return (
            <rect
              x={Math.min(fx1, fx2)}
              y={Math.min(fy1, fy2)}
              width={Math.abs(fx2 - fx1)}
              height={Math.abs(fy2 - fy1)}
              fill={ROOM.wall}
              stroke={ROOM.hairline}
              strokeWidth={1.5}
            />
          )
        })()}

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

        {/* Who is pinned where. The name sits over that person's OWN run of
            boards, offset onto the page side of the wall, so the plan answers
            "whose work is on this wall" without drawing the work itself. */}
        {labels.map(({ student, text, x, y }) => (
          <text
            key={student.id + x + y}
            x={x}
            y={y}
            textAnchor="middle"
            style={{ fontFamily: SANS_STACK, fontSize: NAME_FONT, fontWeight: 700, pointerEvents: 'none' }}
            fill={ROOM.ink}
          >
            {text}
            <title>{student.name}</title>
          </text>
        ))}

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
