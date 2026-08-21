'use client'

import { ROOM, MONO_STACK } from '@/lib/room/palette'
import type { RoomCameraPreset } from '@/lib/room/cameraViews'
import RoomViewPresets from './RoomViewPresets'

export type RoomView = 'room' | 'unfolded' | 'plan' | '2d'

interface RevisionStripProps {
  view: RoomView
  onViewChange: (view: RoomView) => void
  /**
   * Fly the camera to a named angle. Omit to hide the preset row entirely —
   * surfaces that mount the room without a CameraController have nothing to
   * fly.
   */
  onPreset?: (preset: RoomCameraPreset) => void
  /** True while a single wall is focused, which is the only time exiting means anything. */
  isFocused?: boolean
  onExitFocus?: () => void
}

const VIEWS: Array<{ id: RoomView; label: string }> = [
  { id: 'room', label: 'Space' },
  { id: 'unfolded', label: 'Unfolded' },
  { id: 'plan', label: 'Plan' },
  // The per-person board archive. Labelled by what it IS from the viewer's
  // side — a flat 2D read of the room — rather than "Archive", which sounds
  // like cold storage for old work.
  { id: '2d', label: '2D' },
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
  onPreset,
  isFocused = false,
  onExitFocus,
}: RevisionStripProps) {
  const showPresets = view === 'room' && Boolean(onPreset)

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 pointer-events-none pb-5 flex flex-col items-center gap-2">
      {showPresets && onPreset && (
        <RoomViewPresets onPreset={onPreset} isFocused={isFocused} onExitFocus={onExitFocus} />
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
