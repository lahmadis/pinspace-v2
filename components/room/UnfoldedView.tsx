'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pencil, Plus, X } from 'lucide-react'
import type { Board } from '@/types'
import { getBoardSizeInches } from '@/lib/boardDimensions'
import { ROOM, MONO_STACK, SANS_STACK } from '@/lib/room/palette'
import type { RoomStudent } from '@/lib/room/students'
import { cleanDisplayName } from '@/lib/displayName'

interface UnfoldedViewProps {
  boards: Board[]
  wallConfig: { walls: Array<{ width: number; height: number }> }
  students: RoomStudent[]
  selectedStudentId: string | null
  onSelectStudent: (student: RoomStudent) => void
  onBoardClick?: (board: Board) => void

  /* ---- Editing. All optional: without them this view stays exactly what it
     was, a read-only developed surface. ---- */

  /** Whether the viewer may rearrange the wall at all. */
  canEdit?: boolean
  /** Commit a move. Coordinates are normalised -0.5..0.5, matching the 3D
   *  wall-edit path, so both views feed the same updateBoardPosition. */
  onBoardMove?: (
    boardId: string,
    wallIndex: number,
    xNorm: number,
    yNorm: number,
    side: 'front' | 'back',
    /** A held arrow key repeats; the parent folds one run into a single undo. */
    source?: 'drag' | 'nudge' | 'place',
  ) => void
  /** Commit a resize. Absolute inches — board size is wall-independent. */
  onBoardResize?: (boardId: string, widthIn: number, heightIn: number) => void
  onBoardDelete?: (boardId: string) => void
  onUndo?: () => void
  onRedo?: () => void
  /** Boards in the room that aren't on a wall yet, offered by the + button. */
  unplacedBoards?: Board[]
  onPlaceBoard?: (board: Board, wallIndex: number, xNorm: number, yNorm: number) => void
}

/** Pixels per inch. 5 puts a 10ft wall at 600px — readable without zooming. */
const PX_PER_IN = 5
/** Height of the mono title block beneath each sheet. */
const TITLE_BLOCK_H = 34
/** Headroom above the wall band for owner name plates. */
const PLATE_BAND_H = 30
/** A sheet never shrinks below this. Smaller is a mis-drag, not an intent. */
const MIN_BOARD_IN = 6
/** Arrow-key nudge, in inches — one keypress should be visible but not coarse. */
const NUDGE_IN = 1
/** Shift+arrow, for crossing a wall without holding the key down. */
const NUDGE_IN_FAST = 12
/** Below this the gesture was a click, not a drag, so it opens rather than moves. */
const DRAG_SLOP_PX = 4

/** A move in progress. Rendered as a translate; committed on pointer-up. */
interface DragState {
  boardId: string
  fromWall: number
  side: 'front' | 'back'
  startClientX: number
  startClientY: number
  dx: number
  dy: number
  /** False until the pointer passes DRAG_SLOP_PX, which is what separates a
   *  click-to-open from a drag-to-move. */
  moved: boolean
}

/** A resize in progress. Inches, because board size is wall-independent. */
interface ResizeState {
  boardId: string
  startClientX: number
  startWIn: number
  aspect: number
  wIn: number
  hIn: number
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const round2 = (v: number) => Math.round(v * 100) / 100

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
  canEdit = false,
  onBoardMove,
  onBoardResize,
  onBoardDelete,
  onUndo,
  onRedo,
  unplacedBoards = [],
  onPlaceBoard,
}: UnfoldedViewProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const studentAnchors = useRef<Map<string, HTMLElement>>(new Map())

  /* ------------------------------------------------------------------ *
   * Editing
   *
   * Off by default even when allowed. This view's first job is reading a
   * whole studio at once, and a surface where every sheet moves under the
   * pointer is a worse reading surface — so rearranging is a mode you turn
   * on, the same way wall editing is in the 3D room.
   * ------------------------------------------------------------------ */

  const [editing, setEditing] = useState(false)
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [resize, setResize] = useState<ResizeState | null>(null)
  /** Which wall's + picker is open, if any. */
  const [picker, setPicker] = useState<number | null>(null)

  /** Live wall geometry, read at pointer-up to decide which wall a sheet landed on. */
  const panelRefs = useRef<Map<number, HTMLDivElement>>(new Map())

  const canDrag = canEdit && editing && Boolean(onBoardMove)

  // Leaving edit mode drops everything mid-gesture state was holding, so a
  // half-finished drag can't commit after the mode it belonged to is gone.
  useEffect(() => {
    if (editing) return
    setSelectedBoardId(null)
    setDrag(null)
    setResize(null)
    setPicker(null)
  }, [editing])

  // Same when the right to edit is withdrawn under us (permissions change,
  // or the prop flips): the toggle must not stay on with no path to save.
  useEffect(() => {
    if (!canEdit) setEditing(false)
  }, [canEdit])

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

  const wallDims = useMemo(() => {
    const m = new Map<number, { wIn: number; hIn: number }>()
    for (const panel of wallPanels) m.set(panel.wallIndex, { wIn: panel.wIn, hIn: panel.hIn })
    return m
  }, [wallPanels])

  const boardById = useMemo(() => new Map(boards.map((b) => [b.id, b])), [boards])

  /* Mirrors of the gesture state, so the window listeners below can read the
     live values without the effect re-subscribing on every pointermove. */
  const dragRef = useRef<DragState | null>(null)
  const resizeRef = useRef<ResizeState | null>(null)

  /**
   * Which wall a client x-coordinate falls on.
   *
   * Horizontal only. A sheet dragged above the band or below the floor line is
   * still plainly meant for the wall it is over, so vertical position is
   * clamped at commit rather than used to reject the drop. A drop in the fold
   * between two walls snaps to the nearer one for the same reason — cancelling
   * a move the user clearly meant is the worse answer.
   */
  const wallAtClientX = useCallback((clientX: number): number | null => {
    let nearest: { wall: number; distance: number } | null = null
    for (const [wallIndex, el] of panelRefs.current) {
      const r = el.getBoundingClientRect()
      if (clientX >= r.left && clientX <= r.right) return wallIndex
      const distance = clientX < r.left ? r.left - clientX : clientX - r.right
      if (!nearest || distance < nearest.distance) nearest = { wall: wallIndex, distance }
    }
    return nearest ? nearest.wall : null
  }, [])

  /** Move a board to a wall-relative fraction, in the -0.5..0.5 form the 3D path uses. */
  const moveToFraction = useCallback(
    (
      boardId: string,
      wallIndex: number,
      fracX: number,
      fracY: number,
      side: 'front' | 'back',
      source: 'drag' | 'nudge' | 'place' = 'drag',
    ) => {
      onBoardMove?.(boardId, wallIndex, clamp01(fracX) - 0.5, clamp01(fracY) - 0.5, side, source)
    },
    [onBoardMove],
  )

  const commitDrag = useCallback(
    (state: DragState) => {
      const board = boardById.get(state.boardId)
      const fromEl = panelRefs.current.get(state.fromWall)
      const fromDims = wallDims.get(state.fromWall)
      if (!board?.position || !fromEl || !fromDims) return
      const fromRect = fromEl.getBoundingClientRect()

      // Where the sheet's centre ended up, in client coordinates. Taking the
      // centre rather than the pointer is what makes a cross-wall drop match
      // what you see: the sheet lands on the wall it looks like it is over,
      // not on whichever wall the cursor happens to be inside.
      const centreX = fromRect.left + (board.position.x / 100) * fromDims.wIn * PX_PER_IN + state.dx
      const centreY = fromRect.top + (board.position.y / 100) * fromDims.hIn * PX_PER_IN + state.dy

      const toWall = wallAtClientX(centreX)
      if (toWall == null) return
      const toEl = panelRefs.current.get(toWall)
      const toDims = wallDims.get(toWall)
      if (!toEl || !toDims) return
      const toRect = toEl.getBoundingClientRect()

      moveToFraction(
        state.boardId,
        toWall,
        (centreX - toRect.left) / (toDims.wIn * PX_PER_IN),
        (centreY - toRect.top) / (toDims.hIn * PX_PER_IN),
        state.side,
      )
    },
    [boardById, wallDims, wallAtClientX, moveToFraction],
  )

  // Drag: window-level so the gesture survives the pointer leaving the sheet,
  // which it does constantly — a sheet being dragged is by definition moving
  // out from under the cursor's start point.
  useEffect(() => {
    if (!drag) return
    const onMove = (e: PointerEvent) => {
      const st = dragRef.current
      if (!st) return
      const dx = e.clientX - st.startClientX
      const dy = e.clientY - st.startClientY
      const next: DragState = {
        ...st,
        dx,
        dy,
        moved: st.moved || Math.abs(dx) > DRAG_SLOP_PX || Math.abs(dy) > DRAG_SLOP_PX,
      }
      dragRef.current = next
      setDrag(next)
    }
    const onUp = () => {
      const st = dragRef.current
      dragRef.current = null
      setDrag(null)
      // A gesture that never passed the slop threshold was a click. Committing
      // it would write the position the board already has — a pointless round
      // trip that still costs an undo step.
      if (st?.moved) commitDrag(st)
    }
    const onCancel = () => {
      dragRef.current = null
      setDrag(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }
    // Deliberately keyed on the id, not the whole object: the object changes on
    // every pointermove and re-subscribing 60 times a second would be silly.
  }, [drag?.boardId, commitDrag]) // eslint-disable-line react-hooks/exhaustive-deps

  // Resize. Width leads and height follows the sheet's own aspect — a board is
  // a physical sheet, and stretching one to an arbitrary rectangle would mean
  // the drawing on it no longer matches its printed proportions.
  useEffect(() => {
    if (!resize) return
    const onMove = (e: PointerEvent) => {
      const st = resizeRef.current
      if (!st) return
      const wIn = Math.max(MIN_BOARD_IN, st.startWIn + (e.clientX - st.startClientX) / PX_PER_IN)
      const next: ResizeState = { ...st, wIn, hIn: wIn / st.aspect }
      resizeRef.current = next
      setResize(next)
    }
    const onUp = () => {
      const st = resizeRef.current
      resizeRef.current = null
      setResize(null)
      if (st && Math.abs(st.wIn - st.startWIn) >= 0.5) {
        onBoardResize?.(st.boardId, round2(st.wIn), round2(st.hIn))
      }
    }
    const onCancel = () => {
      resizeRef.current = null
      setResize(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }
  }, [resize?.boardId, onBoardResize]) // eslint-disable-line react-hooks/exhaustive-deps

  const scrollToStudent = useCallback((studentId: string) => {
    const el = studentAnchors.current.get(studentId)
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [])

  /**
   * Keyboard: the same commands the 3D room's wall-edit mode answers to.
   *
   * Arrow keys do double duty. With a sheet selected in edit mode they nudge
   * it; otherwise they step through students, which is what they have always
   * done here. Selection is the switch, so neither behaviour is lost.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (target?.isContentEditable) return

      const mod = e.metaKey || e.ctrlKey
      if (editing && mod && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault()
        // Shift+Z is redo on macOS, where there is no Ctrl+Y.
        if (e.shiftKey) onRedo?.()
        else onUndo?.()
        return
      }
      if (editing && mod && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault()
        onRedo?.()
        return
      }

      if (editing && selectedBoardId && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault()
        onBoardDelete?.(selectedBoardId)
        setSelectedBoardId(null)
        return
      }

      if (e.key === 'Escape') {
        setPicker(null)
        setSelectedBoardId(null)
        return
      }

      const isArrow = e.key.startsWith('Arrow')
      if (!isArrow) return

      // Nudge the selected sheet. Inches converted to a wall fraction, so the
      // step is the same physical distance on a 30ft wall as on a 10ft one.
      if (editing && selectedBoardId && onBoardMove) {
        const board = boardById.get(selectedBoardId)
        const wallIndex = board?.position?.wallIndex
        const dims = wallIndex != null ? wallDims.get(wallIndex) : undefined
        if (board?.position && wallIndex != null && dims) {
          e.preventDefault()
          const step = e.shiftKey ? NUDGE_IN_FAST : NUDGE_IN
          const dxIn = (e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0)
          const dyIn = (e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0)
          moveToFraction(
            selectedBoardId,
            wallIndex,
            board.position.x / 100 + dxIn / dims.wIn,
            board.position.y / 100 + dyIn / dims.hIn,
            (board.position.side as 'front' | 'back') || 'front',
            'nudge',
          )
          return
        }
      }

      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
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
  }, [
    students, selectedStudentId, onSelectStudent, scrollToStudent,
    editing, selectedBoardId, onUndo, onRedo, onBoardDelete, onBoardMove,
    boardById, wallDims, moveToFraction,
  ])

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
          {/* The editing shortcuts live in the bottom-left panel now, beside
              the toggle that turns them on. Repeating them here would put the
              same text in two places, and this end of the band is the half the
              breadcrumb covers anyway. */}
          ← → to step students
        </span>
      </div>

      {/* Bottom-left, matching the Plan view's "Edit room" panel.
          Not in the header band above: that band is the top of a
          `fixed inset-0 z-20` container, and BOTH its ends are painted over by
          z-40 chrome — the breadcrumb at top-4 left-4 and Share at top-4
          right-4. A control there is not just cramped, it is unclickable.
          Bottom-left is the one corner nothing else claims (the revision strip
          is bottom-centre and this container is already inset above it). */}
      {canEdit && (
        <div
          style={{
            position: 'absolute',
            bottom: 16,
            left: 16,
            zIndex: 2,
            background: ROOM.wall,
            border: `1px solid ${editing ? ROOM.accent : ROOM.hairline}`,
            borderRadius: 12,
            boxShadow: '0 4px 16px rgba(22,24,29,0.10)',
            overflow: 'hidden',
          }}
        >
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="flex items-center gap-2 px-3 py-2.5 text-[11px] uppercase tracking-[0.14em] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3B6EF6]/40"
            style={{
              fontFamily: MONO_STACK,
              fontWeight: 700,
              color: editing ? '#FFFFFF' : ROOM.ink,
              background: editing ? ROOM.accent : 'transparent',
              cursor: 'pointer',
              border: 'none',
            }}
          >
            <Pencil className="w-3.5 h-3.5" />
            {editing ? 'Editing walls' : 'Edit layout'}
          </button>
          {editing && (
            <p
              className="px-3 pb-2.5 pt-2"
              style={{
                fontFamily: MONO_STACK,
                fontSize: 10,
                lineHeight: 1.5,
                color: ROOM.ink2,
                maxWidth: 210,
                borderTop: `1px solid ${ROOM.hairline}`,
              }}
            >
              Drag a sheet to move it, even onto another wall. Arrows nudge,
              Del deletes, ⌘Z undoes.
            </p>
          )}
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-x-auto overflow-y-auto">
        <div className="flex items-end" style={{ padding: `${PLATE_BAND_H + 24}px 32px ${TITLE_BLOCK_H + 40}px` }}>
          {wallPanels.map((panel, i) => (
            <div key={panel.wallIndex} className="flex items-end shrink-0">
              <div
                ref={(el) => {
                  if (el) panelRefs.current.set(panel.wallIndex, el)
                  else panelRefs.current.delete(panel.wallIndex)
                }}
                className="relative shrink-0"
                // Clicking bare wall clears the selection, so the delete key
                // never acts on a sheet the user stopped thinking about.
                onPointerDown={(e) => {
                  if (editing && e.target === e.currentTarget) setSelectedBoardId(null)
                }}
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
                  style={{ fontFamily: MONO_STACK, color: ROOM.ink2, bottom: -TITLE_BLOCK_H + 6 }}
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
                        else studentAnchors.current.delete(group.student.id)
                      }}
                      onClick={() => onSelectStudent(group.student)}
                      className="absolute text-center truncate px-1"
                      style={{
                        left: group.minX * PX_PER_IN,
                        width: Math.max((group.maxX - group.minX) * PX_PER_IN, 60),
                        top: -PLATE_BAND_H,
                        color: ROOM.ink,
                        fontFamily: SANS_STACK,
                        fontWeight: 700,
                        fontSize: 13,
                        borderBottom: isSelected ? `3px solid ${ROOM.accent}` : '3px solid transparent',
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
                  const side: 'front' | 'back' = isBack ? 'back' : 'front'

                  // Live gesture values win over the stored ones, so a drag or
                  // resize is drawn as it happens rather than after it saves.
                  const isDragging = drag?.boardId === board.id && drag.moved
                  const sizing = resize?.boardId === board.id ? resize : null
                  const w = (sizing ? sizing.wIn : widthIn) * PX_PER_IN
                  const h = (sizing ? sizing.hIn : heightIn) * PX_PER_IN
                  const isPicked = editing && selectedBoardId === board.id
                  return (
                    <div
                      key={board.id}
                      className="absolute"
                      style={{
                        left: (board.position.x / 100) * panel.wIn * PX_PER_IN - w / 2,
                        top: (board.position.y / 100) * panel.hIn * PX_PER_IN - h / 2,
                        width: w,
                        transform: isDragging ? `translate(${drag.dx}px, ${drag.dy}px)` : undefined,
                        // Above its neighbours while moving, and above the wall
                        // it may be crossing into.
                        zIndex: isDragging ? 40 : isPicked ? 20 : undefined,
                        opacity: isDragging ? 0.85 : undefined,
                      }}
                    >
                      <button
                        onPointerDown={(e) => {
                          if (!editing) return
                          if (e.button !== 0) return
                          setSelectedBoardId(board.id)
                          setPicker(null)
                          if (!canDrag) return
                          const start: DragState = {
                            boardId: board.id,
                            fromWall: panel.wallIndex,
                            side,
                            startClientX: e.clientX,
                            startClientY: e.clientY,
                            dx: 0,
                            dy: 0,
                            moved: false,
                          }
                          dragRef.current = start
                          setDrag(start)
                        }}
                        onClick={() => {
                          // In edit mode a click selects; opening the lightbox
                          // there would fight the drag gesture that shares the
                          // same press.
                          if (!editing) onBoardClick?.(board)
                        }}
                        className="block w-full"
                        style={{
                          height: h,
                          outline: isPicked
                            ? `2px solid ${ROOM.accent}`
                            : isSelected
                              ? `2px solid ${ROOM.accent}`
                              : `1px solid ${ROOM.hairline}`,
                          outlineOffset: isPicked || isSelected ? 2 : 0,
                          background: '#FFFFFF',
                          cursor: editing ? (isDragging ? 'grabbing' : 'grab') : 'pointer',
                          touchAction: editing ? 'none' : undefined,
                        }}
                        title={board.title}
                      >
                        {/* Plain img, not next/image: board URLs are Supabase
                            storage hosts that would each need remotePatterns in
                            next.config.js, which is out of scope here. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
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
                          style={{ color: ROOM.ink2, borderLeft: `1px solid ${ROOM.hairline}` }}
                        >
                          {isBack ? 'B' : 'A'}-{String(panel.boards.indexOf(board) + 1).padStart(2, '0')}
                        </span>
                        <span
                          className="px-1 py-0.5 text-[9px]"
                          style={{ color: ROOM.ink, opacity: 0.65, borderLeft: `1px solid ${ROOM.hairline}` }}
                        >
                          {sheetSize(sizing ? sizing.wIn : widthIn, sizing ? sizing.hIn : heightIn)}
                        </span>
                      </div>

                      {isPicked && !isDragging && (
                        <>
                          {onBoardResize && (
                            <div
                              onPointerDown={(e) => {
                                e.stopPropagation()
                                if (e.button !== 0) return
                                const start: ResizeState = {
                                  boardId: board.id,
                                  startClientX: e.clientX,
                                  startWIn: widthIn,
                                  aspect: widthIn / heightIn,
                                  wIn: widthIn,
                                  hIn: heightIn,
                                }
                                resizeRef.current = start
                                setResize(start)
                              }}
                              title="Drag to resize"
                              className="absolute"
                              style={{
                                right: -6,
                                top: h - 6,
                                width: 12,
                                height: 12,
                                background: ROOM.accent,
                                cursor: 'ew-resize',
                                touchAction: 'none',
                              }}
                            />
                          )}
                          {onBoardDelete && (
                            <button
                              type="button"
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation()
                                onBoardDelete(board.id)
                                setSelectedBoardId(null)
                              }}
                              // Not "remove from wall". This is the same
                              // delete the 3D room uses: it destroys the row
                              // AND the image bytes in storage, and the board
                              // does not come back in the + picker. Only the
                              // few-second undo window can retrieve it.
                              title="Delete this board permanently (undo window is a few seconds)"
                              className="absolute flex items-center justify-center"
                              style={{
                                right: -8,
                                top: -8,
                                width: 16,
                                height: 16,
                                background: ROOM.ink,
                                color: '#FFFFFF',
                              }}
                            >
                              <X className="w-2.5 h-2.5" />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )
                })}

                {/* Add a sheet that isn't on a wall yet. Sits on the wall it
                    will land on, so there is no separate drop target to aim at. */}
                {editing && onPlaceBoard && (
                  <div className="absolute" style={{ left: 8, top: 8, zIndex: 30 }}>
                    <button
                      type="button"
                      onClick={() => setPicker((v) => (v === panel.wallIndex ? null : panel.wallIndex))}
                      title="Add a board to this wall"
                      className="flex items-center gap-1 px-2 py-1 text-[10px] uppercase tracking-[0.12em]"
                      style={{
                        fontFamily: MONO_STACK,
                        color: ROOM.ink,
                        background: '#FFFFFF',
                        border: `1px solid ${ROOM.hairline}`,
                      }}
                    >
                      <Plus className="w-3 h-3" />
                      Add
                    </button>

                    {picker === panel.wallIndex && (
                      <div
                        className="mt-1 max-h-64 overflow-y-auto"
                        style={{ width: 200, background: '#FFFFFF', border: `1px solid ${ROOM.ink}` }}
                      >
                        {unplacedBoards.length === 0 ? (
                          <p
                            className="px-2 py-2 text-[10px]"
                            style={{ fontFamily: MONO_STACK, color: ROOM.ink2 }}
                          >
                            Nothing to add — every board in this room is
                            already on a wall. Deleting one does not put it
                            back here; it is gone.
                          </p>
                        ) : (
                          unplacedBoards.map((b) => (
                            <button
                              key={b.id}
                              type="button"
                              onClick={() => {
                                // Centre of the wall: a sheet that appears
                                // somewhere obvious is easier to then drag than
                                // one tucked into a corner.
                                onPlaceBoard(b, panel.wallIndex, 0, 0)
                                setPicker(null)
                                setSelectedBoardId(b.id)
                              }}
                              className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-black/5"
                            >
                              {/* Plain img for the same reason as the sheets above. */}
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={b.thumbnailUrl || b.fullImageUrl}
                                alt=""
                                className="w-7 h-7 object-cover shrink-0"
                                style={{ border: `1px solid ${ROOM.hairline}` }}
                              />
                              <span
                                className="flex-1 min-w-0 truncate text-[10px]"
                                style={{ fontFamily: MONO_STACK, color: ROOM.ink }}
                              >
                                {cleanDisplayName(b.title) || 'Untitled'}
                              </span>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}
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
