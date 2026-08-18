'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Board } from '@/types'
import { getBoardSizeInches } from '@/lib/boardDimensions'
import { ROOM, MONO_STACK, SANS_STACK } from '@/lib/room/palette'
import type { RoomStudent } from '@/lib/room/students'
import RoomBoard from './RoomBoard'
import { bayIndexForBoard, projectRoom, type RoomBay, type RoomShell } from '@/lib/room/roomShell'

/**
 * The room.
 *
 * A CSS 3D shell containing floor, ceiling and one panel per bay, arranged as a
 * closed ring. The viewer sits at the centre of that ring, at eye height, and
 * NEVER moves: the only animated property in this file is a single rotateY on
 * the shell, which sweeps the walls past a stationary camera. There is no orbit,
 * no dolly, no fov change — turning your head is modelled as the room turning.
 *
 * `translateZ(P)` on the shell puts the camera exactly at the room's centre, so
 * the facing wall lands on the projection plane and its sheets render 1:1. See
 * lib/room/roomShell.ts for why that falls out of the CSS perspective formula.
 */

const WALL_PALETTES = {
  grey: { face: '#F2EEE3', trim: '#E2DCCD', base: '#CFC8B7' },
  white: { face: '#FFFFFF', trim: '#F0ECE1', base: '#D6CFBE' },
} as const

/** Gap between a sheet cluster and the name plate above it, inches. */
const PLATE_GAP_IN = 5
const PLATE_H_PX = 20

export interface RoomStageProps {
  shell: RoomShell
  boards: Board[]
  /** Unwrapped bay counter. Fractional values are fine — the shell follows it. */
  facing: number
  wallColor?: 'grey' | 'white'
  students?: RoomStudent[]
  selectedStudentId?: string | null
  onBoardOpen?: (board: Board) => void
  suppressCallouts?: boolean
  /** False under prefers-reduced-motion: the shell jumps instead of sweeping. */
  animate?: boolean
  /** Bay indices other people are currently looking at, for a soft presence mark. */
  occupiedBays?: Set<number>
  /**
   * Double-click on the facing wall to edit it — same gesture the old 3D room
   * used. Only the facing bay is wired up; the others aren't the wall you're
   * looking at, so double-clicking them wouldn't mean anything. Omit to leave
   * the room read-only (e.g. no edit permission, or a public/guest viewer).
   */
  onEditWall?: (bay: RoomBay) => void
}

function useViewport(ref: React.RefObject<HTMLElement>) {
  const [size, setSize] = useState({ w: 1280, h: 800 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return size
}

interface Plate {
  key: string
  label: string
  index: string
  leftPx: number
  topPx: number
  selected: boolean
}

export default function RoomStage({
  shell,
  boards,
  facing,
  wallColor = 'grey',
  students = [],
  selectedStudentId = null,
  onBoardOpen,
  suppressCallouts = false,
  animate = true,
  occupiedBays,
  onEditWall,
}: RoomStageProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  const { w, h } = useViewport(stageRef)
  const proj = useMemo(() => projectRoom(shell, w, h), [shell, w, h])
  const palette = WALL_PALETTES[wallColor] ?? WALL_PALETTES.grey

  const facingBay = ((Math.round(facing) % shell.bays.length) + shell.bays.length) % shell.bays.length

  /** boardId -> roster row, so plates can carry the same number the roster shows. */
  const studentByBoard = useMemo(() => {
    const map = new Map<string, { student: RoomStudent; index: number }>()
    students.forEach((student, index) => {
      for (const id of student.boardIds) map.set(id, { student, index })
    })
    return map
  }, [students])

  /** Boards bucketed onto the bay they belong to, once per boards/shell change. */
  const boardsByBay = useMemo(() => {
    const buckets: Board[][] = shell.bays.map(() => [])
    for (const board of boards) {
      const idx = bayIndexForBoard(shell.bays, board)
      if (idx >= 0) buckets[idx].push(board)
    }
    return buckets
  }, [boards, shell.bays])

  /**
   * Name plates, one per student per bay, sitting just above that student's
   * topmost sheet — the running-sheet header from a real pin-up.
   */
  const platesByBay = useMemo(() => {
    return shell.bays.map((bay, bayIdx) => {
      const groups = new Map<string, { minX: number; maxX: number; top: number; index: number; name: string }>()
      for (const board of boardsByBay[bayIdx]) {
        const row = studentByBoard.get(board.id)
        if (!row) continue
        const pos = board.position
        if (!pos) continue
        const { widthIn, heightIn } = getBoardSizeInches(board)
        const cx = (pos.x / 100) * bay.widthIn
        const cy = (1 - pos.y / 100) * bay.heightIn
        const g = groups.get(row.student.id)
        const left = cx - widthIn / 2
        const right = cx + widthIn / 2
        const top = cy - heightIn / 2
        if (!g) {
          groups.set(row.student.id, { minX: left, maxX: right, top, index: row.index, name: row.student.name })
        } else {
          g.minX = Math.min(g.minX, left)
          g.maxX = Math.max(g.maxX, right)
          g.top = Math.min(g.top, top)
        }
      }
      const plates: Plate[] = []
      for (const [id, g] of groups) {
        plates.push({
          key: id,
          label: g.name,
          index: String(g.index + 1).padStart(2, '0'),
          leftPx: ((g.minX + g.maxX) / 2) * proj.pxPerIn,
          topPx: Math.max(2, g.top * proj.pxPerIn - PLATE_GAP_IN * proj.pxPerIn - PLATE_H_PX),
          selected: id === selectedStudentId,
        })
      }
      return plates
    })
  }, [shell.bays, boardsByBay, studentByBoard, proj.pxPerIn, selectedStudentId])

  const selectedBoardIds = useMemo(() => {
    if (!selectedStudentId) return null
    const s = students.find((x) => x.id === selectedStudentId)
    return s ? new Set(s.boardIds) : null
  }, [selectedStudentId, students])

  const yawDeg = facing * shell.sliceDeg
  const floorSpan = shell.apothemIn * 2.6 * proj.pxPerIn

  return (
    <div
      ref={stageRef}
      className="absolute inset-0 overflow-hidden"
      style={{
        background: ROOM.background,
        perspective: `${proj.perspectivePx}px`,
        perspectiveOrigin: '50% 50%',
      }}
    >
      <div
        className="absolute left-1/2 top-1/2"
        style={{
          width: 0,
          height: 0,
          transformStyle: 'preserve-3d',
          // translateZ(P) seats the camera at the room's centre; the rotateY is
          // the entire navigation model.
          transform: `translateZ(${proj.perspectivePx}px) rotateY(${yawDeg}deg)`,
          transition: animate ? 'transform 760ms cubic-bezier(0.22, 0.61, 0.36, 1)' : 'none',
          willChange: 'transform',
        }}
      >
        {/* Floor */}
        <div
          className="absolute"
          style={{
            width: floorSpan,
            height: floorSpan,
            background: `radial-gradient(ellipse at 50% 50%, ${ROOM.floor} 0%, #DAD4C6 55%, #CFC8B8 100%)`,
            transform: `translateY(${proj.eyePx}px) rotateX(90deg) translate(-50%, -50%)`,
            backfaceVisibility: 'hidden',
          }}
        />

        {/* Ceiling */}
        <div
          className="absolute"
          style={{
            width: floorSpan,
            height: floorSpan,
            background: `radial-gradient(ellipse at 50% 50%, #FFFFFF 0%, ${palette.trim} 62%, #DBD5C6 100%)`,
            transform: `translateY(${proj.eyePx - proj.heightPx}px) rotateX(-90deg) translate(-50%, -50%)`,
            backfaceVisibility: 'hidden',
          }}
        />

        {shell.bays.map((bay, i) => {
          const isFacing = i === facingBay
          const bayBoards = boardsByBay[i]
          const pinW = bay.widthIn * proj.pxPerIn
          const pinH = bay.heightIn * proj.pxPerIn
          const occupied = occupiedBays?.has(i)

          const editable = isFacing && !bay.blank && !!onEditWall

          return (
            <div
              key={bay.key}
              className="absolute"
              onDoubleClick={editable ? () => onEditWall!(bay) : undefined}
              style={{
                width: proj.faceWidthPx,
                height: proj.heightPx,
                background: palette.face,
                borderLeft: `1px solid ${palette.trim}`,
                borderRight: `1px solid ${palette.trim}`,
                transform: `rotateY(${-i * shell.sliceDeg}deg) translateZ(${-proj.perspectivePx}px) translateY(${proj.wallCenterYPx}px) translate(-50%, -50%)`,
                transformStyle: 'preserve-3d',
                // The bays behind you face away; without this they punch through
                // the room as the shell sweeps.
                backfaceVisibility: 'hidden',
                cursor: editable ? 'pointer' : 'default',
              }}
            >
              {/* Baseboard, so the wall meets the floor rather than floating. */}
              <div
                className="absolute left-0 right-0"
                style={{ bottom: 0, height: Math.max(3, 4 * proj.pxPerIn), background: palette.base }}
              />

              {/* Wall label, drawing-sheet style. */}
              {bay.label && (
                <span
                  className="absolute uppercase whitespace-nowrap pointer-events-none"
                  style={{
                    left: (proj.faceWidthPx - pinW) / 2,
                    top: Math.max(6, proj.heightPx - pinH - 22),
                    fontFamily: MONO_STACK,
                    fontSize: 11,
                    letterSpacing: '0.18em',
                    // No distinct "occupied" color: amber means active/selected
                    // and nothing else. Presence is signalled by the trailing
                    // dot appended to the label text below, not by color.
                    color: ROOM.ink2,
                  }}
                >
                  {bay.label}
                  {occupied ? ' ·' : ''}
                </span>
              )}

              {/* Pin-up surface: the configured wall, standing on the floor. */}
              <div
                className="absolute"
                style={{
                  left: (proj.faceWidthPx - pinW) / 2,
                  bottom: 0,
                  width: pinW,
                  height: pinH,
                  transformStyle: 'flat',
                }}
              >
                {platesByBay[i].map((plate) => (
                  <span
                    key={plate.key}
                    className="absolute flex items-center gap-1.5 whitespace-nowrap pointer-events-none"
                    style={{
                      left: plate.leftPx,
                      top: plate.topPx,
                      height: PLATE_H_PX,
                      transform: 'translateX(-50%)',
                      opacity: selectedBoardIds && !plate.selected ? 0.35 : 1,
                      transition: 'opacity 260ms ease',
                    }}
                  >
                    <span
                      className="tabular-nums"
                      style={{
                        fontFamily: MONO_STACK,
                        fontSize: 10,
                        color: plate.selected ? ROOM.ink : ROOM.hairline,
                      }}
                    >
                      {plate.index}
                    </span>
                    <span
                      style={{
                        fontFamily: SANS_STACK,
                        fontSize: 13,
                        fontWeight: 600,
                        color: ROOM.ink,
                        borderBottom: plate.selected ? `2px solid ${ROOM.amber}` : '2px solid transparent',
                      }}
                    >
                      {plate.label}
                    </span>
                  </span>
                ))}

                {bayBoards.map((board) => (
                  <RoomBoard
                    key={board.localId || board.id}
                    board={board}
                    pxPerIn={proj.pxPerIn}
                    bayWidthIn={bay.widthIn}
                    bayHeightIn={bay.heightIn}
                    onOpen={onBoardOpen}
                    interactive={isFacing}
                    isHighlighted={!!selectedBoardIds?.has(board.id)}
                    isMuted={!!selectedBoardIds && !selectedBoardIds.has(board.id)}
                    suppressCallouts={suppressCallouts}
                  />
                ))}
              </div>

              {/* Bays you are not facing sit in the room's shadow. Depth cue and
                  focus in one, and it costs nothing to composite. */}
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  background: ROOM.ink,
                  opacity: isFacing ? 0 : 0.14,
                  transition: 'opacity 500ms ease',
                }}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
