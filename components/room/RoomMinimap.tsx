'use client'

import { useEffect, useMemo, useRef } from 'react'
import { ROOM, MONO_STACK } from '@/lib/room/palette'
import { wallSegments, planBounds, type WallConfigLike } from '@/lib/room/planGeometry'

interface RoomMinimapProps {
  wallConfig: WallConfigLike
  /** Wall the camera currently faces — drawn yellow. */
  facingWall: number
  /** Written per frame by RoomCameraRig; read here via rAF, never through state. */
  cameraPlanRef: React.MutableRefObject<{ azimuth: number; distance: number }>
}

const SIZE = 148
const PAD = 10
/** Half-angle of the view wedge, roughly matching the room's 50 degree fov. */
const CONE_HALF_ANGLE = 26 * (Math.PI / 180)

/**
 * Bottom-right floor plan with a live view cone.
 *
 * The cone is updated by mutating SVG attributes inside a rAF loop rather than
 * by re-rendering: it moves continuously while the user drags, and pushing that
 * through React state would re-render the whole room chrome every frame.
 */
export default function RoomMinimap({ wallConfig, facingWall, cameraPlanRef }: RoomMinimapProps) {
  const coneRef = useRef<SVGPolygonElement | null>(null)
  const eyeRef = useRef<SVGCircleElement | null>(null)

  const { segments, bounds, scale, toSvg } = useMemo(() => {
    const segs = wallSegments(wallConfig)
    const b = planBounds(segs, 18)
    const s = Math.min((SIZE - PAD * 2) / (b.width || 1), (SIZE - PAD * 2) / (b.depth || 1))
    const toSvgFn = (x: number, z: number): [number, number] => [
      PAD + (x - b.minX) * s + (SIZE - PAD * 2 - b.width * s) / 2,
      PAD + (z - b.minZ) * s + (SIZE - PAD * 2 - b.depth * s) / 2,
    ]
    return { segments: segs, bounds: b, scale: s, toSvg: toSvgFn }
  }, [wallConfig])

  useEffect(() => {
    let raf = 0
    const [ccx, ccz] = toSvg(bounds.centerX, bounds.centerZ)

    const tick = () => {
      raf = requestAnimationFrame(tick)
      const cone = coneRef.current
      if (!cone) return

      const { azimuth, distance } = cameraPlanRef.current
      // OrbitControls' spherical theta puts the camera at
      // (sin theta, cos theta) from the target, looking back at it.
      const dirX = Math.sin(azimuth)
      const dirZ = Math.cos(azimuth)
      // Clamp so a very wide zoom-out keeps the eye inside the panel.
      const eyeDist = Math.min(distance * scale, SIZE * 0.42)
      const ex = ccx + dirX * eyeDist
      const ey = ccz + dirZ * eyeDist

      // Wedge opens from the eye back toward the room centre.
      const backX = -dirX
      const backZ = -dirZ
      const reach = eyeDist + Math.min(bounds.width, bounds.depth) * scale * 0.5
      const leftA = Math.atan2(backZ, backX) - CONE_HALF_ANGLE
      const rightA = Math.atan2(backZ, backX) + CONE_HALF_ANGLE

      cone.setAttribute(
        'points',
        `${ex},${ey} ${ex + Math.cos(leftA) * reach},${ey + Math.sin(leftA) * reach} ${ex + Math.cos(rightA) * reach},${ey + Math.sin(rightA) * reach}`,
      )
      const eye = eyeRef.current
      if (eye) {
        eye.setAttribute('cx', String(ex))
        eye.setAttribute('cy', String(ey))
      }
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [bounds, scale, toSvg, cameraPlanRef])

  if (segments.length === 0) return null

  return (
    <div
      className="fixed bottom-24 right-4 z-30 rounded-2xl shadow-xl p-2"
      style={{ background: ROOM.ink, border: `1px solid ${ROOM.hairline}` }}
      aria-hidden="true"
    >
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img">
        {/* Floor field, so the plan reads as a room rather than loose lines. */}
        <rect x={0} y={0} width={SIZE} height={SIZE} rx={10} fill="rgba(216,211,198,0.10)" />

        {/* View cone under the walls so wall lines stay crisp on top. */}
        <polygon ref={coneRef} points="" fill={ROOM.yellow} opacity={0.18} />

        {segments.map((s) => {
          const [x1, y1] = toSvg(s.x1, s.z1)
          const [x2, y2] = toSvg(s.x2, s.z2)
          const isFacing = s.index === facingWall
          return (
            <line
              key={s.index}
              x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={isFacing ? ROOM.yellow : ROOM.hairline}
              strokeWidth={isFacing ? 3.5 : 2}
              strokeLinecap="round"
            />
          )
        })}

        <circle ref={eyeRef} r={3} fill={ROOM.yellow} />
      </svg>
      <div
        className="text-[9px] uppercase tracking-[0.16em] text-center pt-1"
        style={{ fontFamily: MONO_STACK, color: ROOM.hairline }}
      >
        Plan · W{String(facingWall + 1).padStart(2, '0')}
      </div>
    </div>
  )
}
