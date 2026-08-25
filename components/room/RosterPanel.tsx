'use client'

import { useState } from 'react'
import { ROOM, MONO_STACK, SANS_STACK } from '@/lib/room/palette'
import type { RoomStudent } from '@/lib/room/students'

interface RosterPanelProps {
  students: RoomStudent[]
  selectedStudentId: string | null
  onSelect: (student: RoomStudent) => void
}

/**
 * Right-hand roster. One numbered row per student, in wall order, so the panel
 * reads as a pin-up running sheet rather than an alphabetical directory.
 *
 * A light paper/sheet panel, matching the room's own chrome — the accent
 * color appears solely on the selected row and its index chip.
 * The avatar chip stays a flat neutral regardless of selection; the panel
 * already signals selection via the row itself, so a second color-flip on the
 * avatar would just compete with it.
 */
export default function RosterPanel({ students, selectedStudentId, onSelect }: RosterPanelProps) {
  const [collapsed, setCollapsed] = useState(false)

  if (students.length === 0) return null

  return (
    <aside
      className="fixed right-4 top-20 z-30 flex flex-col rounded-2xl shadow-xl overflow-hidden"
      style={{
        background: ROOM.wall,
        border: `1px solid ${ROOM.hairline}`,
        width: collapsed ? 56 : 260,
        maxHeight: 'calc(100vh - 12rem)',
        transition: 'width 180ms ease',
      }}
      aria-label="Student roster"
    >
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="flex items-center justify-between gap-2 px-3 py-2.5 shrink-0 hover:opacity-90 transition-opacity"
        style={{ color: ROOM.ink, borderBottom: `1px solid ${ROOM.hairline}` }}
        aria-expanded={!collapsed}
      >
        <span
          className="text-[10px] uppercase tracking-[0.18em] truncate"
          style={{ fontFamily: MONO_STACK, color: ROOM.ink }}
        >
          {collapsed ? String(students.length).padStart(2, '0') : `Roster · ${String(students.length).padStart(2, '0')}`}
        </span>
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke={ROOM.ink} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: collapsed ? 'rotate(180deg)' : 'none', flex: 'none' }}
          aria-hidden="true"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
      </button>

      {!collapsed && (
        <ul className="overflow-y-auto py-1">
          {students.map((student, index) => {
            const isSelected = student.id === selectedStudentId
            return (
              <li key={student.id}>
                <button
                  onClick={() => onSelect(student)}
                  aria-current={isSelected ? 'true' : undefined}
                  className="w-full flex items-center gap-2.5 pl-2 pr-3 py-2 text-left transition-colors"
                  style={{
                    // Accent left border marks the active student; the 3px
                    // transparent border on unselected rows keeps text from
                    // shifting horizontally on selection. The row tint is the
                    // same accent at low alpha — it was still a leftover amber
                    // from the pre-blue palette.
                    borderLeft: `3px solid ${isSelected ? ROOM.accent : 'transparent'}`,
                    background: isSelected ? 'rgba(59,110,246,0.10)' : 'transparent',
                  }}
                >
                  <span
                    className="w-6 shrink-0 text-[10px] tabular-nums"
                    style={{ fontFamily: MONO_STACK, color: isSelected ? ROOM.ink : ROOM.ink2 }}
                  >
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span
                    className="w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-[11px] font-bold"
                    style={{ background: ROOM.chip, color: ROOM.ink, fontFamily: SANS_STACK }}
                    aria-hidden="true"
                  >
                    {student.initials}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className="block truncate text-[13px] font-semibold"
                      style={{ color: ROOM.ink, fontFamily: SANS_STACK }}
                    >
                      {student.name}
                    </span>
                    <span
                      className="block text-[9px] uppercase tracking-[0.12em]"
                      style={{ fontFamily: MONO_STACK, color: ROOM.ink2 }}
                    >
                      W{String(student.wallIndex + 1).padStart(2, '0')} · {student.boardCount} sheet{student.boardCount === 1 ? '' : 's'}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </aside>
  )
}
