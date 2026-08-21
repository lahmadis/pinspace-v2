'use client'

import type { Board } from '@/types'
import { ROOM, MONO_STACK, SANS_STACK } from '@/lib/room/palette'

/**
 * Bottom-center cluster for the wall the viewer is currently facing: start a
 * crit walk (spotlight one board at a time), auto-tidy the wall's layout, or
 * export it as a printable contact sheet. Sits just above RevisionStrip's
 * clearance band so the two never overlap — see REVISION_STRIP_CLEARANCE in
 * StudioRoom.tsx, which this intentionally does not import (kept free of a
 * cross-file layout coupling; if that constant changes, nudge the 132px
 * bottom offset below to match).
 *
 * All local state (critWalkOn/critBoards/etc.) lives in StudioRoom — this
 * component is presentational plus the tidy/export triggers.
 */

interface RoomWallToolsProps {
  critWalkOn: boolean
  critBoards: Board[]
  critIndex: number
  onStartCrit: () => void
  onEndCrit: () => void
  onCritPrev: () => void
  onCritNext: () => void
  canTidy: boolean
  onAutoTidy: () => void
  tidying: boolean
  onExport: () => void
  wallLabel: string
}

function pillButton(active = false) {
  return {
    fontFamily: SANS_STACK,
    fontSize: 13,
    fontWeight: 700,
    padding: '10px 16px',
    borderRadius: 999,
    border: `1px solid ${ROOM.hairline}`,
    cursor: 'pointer',
    // Active state fills with the accent color, not ink/black — the room's
    // chrome (this bar, the top-left logo/breadcrumb, the top-right Share/
    // menu buttons in app/studio/[id]/page.tsx) was reported as reading like
    // a separate black-button design language from the rest of the blue/
    // paper system.
    background: active ? ROOM.accent : ROOM.wall,
    color: active ? ROOM.wall : ROOM.ink,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  } as const
}

export default function RoomWallTools({
  critWalkOn,
  critBoards,
  critIndex,
  onStartCrit,
  onEndCrit,
  onCritPrev,
  onCritNext,
  canTidy,
  onAutoTidy,
  tidying,
  onExport,
  wallLabel,
}: RoomWallToolsProps) {
  if (critWalkOn) {
    const board = critBoards[critIndex]
    const caption = board
      ? `${critIndex + 1} / ${critBoards.length} — ${board.title || 'Untitled'}${
          board.calloutCount ? ` · ${board.calloutCount} callout${board.calloutCount === 1 ? '' : 's'}` : ''
        }`
      : ''
    return (
      <div
        className="fixed left-1/2 z-30 flex items-center gap-3 rounded-full shadow-xl px-3 py-2"
        style={{ bottom: 132, transform: 'translateX(-50%)', background: ROOM.accent, boxShadow: '0 16px 44px rgba(59,110,246,0.35)' }}
      >
        <button
          type="button"
          onClick={onCritPrev}
          disabled={critBoards.length < 2}
          aria-label="Previous board"
          className="rounded-full flex items-center justify-center disabled:opacity-40"
          style={{ width: 36, height: 36, border: 0, background: 'rgba(255,255,255,0.12)', color: ROOM.wall, fontSize: 14 }}
        >
          ◀
        </button>
        <div className="tabular-nums text-center" style={{ fontFamily: MONO_STACK, fontSize: 12, color: ROOM.wall, minWidth: 220 }}>
          {caption}
        </div>
        <button
          type="button"
          onClick={onCritNext}
          disabled={critBoards.length < 2}
          aria-label="Next board"
          className="rounded-full flex items-center justify-center disabled:opacity-40"
          style={{ width: 36, height: 36, border: 0, background: 'rgba(255,255,255,0.12)', color: ROOM.wall, fontSize: 14 }}
        >
          ▶
        </button>
        <button
          type="button"
          onClick={onEndCrit}
          className="rounded-full"
          style={{ fontFamily: SANS_STACK, fontSize: 12, fontWeight: 700, border: 0, background: 'rgba(255,255,255,0.12)', color: ROOM.wall, padding: '9px 16px' }}
        >
          End crit
        </button>
      </div>
    )
  }

  if (critBoards.length === 0) return null

  return (
    <div
      className="fixed left-1/2 z-30 flex items-center gap-2 rounded-full shadow-lg px-2 py-2"
      style={{ bottom: 132, transform: 'translateX(-50%)', background: 'rgba(255,255,255,0.9)', border: `1px solid ${ROOM.hairline}` }}
    >
      <span className="hidden sm:inline" style={{ fontFamily: MONO_STACK, fontSize: 10, letterSpacing: '0.14em', color: ROOM.ink2, paddingLeft: 8, textTransform: 'uppercase' }}>
        {wallLabel}
      </span>
      <button type="button" onClick={onStartCrit} style={pillButton(true)}>
        ▶ Crit walk
      </button>
      {canTidy && critBoards.length > 1 && (
        <button type="button" onClick={onAutoTidy} disabled={tidying} style={{ ...pillButton(), opacity: tidying ? 0.6 : 1 }}>
          ▦ {tidying ? 'Tidying…' : 'Auto-tidy'}
        </button>
      )}
      <button type="button" onClick={onExport} style={pillButton()}>
        ⤓ Export
      </button>
    </div>
  )
}
