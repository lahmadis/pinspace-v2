'use client'

import { useMemo, useRef, useState } from 'react'
import { Pencil } from 'lucide-react'
import type { Board } from '@/types'
import { ROOM, MONO_STACK, SANS_STACK } from '@/lib/room/palette'
import type { RoomStudent } from '@/lib/room/students'
import SortableBoardGrid from './SortableBoardGrid'

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
  /**
   * Board ids for the whole room in slideshow order. A person's sheets are a
   * SUBSET of that order, and the reorder API addresses room positions, so a
   * drag here can't be resolved from the visible list alone.
   */
  globalOrderIds?: readonly string[]
  /** Off unless the viewer may reorder the room's slideshow. */
  canReorder?: boolean
  onReorder?: (boardId: string, targetPosition: number) => Promise<boolean | void>
  /**
   * Off unless the viewer may change who work is credited to — studio owner or
   * platform admin. Read-only surfaces (view mode, guest crit) leave it off.
   */
  canRenameStudent?: boolean
  /**
   * Relabel every sheet this person has. Resolving `ok: false` rolls the header
   * back to the name it had; `error` is shown beside it, because the two ways
   * this fails are both worth reading — the name was rejected as a placeholder,
   * or you aren't allowed to change it.
   */
  onRenameStudent?: (
    student: RoomStudent,
    name: string,
  ) => Promise<{ ok: boolean; error?: string }>
}

/** Cover thumbnails stacked on a person card. */
const COVER_COUNT = 3

/** Matches the server's own cap (app/api/boards/attribution). */
const NAME_MAX_LENGTH = 80

/**
 * The person's name, click-to-edit.
 *
 * Sits above their sheets rather than on each card because a name here belongs
 * to the PERSON, not to one sheet: deriveRoomStudents groups by owner id where
 * there is one, so relabelling a single board would leave it in this same group
 * under a name the group doesn't show. Renaming the person writes every sheet
 * they have, which is the only version of this that stays consistent. To
 * re-credit one individual sheet, open it and edit the author in the lightbox.
 */
function EditableStudentName({
  student,
  onRename,
}: {
  student: RoomStudent
  onRename: (student: RoomStudent, name: string) => Promise<{ ok: boolean; error?: string }>
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(student.name)
  const [saving, setSaving] = useState(false)
  /**
   * The optimistic name, plus the derived name it was typed over.
   *
   * The optimistic half is what keeps the header from snapping back to the old
   * name for the length of the parent's refetch — without it the rename reads
   * as having failed. `basedOn` is what lets it expire: the moment the derived
   * name moves off the value we replaced, the server has spoken and the local
   * guess is stale. That covers both the ordinary case (the refetch lands with
   * our new name) and the awkward one (someone else renamed the same person
   * from another session, and their name must win over our cached guess).
   *
   * Cleared during render rather than in an effect — this is state that has to
   * be adjusted when props change, which is exactly the case React prescribes
   * this pattern for, and an effect would paint the stale name for one frame.
   */
  const [pending, setPending] = useState<{ name: string; basedOn: string } | null>(null)
  if (pending && pending.basedOn !== student.name) setPending(null)

  /**
   * Escape sets this so the blur it causes doesn't commit the draft anyway.
   * Blur-commits-on-Escape is the classic form of this bug: the key handler
   * cancels, then the input loses focus and saves what was just cancelled.
   */
  const abandonedRef = useRef(false)
  const inFlightRef = useRef(false)
  const [error, setError] = useState<string | null>(null)

  const displayed = pending?.name ?? student.name

  const commit = async () => {
    if (inFlightRef.current) return
    if (abandonedRef.current) {
      abandonedRef.current = false
      setEditing(false)
      return
    }
    const next = value.trim()
    if (!next || next === displayed) {
      setEditing(false)
      return
    }
    inFlightRef.current = true
    setSaving(true)
    setError(null)
    setPending({ name: next, basedOn: student.name })
    setEditing(false)
    try {
      const result = await onRename(student, next)
      if (!result.ok) {
        setPending(null)
        setError(result.error || "That name couldn't be saved.")
      }
    } catch {
      setPending(null)
      setError("That name couldn't be saved.")
    } finally {
      inFlightRef.current = false
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <input
        type="text"
        value={value}
        maxLength={NAME_MAX_LENGTH}
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            abandonedRef.current = true
            setEditing(false)
          }
        }}
        onBlur={commit}
        aria-label="Name of the person who uploaded these sheets"
        className="text-[20px] font-semibold w-full max-w-xs rounded-md px-2 py-0.5 -ml-2 focus:outline-none"
        style={{
          color: ROOM.ink,
          fontFamily: SANS_STACK,
          background: ROOM.wall,
          border: `1px solid ${ROOM.accent}`,
        }}
      />
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          abandonedRef.current = false
          setError(null)
          setValue(displayed)
          setEditing(true)
        }}
        title="Rename the person who uploaded these sheets"
        className="group/name flex items-center gap-1.5 max-w-full text-left rounded-md px-2 py-0.5 -ml-2 transition-colors hover:bg-black/[0.04]"
      >
        <span
          className="text-[20px] font-semibold truncate"
          style={{ color: ROOM.ink, fontFamily: SANS_STACK }}
        >
          {displayed}
        </span>
        {saving ? (
          <span
            className="w-3 h-3 shrink-0 rounded-full border animate-spin"
            style={{ borderColor: ROOM.hairline, borderTopColor: ROOM.accent }}
            aria-hidden
          />
        ) : (
          <Pencil
            className="w-3.5 h-3.5 shrink-0 opacity-0 group-hover/name:opacity-60 transition-opacity"
            style={{ color: ROOM.ink2 }}
            aria-hidden
          />
        )}
      </button>
      {error && (
        // Stays until the next edit rather than timing out: the name has
        // already snapped back, so this is the only thing saying why.
        <p role="alert" className="text-[11px] mt-0.5" style={{ color: ROOM.redline, fontFamily: SANS_STACK }}>
          {error}
        </p>
      )}
    </>
  )
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
  globalOrderIds,
  canReorder = false,
  onReorder,
  canRenameStudent = false,
  onRenameStudent,
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
                {canRenameStudent && onRenameStudent ? (
                  // Keyed on the person so switching people remounts it —
                  // cheaper than an effect that resets the draft, and it can't
                  // leak one person's half-typed name onto the next.
                  <EditableStudentName
                    key={selected.id}
                    student={selected}
                    onRename={onRenameStudent}
                  />
                ) : (
                  <h2
                    className="text-[20px] font-semibold truncate"
                    style={{ color: ROOM.ink, fontFamily: SANS_STACK }}
                  >
                    {selected.name}
                  </h2>
                )}
                <p className="text-[10px] uppercase tracking-[0.14em]" style={headerStyle}>
                  {selected.boardCount} sheet{selected.boardCount === 1 ? '' : 's'}
                  {selected.calloutCount > 0 && ` · ${selected.calloutCount} callout${selected.calloutCount === 1 ? '' : 's'}`}
                </p>
              </div>
            </header>

            {/* Same grid the presentation view uses — dragging a sheet here
                sets its slot in the ROOM's running order, resolved by
                neighbour rather than by index (see reorderTargetPosition),
                because these four sheets are a subset of eighteen. */}
            <SortableBoardGrid
              boards={selectedBoards}
              globalOrderIds={globalOrderIds ?? boards.map((b) => b.id)}
              canReorder={canReorder}
              onReorder={onReorder}
              onBoardClick={onBoardClick}
            />
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
