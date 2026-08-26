'use client'

import { ROOM, MONO_STACK } from '@/lib/room/palette'

/**
 * The canvas is deliberately NOT here.
 *
 * An infinite canvas belongs to a desk crit, not to a space: the other four are
 * readings of the same room and its boards, and a working surface with its own
 * contents sitting alongside them made the strip mean two different things. It
 * lives at /desk-crits/[id] instead.
 */
export type RoomView = 'room' | 'unfolded' | 'plan' | '2d' | 'presentation'

interface RevisionStripProps {
  view: RoomView
  onViewChange: (view: RoomView) => void
  /** True while a single wall is focused, which is the only time exiting means anything. */
  isFocused?: boolean
  onExitFocus?: () => void
}

/**
 * Only the three spatial readings of the room live in the strip. 2D and
 * Presentation moved to the menu beside Share: they are not ways of looking at
 * the SPACE — one is a per-person archive, the other a running order — and
 * sitting them in the same segmented control implied five peers when there are
 * three plus two different things.
 */
const VIEWS: Array<{ id: RoomView; label: string }> = [
  { id: 'room', label: 'Space' },
  { id: 'unfolded', label: 'Unfolded' },
  { id: 'plan', label: 'Plan' },
]

/**
 * Bottom-center controls for the 3D room.
 *
 * Two stacked rows on purpose, because they operate on different things: the
 * lower pill switches what is RENDERED (Room is a live 3D canvas; Unfolded and
 * Plan are flat DOM), while the upper row only moves the CAMERA within the Room
 * render. Folding camera angles into the same segmented control would imply
 * "Axon" is a peer of "Plan" and that picking one deselects the other, which
 * isn't true — so the presets are plain buttons with no pressed state, and the
 * row is hidden outside the Room view where a camera doesn't exist.
 */
export default function RevisionStrip({
  view,
  onViewChange,
  isFocused = false,
  onExitFocus,
}: RevisionStripProps) {

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 pointer-events-none pb-5 flex flex-col items-center gap-2">
      {/* Axon and Fit are gone, but NOT this. Wall focus holds the camera
          square-on with orbit switched off, and its own escape hatches —
          Escape, a floor click — are both invisible. Dropping the pill wholesale
          along with the presets would have removed the only discoverable way
          out of a locked camera. */}
      {isFocused && onExitFocus && (
        <div
          className="pointer-events-auto flex items-center p-1 rounded-full shadow-lg"
          style={{ background: ROOM.wall, border: `1px solid ${ROOM.hairline}` }}
        >
          <button
            type="button"
            onClick={onExitFocus}
            title="Release the camera and show every wall again (Esc)"
            className="px-4 py-1.5 rounded-full text-[10px] uppercase tracking-[0.16em] transition-opacity hover:opacity-90"
            style={{ fontFamily: MONO_STACK, background: ROOM.accent, color: ROOM.wall, fontWeight: 700 }}
          >
            Exit focus
          </button>
        </div>
      )}

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
