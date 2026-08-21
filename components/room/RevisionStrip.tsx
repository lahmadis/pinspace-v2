'use client'

import { ROOM, MONO_STACK } from '@/lib/room/palette'

export type RoomView = 'room' | 'unfolded' | 'plan'

interface RevisionStripProps {
  view: RoomView
  onViewChange: (view: RoomView) => void
}

const VIEWS: Array<{ id: RoomView; label: string }> = [
  { id: 'room', label: 'Room' },
  { id: 'unfolded', label: 'Unfolded' },
  { id: 'plan', label: 'Plan' },
]

/**
 * Bottom-center view switcher — Room / Unfolded / Plan. Used to sit above a
 * milestone timeline (First pin-up / Mid-review / Final review); that strip
 * was removed per explicit request, so this is just the switcher pill now. A
 * light paper/sheet bar matching the room's own chrome — only the active view
 * button inverts to a filled color.
 */
export default function RevisionStrip({ view, onViewChange }: RevisionStripProps) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 pointer-events-none pb-5 flex justify-center">
      <div
        className="pointer-events-auto flex items-center gap-1 p-1 rounded-full shadow-xl"
        style={{ background: ROOM.wall, border: `1px solid ${ROOM.hairline}` }}
      >
        {VIEWS.map((v) => {
          const isActive = v.id === view
          return (
            <button
              key={v.id}
              onClick={() => onViewChange(v.id)}
              aria-pressed={isActive}
              className="px-5 py-2 rounded-full text-[11px] uppercase tracking-[0.18em] transition-colors"
              style={{
                fontFamily: MONO_STACK,
                background: isActive ? ROOM.accent : 'transparent',
                color: isActive ? ROOM.wall : ROOM.ink2,
                fontWeight: isActive ? 700 : 500,
              }}
            >
              {v.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
