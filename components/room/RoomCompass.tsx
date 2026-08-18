'use client'

import { useMemo } from 'react'
import { ROOM, MONO_STACK } from '@/lib/room/palette'
import { roomPlan, type RoomShell } from '@/lib/room/roomShell'

/**
 * Bottom-right room plan with a live view cone.
 *
 * Replaces RoomMinimap. Two differences that matter: it is drawn from the same
 * closed-ring geometry the room itself uses, so the two can never disagree; and
 * every bay is a click target, which makes it a navigation control rather than
 * a readout. The cone is plain SVG driven by the same `facing` value as the
 * shell — the old version mutated attributes inside a rAF loop because an
 * orbiting camera changed continuously, and nothing here does.
 */

const SIZE = 150
const PAD = 12
/** Half-angle of the view wedge. Kept near the room's real horizontal fov. */
const CONE_HALF_DEG = 30

export interface RoomCompassProps {
  shell: RoomShell
  /** Unwrapped facing counter — fractional values sweep the cone smoothly. */
  facing: number
  onSelectBay?: (index: number) => void
  /** Bays holding at least one board, drawn heavier than empty ones. */
  occupiedBays?: Set<number>
  animate?: boolean
}

export default function RoomCompass({
  shell,
  facing,
  onSelectBay,
  occupiedBays,
  animate = true,
}: RoomCompassProps) {
  const { segments, cone } = useMemo(() => {
    const plan = roomPlan(shell)
    const s = (SIZE - PAD * 2) / (plan.radiusIn * 2)
    // Plan +Y runs away from the viewer; SVG +Y runs down. Negating puts
    // "ahead" at the top of the compass, the way a floor plan is read.
    const toSvg = (x: number, y: number): [number, number] => [SIZE / 2 + x * s, SIZE / 2 - y * s]
    return {
      segments: plan.segments.map((seg) => {
        const [ax, ay] = toSvg(seg.x1, seg.y1)
        const [bx, by] = toSvg(seg.x2, seg.y2)
        return { bayIndex: seg.bayIndex, ax, ay, bx, by }
      }),
      cone: plan.radiusIn * s * 0.94,
    }
  }, [shell])

  const facingBay = ((Math.round(facing) % shell.bays.length) + shell.bays.length) % shell.bays.length
  const headingDeg = facing * shell.sliceDeg
  const cx = SIZE / 2
  const cy = SIZE / 2

  // Wedge in local space pointing "up" (ahead), then rotated by the heading.
  const half = (CONE_HALF_DEG * Math.PI) / 180
  const wedge = `${cx},${cy} ${cx - Math.sin(half) * cone},${cy - Math.cos(half) * cone} ${cx + Math.sin(half) * cone},${cy - Math.cos(half) * cone}`

  return (
    <div
      className="fixed bottom-28 right-4 z-30 rounded-2xl shadow-xl overflow-hidden"
      style={{ background: ROOM.wall, border: `1px solid ${ROOM.hairline}` }}
      aria-hidden="false"
    >
      <svg width={SIZE} height={SIZE} role="img" aria-label="Room plan">
        <rect width={SIZE} height={SIZE} fill={ROOM.wall} />

        <g style={{ transformOrigin: `${cx}px ${cy}px`, transform: `rotate(${headingDeg}deg)`, transition: animate ? 'transform 760ms cubic-bezier(0.22,0.61,0.36,1)' : 'none' }}>
          <polygon points={wedge} fill={ROOM.amber} opacity={0.22} />
        </g>

        {segments.map((seg) => {
          const isFacing = seg.bayIndex === facingBay
          const occupied = occupiedBays?.has(seg.bayIndex)
          return (
            <g key={seg.bayIndex}>
              <line
                x1={seg.ax} y1={seg.ay} x2={seg.bx} y2={seg.by}
                stroke={isFacing ? ROOM.amber : occupied ? ROOM.ink : ROOM.hairline}
                strokeWidth={isFacing ? 4 : occupied ? 3 : 2}
                strokeLinecap="round"
              />
              {onSelectBay && (
                <line
                  x1={seg.ax} y1={seg.ay} x2={seg.bx} y2={seg.by}
                  stroke="transparent" strokeWidth={14} strokeLinecap="round"
                  style={{ cursor: 'pointer' }}
                  onClick={() => onSelectBay(seg.bayIndex)}
                >
                  <title>{shell.bays[seg.bayIndex]?.label || `Bay ${seg.bayIndex + 1}`}</title>
                </line>
              )}
            </g>
          )
        })}

        {/* The viewer. Fixed at the centre, because they are. */}
        <circle cx={cx} cy={cy} r={3.5} fill={ROOM.ink} />
      </svg>

      <div
        className="px-2.5 py-1.5 text-[9px] uppercase tracking-[0.16em] truncate"
        style={{ fontFamily: MONO_STACK, color: ROOM.ink, borderTop: `1px solid ${ROOM.hairline}` }}
      >
        {shell.bays[facingBay]?.label || 'Blank wall'}
      </div>
    </div>
  )
}
