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

/**
 * Sheets in the fan on a person card: one in front, two behind. Three is what
 * reads as "a stack" — two looks like a mistake, four is mush at this size.
 */
const COVER_COUNT = 3

/** Matches the server's own cap (app/api/boards/attribution). */
const NAME_MAX_LENGTH = 80

/** The well behind the fan: a soft pool of light under the stack. */
const WELL_BACKGROUND =
  'radial-gradient(circle at 50% 74%, rgba(214,224,250,0.5), transparent 52%), linear-gradient(180deg, #fbfcfe 0%, #edf0f8 100%)'

/** Page field. A slow four-stop wash rather than the flat fill this had. */
const PAGE_BACKGROUND =
  'linear-gradient(128deg, #e4e8f8 0%, #eef1f8 34%, #eceff7 62%, #e9edf6 100%)'

const CARD_SHADOW = '0 14px 30px rgba(36,46,84,0.07), 0 2px 6px rgba(36,46,84,0.035)'
const HAIRLINE = 'rgba(196,206,230,0.62)'
const SHEET_HAIRLINE = 'rgba(176,186,212,0.5)'
const SUBTLE_INK = '#7a8290'

/**
 * The fan's three positions.
 *
 * Written out as WHOLE class strings, never composed from pieces: Tailwind
 * extracts candidates from raw file text, so a class built by interpolation
 * (`[transform:${x}]`) is invisible to it and silently emits no CSS at all.
 *
 * Each state is one complete `transform` value rather than separate Tailwind
 * rotate/translate utilities, because those share a single set of CSS variables
 * — a hover that changed only the rotation would leave the old translate in
 * place and the sheet would pivot where it stands instead of swinging out.
 */
const FAN_BASE =
  'absolute left-1/2 top-[25px] -ml-[75px] w-[150px] h-[200px] overflow-hidden transition-transform duration-500 ease-[cubic-bezier(.16,1,.3,1)]'
const FAN_LEFT =
  '[transform:rotate(-3.5deg)_translate(-9px,4px)] group-hover:[transform:rotate(-9deg)_translate(-30px,2px)]'
const FAN_RIGHT =
  '[transform:rotate(3.5deg)_translate(9px,6px)] group-hover:[transform:rotate(9deg)_translate(30px,4px)]'
/** The front sheet stays put — the two behind it do the moving. */
const FAN_FRONT = ''

/** One sheet in a person card's fan. */
function FanSheet({
  board,
  position,
  alt,
}: {
  board: Board
  position: string
  alt: string
}) {
  return (
    <div
      className={`${FAN_BASE} ${position}`}
      style={{ background: '#fbfcfe', border: `1px solid ${SHEET_HAIRLINE}` }}
    >
      {board.thumbnailUrl || board.fullImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={board.thumbnailUrl || board.fullImageUrl}
          alt={alt}
          loading="lazy"
          draggable={false}
          className="w-full h-full object-cover"
        />
      ) : null}
    </div>
  )
}

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
        className="text-[25px] font-semibold tracking-[-0.035em] w-full max-w-sm rounded-lg px-2 py-0.5 -ml-2 focus:outline-none"
        style={{
          color: ROOM.ink,
          fontFamily: SANS_STACK,
          background: '#ffffff',
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
        className="group/name flex items-center gap-2 max-w-full text-left rounded-lg px-2 py-0.5 -ml-2 transition-colors hover:bg-white/70"
      >
        <span
          className="text-[25px] font-semibold tracking-[-0.035em]"
          style={{ color: ROOM.ink, fontFamily: SANS_STACK }}
        >
          {displayed}
        </span>
        {saving ? (
          <span
            className="w-3.5 h-3.5 shrink-0 rounded-full border-2 animate-spin"
            style={{ borderColor: HAIRLINE, borderTopColor: ROOM.accent }}
            aria-hidden
          />
        ) : (
          <Pencil
            className="w-4 h-4 shrink-0 opacity-0 group-hover/name:opacity-50 transition-opacity"
            style={{ color: SUBTLE_INK }}
            aria-hidden
          />
        )}
      </button>
      {error && (
        // Stays until the next edit rather than timing out: the name has
        // already snapped back, so this is the only thing saying why.
        <p role="alert" className="mt-1 text-[12px]" style={{ color: ROOM.redline, fontFamily: SANS_STACK }}>
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
 * Presentation follows the board-cards reference: a person is a stack of their
 * own sheets that fans open under the cursor, rather than a row of cropped
 * thumbnails above a contact-list row. The one deliberate departure is the
 * typeface — the reference sets Figtree, and this uses the app's Onest, because
 * the 2D view sitting in a different face from the room it belongs to was
 * already reported as wrong once.
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

  const mutedStyle = { color: SUBTLE_INK, fontFamily: SANS_STACK } as const

  return (
    <div className="w-full h-full overflow-y-auto" style={{ background: PAGE_BACKGROUND }}>
      {/* Keyed so React remounts on every level change — a CSS animation only
          runs when the element is inserted, and without a key this div persists
          across grid ⇄ person, so the entrance would play once on first open
          and never again.

          Keyed on the ID, not on the resolved `selected`. Renaming a person who
          has no account changes the key they derive from, so for the length of
          the refetch `selected` is momentarily null while `selectedStudentId`
          already holds the new id. Keying on `selected` collapsed that gap to
          'everyone' and fired the full-screen entrance twice on every such
          rename. */}
      <div
        key={selectedStudentId ?? 'everyone'}
        className="screen-in max-w-[1180px] mx-auto px-6 sm:px-10 py-10 sm:py-[54px]"
      >
        {selected ? (
          <>
            <header className="flex items-center gap-4">
              <button
                type="button"
                onClick={onClearSelection}
                aria-label="Back to everyone"
                title="Back to everyone"
                className="w-[38px] h-[38px] shrink-0 rounded-full flex items-center justify-center text-[17px] leading-none transition-colors hover:bg-white"
                style={{
                  background: 'rgba(255,255,255,0.9)',
                  border: `1px solid rgba(196,206,230,0.7)`,
                  boxShadow: '0 2px 6px rgba(36,46,84,0.06)',
                  color: '#454e5e',
                }}
              >
                <span aria-hidden>←</span>
              </button>

              {/* min-w-0 so a very long name WRAPS instead of stretching the
                  header past the page; the names themselves no longer truncate,
                  since an ellipsis on a short name like "Prof Lahmadi" hid it
                  for no reason with half the row empty. */}
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
                    className="text-[25px] font-semibold tracking-[-0.035em]"
                    style={{ color: ROOM.ink, fontFamily: SANS_STACK }}
                  >
                    {selected.name}
                  </h2>
                )}
                <p className="mt-1 text-[13px] font-medium tracking-[-0.01em]" style={mutedStyle}>
                  {selected.boardCount} sheet{selected.boardCount === 1 ? '' : 's'}, laid flat
                  {selected.calloutCount > 0 &&
                    ` · ${selected.calloutCount} callout${selected.calloutCount === 1 ? '' : 's'}`}
                </p>
              </div>
            </header>

            {/* Same grid the presentation view uses — dragging a sheet here
                sets its slot in the ROOM's running order, resolved by
                neighbour rather than by index (see reorderTargetPosition),
                because these four sheets are a subset of eighteen. */}
            <div className="mt-10">
              <SortableBoardGrid
                boards={selectedBoards}
                globalOrderIds={globalOrderIds ?? boards.map((b) => b.id)}
                canReorder={canReorder}
                onReorder={onReorder}
                onBoardClick={onBoardClick}
                // Fixed-width sheets centred in the page rather than columns
                // stretched to fill it: a sheet has a real size, and stretching
                // it makes four boards look like a different object from eight.
                gridClassName="grid gap-y-[34px] gap-x-[30px] grid-cols-[repeat(auto-fit,180px)] sm:grid-cols-[repeat(auto-fit,210px)] justify-center"
                wellAspectClassName="aspect-[3/4]"
              />
            </div>
          </>
        ) : (
          <>
            <p className="text-[13px] font-medium tracking-[-0.01em]" style={mutedStyle}>
              {students.length} {students.length === 1 ? 'person' : 'people'} · click a stack to read their sheets
            </p>

            {students.length === 0 ? (
              <p className="mt-8 text-[14px]" style={{ color: SUBTLE_INK, fontFamily: SANS_STACK }}>
                Nothing pinned up yet.
              </p>
            ) : (
              <div className="mt-[34px] grid gap-7 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                {students.map((student) => {
                  const covers = student.boardIds
                    .map((id) => boardsById.get(id))
                    .filter((b): b is Board => Boolean(b))
                    .slice(0, COVER_COUNT)
                  // Front sheet first in the list, but painted LAST so it sits
                  // on top of the two it fans out from.
                  const [front, behindLeft, behindRight] = covers

                  return (
                    <button
                      key={student.id}
                      type="button"
                      onClick={() => onSelectStudent(student)}
                      // Without this the card announces as its thumbnail alt +
                      // "See boards" + the name + both counts, in that order.
                      aria-label={`${student.name}, ${student.boardCount} sheet${student.boardCount === 1 ? '' : 's'}`}
                      className="group text-left transition-[transform,filter] duration-[450ms] ease-[cubic-bezier(.16,1,.3,1)] hover:-translate-y-1.5 hover:[filter:drop-shadow(0_22px_34px_rgba(36,46,84,0.13))]"
                    >
                      <div
                        className="rounded-[18px] overflow-hidden p-[10px] pb-0"
                        style={{
                          background: '#ffffff',
                          border: `1px solid ${HAIRLINE}`,
                          boxShadow: CARD_SHADOW,
                        }}
                      >
                        <div
                          className="relative h-[250px] rounded-xl overflow-hidden"
                          style={{ background: WELL_BACKGROUND }}
                        >
                          {covers.length === 0 ? (
                            <span
                              className="absolute inset-0 flex items-center justify-center text-[10px] uppercase tracking-[0.14em]"
                              style={{ fontFamily: MONO_STACK, color: ROOM.ink2 }}
                            >
                              No sheets yet
                            </span>
                          ) : (
                            <>
                              {behindLeft && <FanSheet board={behindLeft} position={FAN_LEFT} alt="" />}
                              {behindRight && <FanSheet board={behindRight} position={FAN_RIGHT} alt="" />}
                              <FanSheet board={front} position={FAN_FRONT} alt="" />
                            </>
                          )}

                          {/* Rises into place on hover. pointer-events-none so
                              it never intercepts the click it is advertising —
                              the whole card is the button. */}
                          <div
                            aria-hidden
                            className="absolute left-1/2 bottom-[18px] -translate-x-1/2 translate-y-[10px] opacity-0 px-[18px] py-[9px] rounded-full text-[13px] font-semibold tracking-[-0.01em] text-white whitespace-nowrap pointer-events-none transition-[opacity,transform] duration-300 ease-[cubic-bezier(.16,1,.3,1)] group-hover:opacity-100 group-hover:translate-y-0"
                            style={{
                              background: ROOM.accent,
                              boxShadow: '0 8px 18px rgba(59,110,246,0.34)',
                              fontFamily: SANS_STACK,
                            }}
                          >
                            See boards
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-3 px-2 pt-[15px] pb-[17px]">
                          <span className="min-w-0">
                            <span
                              className="block truncate text-[15px] font-semibold tracking-[-0.02em]"
                              style={{ color: ROOM.ink, fontFamily: SANS_STACK }}
                            >
                              {student.name}
                            </span>
                            <span className="block text-[12px] font-medium" style={mutedStyle}>
                              {student.boardCount} sheet{student.boardCount === 1 ? '' : 's'}
                            </span>
                          </span>

                          <span className="flex items-center gap-2 shrink-0">
                            {student.calloutCount > 0 && (
                              <span
                                className="text-[11px] font-semibold tabular-nums px-2 py-0.5 rounded-full"
                                style={{ background: ROOM.chip, color: '#454e5e', fontFamily: SANS_STACK }}
                                title={`${student.calloutCount} callout${student.calloutCount === 1 ? '' : 's'}`}
                              >
                                {student.calloutCount}
                              </span>
                            )}
                            {/* Accent pin, haloed. Decorative — the count beside
                                it carries the information. */}
                            <span
                              aria-hidden
                              className="w-[9px] h-[9px] rounded-full mr-[7px]"
                              style={{
                                background: ROOM.accent,
                                boxShadow: '0 0 0 7px rgba(59,110,246,0.12)',
                              }}
                            />
                          </span>
                        </div>
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
