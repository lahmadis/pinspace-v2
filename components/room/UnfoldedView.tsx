'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { Board } from '@/types'
import { getBoardSizeInches } from '@/lib/boardDimensions'
import { ROOM, MONO_STACK } from '@/lib/room/palette'
import type { RoomStudent } from '@/lib/room/students'
import { cleanDisplayName } from '@/lib/displayName'

interface UnfoldedViewProps {
  boards: Board[]
  wallConfig: { walls: Array<{ width: number; height: number }> }
  students: RoomStudent[]
  selectedStudentId: string | null
  onSelectStudent: (student: RoomStudent) => void
  onBoardClick?: (board: Board) => void
}

/** Pixels per inch. 5 puts a 10ft wall at 600px — readable without zooming. */
const PX_PER_IN = 5
/** Height of the mono title block beneath each sheet. */
const TITLE_BLOCK_H = 34
/** Headroom above the wall band for owner name plates. */
const PLATE_BAND_H = 30

/** Nearest named sheet size, else the literal dimensions. */
function sheetSize(widthIn: number, heightIn: number): string {
  const w = Math.round(Math.max(widthIn, heightIn))
  const h = Math.round(Math.min(widthIn, heightIn))
  const named: Record<string, string> = {
    '12x9': 'A', '17x11': 'B', '22x17': 'C', '34x22': 'D', '44x34': 'E',
    '36x24': 'ARCH D', '48x36': 'ARCH E',
  }
  return named[`${w}x${h}`] ?? `${w}×${h}"`
}

/**
 * Developed surface drawing: every wall unrolled into one continuous horizontal
 * band, in wall order, divided by dashed break lines.
 *
 * Pure DOM by design — no Canvas, no WebGL. Boards are absolutely positioned
 * from the same normalised coordinates the 3D room uses, so a sheet sits in the
 * same relative place on the wall in both views.
 */
export default function UnfoldedView({
  boards,
  wallConfig,
  students,
  selectedStudentId,
  onSelectStudent,
  onBoardClick,
}: UnfoldedViewProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const studentAnchors = useRef<Map<string, HTMLElement>>(new Map())

  const maxWallHeightIn = useMemo(
    () => Math.max(...wallConfig.walls.map((w) => w.height * 12), 12),
    [wallConfig],
  )
  const bandHeight = maxWallHeightIn * PX_PER_IN

  const studentByBoardId = useMemo(() => {
    const map = new Map<string, RoomStudent>()
    for (const s of students) for (const id of s.boardIds) map.set(id, s)
    return map
  }, [students])

  /** Per wall: its boards, plus each student's bounding box for the name plate. */
  const wallPanels = useMemo(() => {
    return wallConfig.walls.map((wall, wallIndex) => {
      const wIn = wall.width * 12
      const hIn = wall.height * 12
      const onWall = boards.filter((b) => b.position?.wallIndex === wallIndex)

      const groups = new Map<string, { student: RoomStudent; minX: number; maxX: number }>()
      for (const board of onWall) {
        if (!board.position) continue
        const student = studentByBoardId.get(board.id)
        if (!student) continue
        const { widthIn } = getBoardSizeInches(board)
        const cx = (board.position.x / 100) * wIn
        const half = (widthIn || 0) / 2
        const existing = groups.get(student.id)
        if (existing) {
          existing.minX = Math.min(existing.minX, cx - half)
          existing.maxX = Math.max(existing.maxX, cx + half)
        } else {
          groups.set(student.id, { student, minX: cx - half, maxX: cx + half })
        }
      }

      return { wallIndex, wIn, hIn, boards: onWall, groups: Array.from(groups.values()) }
    })
  }, [boards, wallConfig, studentByBoardId])

  const scrollToStudent = useCallback((studentId: string) => {
    const el = studentAnchors.current.get(studentId)
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [])

  // Arrow keys step between students, matching the roster's order.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      const target = e.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (students.length === 0) return
      e.preventDefault()
      const current = students.findIndex((s) => s.id === selectedStudentId)
      const step = e.key === 'ArrowRight' ? 1 : -1
      const next = current === -1
        ? (step === 1 ? 0 : students.length - 1)
        : (current + step + students.length) % students.length
      onSelectStudent(students[next])
      scrollToStudent(students[next].id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [students, selectedStudentId, onSelectStudent, scrollToStudent])

  useEffect(() => {
    if (selectedStudentId) scrollToStudent(selectedStudentId)
  }, [selectedStudentId, scrollToStudent])

  return (
    <div className="absolute inset-0 flex flex-col" style={{ background: ROOM.background }}>
      <div
        className="shrink-0 px-5 py-2 flex items-center gap-3"
        style={{ borderBottom: `1px solid ${ROOM.hairline}` }}
      >
        <span className="text-[10px] uppercase tracking-[0.2em]" style={{ fontFamily: MONO_STACK, color: ROOM.ink }}>
          Developed Surface · {wallConfig.walls.length} walls
        </span>
        <span className="text-[10px] tracking-[0.14em] opacity-60" style={{ fontFamily: MONO_STACK, color: ROOM.ink }}>
          ← → to step students
        </span>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-x-auto overflow-y-auto">
        <div className="flex items-end" style={{ padding: `${PLATE_BAND_H + 24}px 32px ${TITLE_BLOCK_H + 40}px` }}>
          {wallPanels.map((panel, i) => (
            <div key={panel.wallIndex} className="flex items-end shrink-0">
              <div
                className="relative shrink-0"
                style={{
                  width: panel.wIn * PX_PER_IN,
                  height: bandHeight,
                  background: ROOM.wall,
                  borderBottom: `2px solid ${ROOM.ink}`,
                }}
              >
                {/* Wall tag, mono, sitting on the floor line. */}
                <span
                  className="absolute left-0 text-[10px] uppercase tracking-[0.18em]"
                  style={{ fontFamily: MONO_STACK, color: ROOM.green, bottom: -TITLE_BLOCK_H + 6 }}
                >
                  Wall {String(panel.wallIndex + 1).padStart(2, '0')} · {panel.wIn / 12}′ × {panel.hIn / 12}′
                </span>

                {/* Owner name plates above each student's run of sheets. */}
                {panel.groups.map((group) => {
                  const isSelected = group.student.id === selectedStudentId
                  return (
                    <button
                      key={group.student.id}
                      ref={(el) => {
                        if (el) studentAnchors.current.set(group.student.id, el)
                      }}
                      onClick={() => onSelectStudent(group.student)}
                      className="absolute text-center truncate px-1"
                      style={{
                        left: group.minX * PX_PER_IN,
                        width: Math.max((group.maxX - group.minX) * PX_PER_IN, 60),
                        top: -PLATE_BAND_H,
                        color: ROOM.green,
                        fontWeight: 700,
                        fontSize: 13,
                        borderBottom: isSelected ? `3px solid ${ROOM.yellow}` : '3px solid transparent',
                      }}
                    >
                      {group.student.name}
                    </button>
                  )
                })}

                {panel.boards.map((board) => {
                  if (!board.position) return null
                  const { widthIn, heightIn } = getBoardSizeInches(board)
                  if (!widthIn || !heightIn) return null
                  const student = studentByBoardId.get(board.id)
                  const isSelected = student != null && student.id === selectedStudentId
                  const isBack = (board.position.side || 'front') === 'back'
                  const w = widthIn * PX_PER_IN
                  const h = heightIn * PX_PER_IN
                  return (
                    <div
                      key={board.id}
                      className="absolute"
                      style={{
                        left: (board.position.x / 100) * panel.wIn * PX_PER_IN - w / 2,
                        top: (board.position.y / 100) * panel.hIn * PX_PER_IN - h / 2,
                        width: w,
                      }}
                    >
                      <button
                        onClick={() => onBoardClick?.(board)}
                        className="block w-full"
                        style={{
                          height: h,
                          outline: isSelected ? `2px solid ${ROOM.yellow}` : `1px solid ${ROOM.hairline}`,
                          outlineOffset: isSelected ? 2 : 0,
                          background: '#FFFFFF',
                        }}
                        title={board.title}
                      >
                        {/* Plain img, not next/image: board URLs are Supabase
                            storage hosts that would each need remotePatterns in
                            next.config.js, which is out of scope here. */}
                        <img
                          src={board.thumbnailUrl || board.fullImageUrl}
                          alt={board.title || 'Board'}
                          className="w-full h-full object-contain"
                          loading="lazy"
                          draggable={false}
                        />
                      </button>
                      {/* Title block: drawing type, sheet number, sheet size. */}
                      <div
                        className="flex items-stretch"
                        style={{ height: TITLE_BLOCK_H, borderTop: `1px solid ${ROOM.ink}`, fontFamily: MONO_STACK }}
                      >
                        <span
                          className="flex-1 min-w-0 truncate px-1 py-0.5 text-[9px] uppercase tracking-[0.1em]"
                          style={{ color: ROOM.ink }}
                        >
                          {cleanDisplayName(board.title) || 'Sheet'}
                        </span>
                        <span
                          className="px-1 py-0.5 text-[9px] tabular-nums"
                          style={{ color: ROOM.green, borderLeft: `1px solid ${ROOM.hairline}` }}
                        >
                          {isBack ? 'B' : 'A'}-{String(panel.boards.indexOf(board) + 1).padStart(2, '0')}
                        </span>
                        <span
                          className="px-1 py-0.5 text-[9px]"
                          style={{ color: ROOM.ink, opacity: 0.65, borderLeft: `1px solid ${ROOM.hairline}` }}
                        >
                          {sheetSize(widthIn, heightIn)}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Dashed break line between walls — the fold in the developed surface. */}
              {i < wallPanels.length - 1 && (
                <div
                  className="shrink-0 self-stretch"
                  style={{ width: 36, borderLeft: `2px dashed ${ROOM.hairline}`, marginLeft: 17 }}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
