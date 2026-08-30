'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { RoomStudent } from '@/lib/room/students'

/**
 * Who is in the room, and whose work you are looking at.
 *
 * ONE component for both 3D surfaces — the editor and the read-only view route
 * — because it is the same question asked in the same corner, and the two had
 * drifted into a list you could click and a list you could not. The editor
 * could only select a person from inside the 2D tab; the view route rendered
 * the names as plain <div>s, so the roster answered "who is here" and then
 * refused the obvious follow-up.
 *
 * Picking somebody highlights THEIR boards in the room (WallSystem draws a bay
 * outline around each run of their sheets, per wall face). It does not move the
 * camera: a name click is "show me which of these are hers", asked while you
 * are already looking at a wall, and yanking the view somewhere else is a
 * different gesture — that one is a double-click on the wall.
 *
 * Deliberately stays OPEN after a pick. Reading a crit room is a sequence of
 * "and whose are those?" — you step down the list watching bays light up — and
 * a menu that closed on every click would make that four gestures instead of
 * two. Click away, or the button, to dismiss it.
 */
export default function StudentsMenu({
  students,
  selectedStudentId,
  onChange,
  className,
}: {
  students: RoomStudent[]
  /** The person whose boards are highlighted, if any. */
  selectedStudentId: string | null
  /** Null clears the highlight. */
  onChange: (studentId: string | null) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const selected = students.find((s) => s.id === selectedStudentId) ?? null

  return (
    <div className={`relative ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        title={
          selected
            ? `Showing ${selected.name}'s work — pick again to show everyone`
            : 'Highlight one person’s work in the room'
        }
        className="flex max-w-[15rem] items-center gap-2 rounded-xl bg-[#3B6EF6] px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition-colors hover:bg-[#2F5CD6]"
      >
        {/* The button becomes the readout once somebody is picked. Without it
            the only sign the room is filtered is an outline that may be behind
            you — and "why is that wall glowing" is not a question a visitor
            should have to answer by reopening a menu. */}
        <span className="truncate">{selected ? selected.name : 'Students'}</span>
        <span className="opacity-75">
          {selected ? selected.boardCount : students.length}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 opacity-70 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <>
          {/* Click-away behind the panel, not over it. */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-xl border border-[#16181D]/10 bg-white shadow-2xl">
            <p className="border-b border-[#16181D]/[0.06] bg-[#F4F6FB] px-3 py-2 text-[11px] font-semibold text-[#8A8FA0]">
              {students.length} {students.length === 1 ? 'student' : 'students'}
            </p>

            {students.length === 0 ? (
              <p className="px-3 py-3 text-sm text-[#8A8FA0]">Nobody has work pinned here yet.</p>
            ) : (
              <ul className="max-h-72 overflow-y-auto py-1">
                {/* Only when it does something. A permanent "everyone" row on an
                    unfiltered room is a control whose whole job is to tell you
                    nothing is happening. */}
                {selected && (
                  <li>
                    <button
                      type="button"
                      onClick={() => onChange(null)}
                      className="w-full px-3 py-2 text-left text-[12px] font-semibold text-[#3B6EF6] hover:bg-[#F4F6FB]"
                    >
                      Show everyone
                    </button>
                  </li>
                )}
                {students.map((student) => {
                  const isSelected = student.id === selectedStudentId
                  return (
                    <li key={student.id}>
                      <button
                        type="button"
                        // Re-picking clears, so the highlight can always be
                        // undone from the row that set it.
                        onClick={() => onChange(isSelected ? null : student.id)}
                        aria-pressed={isSelected}
                        className="flex w-full items-center justify-between gap-3 py-2 pl-2 pr-3 text-left transition-colors hover:bg-[#F4F6FB]"
                        style={{
                          // 3px transparent on unselected rows so the text does
                          // not shift sideways when a row becomes the active one.
                          borderLeft: `3px solid ${isSelected ? '#3B6EF6' : 'transparent'}`,
                          background: isSelected ? 'rgba(59,110,246,0.10)' : undefined,
                        }}
                      >
                        <span className="truncate text-[13px] font-semibold text-[#16181D]">
                          {student.name}
                        </span>
                        <span className="shrink-0 text-[11px] text-[#8A8FA0]">
                          {student.boardCount} board{student.boardCount === 1 ? '' : 's'}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}
