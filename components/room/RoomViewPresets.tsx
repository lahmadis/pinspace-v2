'use client'

import { ROOM, MONO_STACK } from '@/lib/room/palette'
import type { RoomCameraPreset } from '@/lib/room/cameraViews'

interface RoomViewPresetsProps {
  onPreset: (preset: RoomCameraPreset) => void
  /** True while a single wall is focused — the only time exiting means anything. */
  isFocused?: boolean
  onExitFocus?: () => void
}

/**
 * Camera angles, not render modes. Deliberately excludes a top-down preset: the
 * editor already offers "Plan" as a real flat floor plan, and two controls that
 * both claim to show you the room from above is worse than one.
 */
const PRESETS: Array<{ id: RoomCameraPreset; label: string; title: string }> = [
  { id: 'axon', label: 'Axon', title: 'Reset to the room’s default three-quarter view' },
  { id: 'fit', label: 'Fit', title: 'Pull back until every wall is in frame' },
]

/**
 * The camera-preset pill, shared by the editor (stacked above RevisionStrip's
 * render-mode switcher) and the read-only view page (which has no render modes,
 * so it stands alone).
 *
 * These are momentary actions, not a segmented control: pressing "Axon" flies
 * the camera and leaves no lasting selection, so nothing here carries a pressed
 * state and none of the buttons deselect each other. "Exit focus" is the one
 * exception — it only appears while a wall is focused, and is styled as active
 * because it reflects real state.
 */
export default function RoomViewPresets({ onPreset, isFocused = false, onExitFocus }: RoomViewPresetsProps) {
  return (
    <div
      className="pointer-events-auto flex items-center gap-1 p-1 rounded-full shadow-lg"
      style={{ background: ROOM.wall, border: `1px solid ${ROOM.hairline}` }}
    >
      {PRESETS.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onPreset(p.id)}
          title={p.title}
          className="px-4 py-1.5 rounded-full text-[10px] uppercase tracking-[0.16em] transition-colors hover:bg-black/[0.04]"
          style={{ fontFamily: MONO_STACK, color: ROOM.ink2, fontWeight: 500 }}
        >
          {p.label}
        </button>
      ))}

      {isFocused && onExitFocus && (
        <>
          <span aria-hidden className="w-px self-stretch my-1" style={{ background: ROOM.hairline }} />
          {/* Focus can also be left with Escape or by clicking the floor, but
              neither is discoverable — this is the visible way out. */}
          <button
            type="button"
            onClick={onExitFocus}
            title="Show every wall again (Esc)"
            className="px-4 py-1.5 rounded-full text-[10px] uppercase tracking-[0.16em] transition-opacity hover:opacity-90"
            style={{ fontFamily: MONO_STACK, background: ROOM.accent, color: ROOM.wall, fontWeight: 700 }}
          >
            Exit focus
          </button>
        </>
      )}
    </div>
  )
}
