'use client'

import { useMemo } from 'react'
import { ROOM, MONO_STACK, SANS_STACK } from '@/lib/room/palette'
import { wallSegments, planBounds, type WallConfigLike } from '@/lib/room/planGeometry'
import type { RoomStudent } from '@/lib/room/students'

interface PlanViewProps {
  wallConfig: WallConfigLike
  students: RoomStudent[]
  selectedStudentId: string | null
  onSelectStudent: (student: RoomStudent) => void
}

const VIEW = 1000
const MARGIN = 90
/** Label offset from its wall, in plan units, before collision resolution. */
const LABEL_OFFSET = 34
/** Vertical step when two labels would overlap. */
const LABEL_STEP = 26

interface PlacedLabel {
  student: RoomStudent
  x: number
  y: number
  anchor: 'start' | 'middle' | 'end'
}

/**
 * Top-down plan of the room.
 *
 * Walls are heavy stroke. Each student's name sits outside their wall segment,
 * offset along the wall's outward normal, with their callout count as dots
 * beside it. Labels that would collide are pushed apart rather than overlapping.
 */
export default function PlanView({ wallConfig, students, selectedStudentId, onSelectStudent }: PlanViewProps) {
  const { segments, toPlan, scaleBar, labels } = useMemo(() => {
    const segs = wallSegments(wallConfig)
    const b = planBounds(segs, 36)
    const s = Math.min((VIEW - MARGIN * 2) / (b.width || 1), (VIEW - MARGIN * 2) / (b.depth || 1))
    const offX = MARGIN + (VIEW - MARGIN * 2 - b.width * s) / 2
    const offY = MARGIN + (VIEW - MARGIN * 2 - b.depth * s) / 2

    // Students grouped onto their primary wall, spread along that wall's length.
    const byWall = new Map<number, RoomStudent[]>()
    for (const student of students) {
      const list = byWall.get(student.wallIndex) ?? []
      list.push(student)
      byWall.set(student.wallIndex, list)
    }

    const placed: PlacedLabel[] = []
    for (const [wallIndex, group] of byWall) {
      const seg = segs.find((sg) => sg.index === wallIndex)
      if (!seg) continue
      // Outward normal: perpendicular to the wall, pointing away from the room
      // centre so labels never land inside the plan.
      const dx = seg.x2 - seg.x1
      const dz = seg.z2 - seg.z1
      const len = Math.hypot(dx, dz) || 1
      let nx = -dz / len
      let nz = dx / len
      const towardCentre = (b.centerX - seg.cx) * nx + (b.centerZ - seg.cz) * nz
      if (towardCentre > 0) { nx = -nx; nz = -nz }

      group.forEach((student, i) => {
        // Spread evenly along the wall so several students on one wall read as
        // separate bays rather than a stack at the midpoint.
        const t = group.length === 1 ? 0.5 : (i + 0.5) / group.length
        const wx = seg.x1 + dx * t
        const wz = seg.z1 + dz * t
        const [px, py] = toPlan(wx + nx * LABEL_OFFSET, wz + nz * LABEL_OFFSET)
        placed.push({
          student,
          x: px,
          y: py,
          anchor: Math.abs(nx) > Math.abs(nz) ? (nx > 0 ? 'start' : 'end') : 'middle',
        })
      })
    }

    // Greedy de-collision: nudge downward until clear of everything placed.
    const settled: PlacedLabel[] = []
    for (const label of [...placed].sort((a, b2) => a.y - b2.y || a.x - b2.x)) {
      let y = label.y
      let guard = 0
      while (
        guard++ < 20 &&
        settled.some((o) => Math.abs(o.x - label.x) < 150 && Math.abs(o.y - y) < LABEL_STEP)
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
    }

    function toPlan(x: number, z: number): [number, number] {
      return [offX + (x - b.minX) * s, offY + (z - b.minZ) * s]
    }
  }, [wallConfig, students])

  return (
    <div className="absolute inset-0 overflow-auto" style={{ background: ROOM.background }}>
      <svg viewBox={`0 0 ${VIEW} ${VIEW}`} className="w-full h-full" role="img" aria-label="Room floor plan">
        {/* Floor field */}
        <rect x={0} y={0} width={VIEW} height={VIEW} fill={ROOM.background} />

        {segments.map((seg) => {
          const [x1, y1] = toPlan(seg.x1, seg.z1)
          const [x2, y2] = toPlan(seg.x2, seg.z2)
          return (
            <g key={seg.index}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={ROOM.ink} strokeWidth={9} strokeLinecap="square" />
              <text
                x={(x1 + x2) / 2}
                y={(y1 + y2) / 2 - 12}
                textAnchor="middle"
                style={{ fontFamily: MONO_STACK, fontSize: 13, letterSpacing: '0.16em' }}
                fill={ROOM.ink2}
              >
                W{String(seg.index + 1).padStart(2, '0')}
              </text>
            </g>
          )
        })}

        {labels.map(({ student, x, y, anchor }) => {
          const isSelected = student.id === selectedStudentId
          return (
            <g
              key={student.id}
              onClick={() => onSelectStudent(student)}
              style={{ cursor: 'pointer' }}
            >
              {isSelected && (
                <rect
                  x={anchor === 'end' ? x - 190 : anchor === 'middle' ? x - 95 : x - 6}
                  y={y - 15}
                  width={196}
                  height={22}
                  fill={ROOM.amber}
                  opacity={0.28}
                  rx={3}
                />
              )}
              <text
                x={x}
                y={y}
                textAnchor={anchor}
                style={{ fontFamily: SANS_STACK, fontSize: 15, fontWeight: 700 }}
                fill={ROOM.ink}
              >
                {student.name}
              </text>
              {/* Callout dots beside the name — one per open callout, capped. */}
              {Array.from({ length: Math.min(student.calloutCount, 6) }).map((_, i) => (
                <circle
                  key={i}
                  cx={(anchor === 'end' ? x - 190 : anchor === 'middle' ? x - 88 : x + 8) + i * 11}
                  cy={y + 10}
                  r={3.5}
                  fill={ROOM.redline}
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
