'use client'

import { useMemo } from 'react'
import type { Board } from '@/types'
import { ROOM, MONO_STACK, SANS_STACK } from '@/lib/room/palette'
import { wallSegments, planBounds, type WallConfigLike } from '@/lib/room/planGeometry'
import { makePlanProjection } from '@/lib/room/planProjection'
import { getFloorRect, floorRectBounds } from '@/lib/wallLayout'

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

/**
 * Top-down plan of the space — architecture only.
 *
 * Walls are heavy stroke, labelled by index, over a scale bar and a north
 * arrow. That is deliberately ALL: the plan used to also draw every board as an
 * accent tick at its real position, each person's name over their run of work,
 * and a dot per open callout beside that name. Those are gone. The plan's job
 * is the room's layout — the thing you reconfigure — and board-level annotation
 * competed with the linework it was drawn on top of. Occupancy and callouts are
 * answered by the roster, the 2D view and the 3D space; the plan answers where
 * the walls are.
 *
 * If board positions are ever wanted here again, note they were removed as a
 * product decision rather than because they were wrong — the tick geometry used
 * the wall's true face normal (not the outward label heuristic), which is the
 * detail that took two passes to get right.
 */
export default function PlanView({
  wallConfig,
  boards,
  onWallClick,
}: PlanViewProps) {
  const { segments, toPlan, scaleBar, dominantSide, floorRect } = useMemo(() => {
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
    for (const seg of segs) {
      const onWall = boards.filter((bd) => bd.position?.wallIndex === seg.index)
      if (onWall.length === 0) continue
      // Framing the empty back of a single-sided wall would look like the jump
      // to 3D had failed, so a wall click goes to whichever face has more work.
      const backCount = onWall.filter((bd) => bd.position?.side === 'back').length
      dominantSide.set(seg.index, backCount > onWall.length - backCount ? 'back' : 'front')
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
