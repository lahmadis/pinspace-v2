'use client'

import { useMemo } from 'react'
import type { Board } from '@/types'
import { ROOM, MONO_STACK, SANS_STACK } from '@/lib/room/palette'
import type { RoomStudent } from '@/lib/room/students'

interface TwoDViewProps {
  boards: Board[]
  students: RoomStudent[]
  /** When set, show that person's sheets; otherwise show everyone. */
  selectedStudentId: string | null
  onSelectStudent: (student: RoomStudent) => void
  /** Leave the person view and go back to the people grid. */
  onClearSelection: () => void
  /** Opens the full-screen lightbox, which carries its own prev/next. */
  onBoardClick?: (board: Board) => void
}

/** Cover thumbnails stacked on a person card. */
const COVER_COUNT = 3

function sheetLabel(board: Board, index: number): string {
  const title = board.title?.trim()
  if (title) return title
  return `Sheet ${String(index + 1).padStart(2, '0')}`
}

/**
 * The room's work as a flat 2D archive, browsable by person — the counterpart to
 * walking the 3D room, for when you just want to read someone's sheets without
 * finding their wall first.
 *
 * Two levels: a grid of people, then that person's contact sheet. Clicking a
 * sheet hands off to the existing LightboxModal rather than reimplementing a
 * viewer, so callouts, tracing and arrow navigation all behave exactly as they
 * do everywhere else in the app.
 *
 * Grouping comes from `deriveRoomStudents`, the same derivation the roster panel
 * and the 3D name plates use, so "everyone" means the same set of people in
 * every surface — boards whose owner can't be resolved are dropped there and so
 * are absent here too.
 */
export default function TwoDView({
  boards,
  students,
  selectedStudentId,
  onSelectStudent,
  onClearSelection,
  onBoardClick,
}: TwoDViewProps) {
  const boardsById = useMemo(() => {
    const map = new Map<string, Board>()
    for (const b of boards) map.set(b.id, b)
    return map
  }, [boards])

  const selected = useMemo(
    () => students.find((s) => s.id === selectedStudentId) ?? null,
    [students, selectedStudentId],
  )

  /**
   * A person's boards, in the room's own board order rather than the order their
   * ids happen to sit in — so the archive reads the same way the sidebar and the
   * lightbox do. Ids with no matching board are dropped (a board can be deleted
   * between derivation and render).
   */
  const selectedBoards = useMemo(() => {
    if (!selected) return []
    const ids = new Set(selected.boardIds)
    return boards.filter((b) => ids.has(b.id))
  }, [selected, boards])

  const headerStyle = { fontFamily: MONO_STACK, color: ROOM.ink2 } as const

  return (
    <div className="w-full h-full overflow-y-auto" style={{ background: ROOM.background }}>
      <div className="max-w-6xl mx-auto px-6 py-8">
        {selected ? (
          <>
            <button
              type="button"
              onClick={onClearSelection}
              className="flex items-center gap-2 mb-6 text-[10px] uppercase tracking-[0.18em] hover:opacity-70 transition-opacity"
              style={headerStyle}
            >
              <span aria-hidden>←</span> Back to everyone
            </button>

            <header className="flex items-center gap-3 mb-6">
              <span
                className="w-11 h-11 shrink-0 rounded-full flex items-center justify-center text-[15px] font-bold"
                style={{ background: ROOM.chip, color: ROOM.ink, fontFamily: SANS_STACK }}
                aria-hidden
              >
                {selected.initials}
              </span>
              <div className="min-w-0">
                <h2
                  className="text-[20px] font-semibold truncate"
                  style={{ color: ROOM.ink, fontFamily: SANS_STACK }}
                >
                  {selected.name}
                </h2>
                <p className="text-[10px] uppercase tracking-[0.14em]" style={headerStyle}>
                  {selected.boardCount} sheet{selected.boardCount === 1 ? '' : 's'}
                  {selected.calloutCount > 0 && ` · ${selected.calloutCount} callout${selected.calloutCount === 1 ? '' : 's'}`}
                </p>
              </div>
            </header>

            <div className="grid gap-5 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
              {selectedBoards.map((board, i) => (
                <button
                  key={board.id}
                  type="button"
                  onClick={() => onBoardClick?.(board)}
                  className="group text-left"
                >
                  <div
                    className="relative w-full aspect-[4/3] rounded-lg overflow-hidden flex items-center justify-center transition-shadow group-hover:shadow-lg"
                    style={{ background: ROOM.wall, border: `1px solid ${ROOM.hairline}` }}
                  >
                    {board.thumbnailUrl || board.fullImageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={board.thumbnailUrl || board.fullImageUrl}
                        alt={sheetLabel(board, i)}
                        loading="lazy"
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <span className="text-[10px] uppercase tracking-[0.14em]" style={headerStyle}>
                        No preview
                      </span>
                    )}
                    {(board.calloutCount ?? 0) > 0 && (
                      <span
                        className="absolute top-2 right-2 text-[10px] px-1.5 py-0.5 rounded-full tabular-nums"
                        style={{ fontFamily: MONO_STACK, background: ROOM.accent, color: ROOM.wall }}
                        title={`${board.calloutCount} callout${board.calloutCount === 1 ? '' : 's'}`}
                      >
                        {board.calloutCount}
                      </span>
                    )}
                  </div>
                  <p
                    className="mt-2 text-[12px] truncate"
                    style={{ color: ROOM.ink, fontFamily: SANS_STACK }}
                  >
                    {sheetLabel(board, i)}
                  </p>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <p className="text-[10px] uppercase tracking-[0.18em] mb-6" style={headerStyle}>
              {students.length} {students.length === 1 ? 'person' : 'people'} · click a name to read their sheets
            </p>

            {students.length === 0 ? (
              <p className="text-[13px]" style={{ color: ROOM.ink2, fontFamily: SANS_STACK }}>
                Nothing pinned up yet.
              </p>
            ) : (
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                {students.map((student) => {
                  const covers = student.boardIds
                    .map((id) => boardsById.get(id))
                    .filter((b): b is Board => Boolean(b))
                    .slice(0, COVER_COUNT)
                  return (
                    <button
                      key={student.id}
                      type="button"
                      onClick={() => onSelectStudent(student)}
                      className="text-left rounded-xl overflow-hidden transition-shadow hover:shadow-lg"
                      style={{ background: ROOM.wall, border: `1px solid ${ROOM.hairline}` }}
                    >
                      {/* Cover strip: a glance at what's inside, so the grid reads
                          as work rather than as a contact list. */}
                      <div className="flex gap-px" style={{ background: ROOM.hairline }}>
                        {covers.length > 0 ? (
                          covers.map((board) => (
                            <div
                              key={board.id}
                              className="flex-1 aspect-[4/3] overflow-hidden"
                              style={{ background: ROOM.background }}
                            >
                              {board.thumbnailUrl || board.fullImageUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={board.thumbnailUrl || board.fullImageUrl}
                                  alt=""
                                  loading="lazy"
                                  className="w-full h-full object-cover"
                                />
                              ) : null}
                            </div>
                          ))
                        ) : (
                          <div className="flex-1 aspect-[12/3]" style={{ background: ROOM.background }} />
                        )}
                      </div>

                      <div className="flex items-center gap-2.5 px-3 py-3">
                        <span
                          className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-[11px] font-bold"
                          style={{ background: ROOM.chip, color: ROOM.ink, fontFamily: SANS_STACK }}
                          aria-hidden
                        >
                          {student.initials}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span
                            className="block truncate text-[14px] font-semibold"
                            style={{ color: ROOM.ink, fontFamily: SANS_STACK }}
                          >
                            {student.name}
                          </span>
                          <span
                            className="block text-[9px] uppercase tracking-[0.12em]"
                            style={{ fontFamily: MONO_STACK, color: ROOM.ink2 }}
                          >
                            {student.boardCount} sheet{student.boardCount === 1 ? '' : 's'}
                          </span>
                        </span>
                        {student.calloutCount > 0 && (
                          <span
                            className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full tabular-nums"
                            style={{ fontFamily: MONO_STACK, background: ROOM.accent, color: ROOM.wall }}
                            title={`${student.calloutCount} callout${student.calloutCount === 1 ? '' : 's'}`}
                          >
                            {student.calloutCount}
                          </span>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
