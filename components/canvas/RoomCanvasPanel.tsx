'use client'

import { ROOM } from '@/lib/room/palette'
import { useRoomCanvas } from '@/hooks/useRoomCanvas'
import InfiniteCanvas from './InfiniteCanvas'

/**
 * The Canvas tab: resolves the space's canvas, then hands off to the surface.
 *
 * Kept separate from InfiniteCanvas so the surface stays a dumb component that
 * takes a canvasId — desk sessions will mount it with a different resolver, and
 * the guest crit page with a token, without either needing this room lookup.
 */
export default function RoomCanvasPanel({
  roomId,
  canEdit = true,
  guestToken,
}: {
  roomId: string | null
  canEdit?: boolean
  guestToken?: string | null
}) {
  const { canvasId, loading, error, retry } = useRoomCanvas(roomId, {
    enabled: Boolean(roomId),
    // A guest may draw on a canvas but never create one, and an archived space
    // should not gain rows because someone opened a tab.
    canCreate: canEdit && !guestToken,
  })

  // No room to hang a canvas on — the demo studio, which has no persisted room
  // and so no canvases row to find or create. Said plainly rather than left as
  // a permanent spinner or a misleading "none yet".
  if (!roomId) return <Centered muted>Canvas isn&apos;t available in this space.</Centered>

  if (error) {
    return (
      <Centered>
        <div style={{ color: ROOM.ink, fontSize: 13, marginBottom: 10 }}>{error}</div>
        <button
          onClick={retry}
          style={{
            padding: '7px 14px',
            borderRadius: 8,
            border: `1px solid ${ROOM.hairline}`,
            background: ROOM.wall,
            color: ROOM.ink,
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          Try again
        </button>
      </Centered>
    )
  }

  if (loading && !canvasId) return <Centered muted>Opening canvas…</Centered>

  if (!canvasId) {
    // Only reachable when the space has no canvas and this viewer may not make
    // one — a read-only or archived space nobody has drawn in yet.
    return <Centered muted>No canvas in this space yet.</Centered>
  }

  return <InfiniteCanvas canvasId={canvasId} canEdit={canEdit} guestToken={guestToken} />
}

function Centered({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: ROOM.background,
        color: muted ? ROOM.ink2 : ROOM.ink,
        fontSize: 13,
      }}
    >
      {children}
    </div>
  )
}
