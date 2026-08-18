'use client'

import { useState } from 'react'
import type { Board } from '@/types'
import { getBoardSizeInches } from '@/lib/boardDimensions'
import { ROOM, MONO_STACK } from '@/lib/room/palette'

/**
 * One pinned sheet, as DOM.
 *
 * Replaces BoardThumbnail / DraggableBoard. Everything it needs is already in
 * the row: absolute size in inches (board_width_in / board_height_in) and a
 * wall-relative centre in the API's 0-100 space. Nothing is derived from a
 * camera, so this component is identical in the room, in Unfolded, and in any
 * future view.
 *
 * Coordinate notes:
 *  - position.x 0..100 runs left to right across the pin-up surface, 50 = centre.
 *  - position.y 0..100 runs BOTTOM to TOP (it is a Three.js legacy), so the CSS
 *    offset is inverted here.
 *  - position.rotation is radians counter-clockwise (Three's rotation.z); CSS
 *    rotates clockwise, hence the negation.
 *  - Back-side bays use x unmirrored, matching the 2D editor the boards were
 *    actually placed in rather than the old browse view, which disagreed with it.
 */

export interface RoomBoardProps {
  board: Board
  /** Inches to CSS px inside the shell. */
  pxPerIn: number
  /** Pin-up surface of the bay this board sits on, inches. */
  bayWidthIn: number
  bayHeightIn: number
  onOpen?: (board: Board) => void
  /** Roster selection — lifts the sheet and rings it. */
  isHighlighted?: boolean
  /** Someone else's selection is active, so this sheet recedes. */
  isMuted?: boolean
  /** False on bays that are not facing the viewer: no hover, no clicks. */
  interactive?: boolean
  /** Hide the callout pip while a 2D panel owns the screen. */
  suppressCallouts?: boolean
}

function imageUrlFor(board: Board): string | null {
  const url = board.thumbnailUrl || board.fullImageUrl
  if (!url) return null
  const ok =
    url.startsWith('http://') ||
    url.startsWith('https://') ||
    url.startsWith('/uploads/') ||
    url.startsWith('blob:')
  if (!ok) return null
  // A raw PDF cannot go in an <img>. Uploads have rasterised to PNG since the
  // PDF path was added, so this only catches legacy rows.
  if (url.toLowerCase().endsWith('.pdf')) return null
  return url
}

export default function RoomBoard({
  board,
  pxPerIn,
  bayWidthIn,
  bayHeightIn,
  onOpen,
  isHighlighted = false,
  isMuted = false,
  interactive = true,
  suppressCallouts = false,
}: RoomBoardProps) {
  const [failed, setFailed] = useState(false)
  const pos = board.position
  if (!pos) return null

  const { widthIn, heightIn } = getBoardSizeInches(board)
  if (!(widthIn > 0) || !(heightIn > 0)) return null

  const w = widthIn * pxPerIn
  const h = heightIn * pxPerIn
  const cx = (pos.x / 100) * bayWidthIn * pxPerIn
  const cy = (1 - pos.y / 100) * bayHeightIn * pxPerIn
  const rotDeg = (-(pos.rotation ?? 0) * 180) / Math.PI

  const url = imageUrlFor(board)
  const callouts = board.calloutCount ?? 0

  return (
    <div
      className="absolute"
      style={{
        left: cx,
        top: cy,
        width: w,
        height: h,
        transform: `translate(-50%, -50%) rotate(${rotDeg}deg)`,
        transformOrigin: 'center',
        // Sheets are flat on the wall; without this they inherit preserve-3d
        // from the bay and hairline-crack against it at grazing angles.
        transformStyle: 'flat',
        opacity: isMuted ? 0.34 : 1,
        transition: 'opacity 260ms ease',
        pointerEvents: interactive ? 'auto' : 'none',
        zIndex: isHighlighted ? 2 : 1,
      }}
    >
      <button
        type="button"
        onClick={() => onOpen?.(board)}
        aria-label={board.title || 'Open board'}
        className="group block w-full h-full text-left"
        style={{
          background: '#FFFFFF',
          boxShadow: isHighlighted
            ? `0 0 0 2px ${ROOM.yellow}, 0 10px 26px rgba(11,11,11,0.26)`
            : '0 2px 8px rgba(11,11,11,0.16)',
          outline: 'none',
          cursor: interactive ? 'zoom-in' : 'default',
          transition: 'box-shadow 180ms ease, transform 180ms ease',
        }}
      >
        {url && !failed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={board.title || ''}
            draggable={false}
            onError={() => setFailed(true)}
            className="w-full h-full object-cover select-none"
            style={{ display: 'block' }}
          />
        ) : (
          <div
            className="w-full h-full flex items-center justify-center p-2 text-center"
            style={{ border: `1px solid ${ROOM.hairline}` }}
          >
            <span
              className="text-[9px] uppercase tracking-[0.14em] leading-tight"
              style={{ fontFamily: MONO_STACK, color: ROOM.hairline }}
            >
              {board.title || 'Sheet'}
            </span>
          </div>
        )}
      </button>

      {/* Callout count. A plain sibling element — the old <Html> badge escaped
          the WebGL stacking context and needed a suppress flag threaded through
          four components to stop it painting over the lightbox. Here it just
          stacks. */}
      {!suppressCallouts && callouts > 0 && (
        <span
          className="absolute rounded-full flex items-center justify-center tabular-nums pointer-events-none"
          style={{
            top: -7,
            right: -7,
            minWidth: 18,
            height: 18,
            padding: '0 5px',
            fontSize: 10,
            fontFamily: MONO_STACK,
            background: ROOM.redline,
            color: ROOM.wall,
            boxShadow: '0 1px 4px rgba(11,11,11,0.3)',
          }}
          title={`${callouts} callout${callouts === 1 ? '' : 's'}`}
        >
          {callouts}
        </span>
      )}

      {board.linkUrl && (
        <span
          className="absolute rounded-full flex items-center justify-center pointer-events-none"
          style={{
            top: -7,
            left: -7,
            width: 18,
            height: 18,
            background: ROOM.ink,
            color: ROOM.wall,
            boxShadow: '0 1px 4px rgba(11,11,11,0.3)',
          }}
          title="Has a linked video"
          aria-hidden="true"
        >
          <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
            <path d="M1 0.5 L7 4 L1 7.5 Z" />
          </svg>
        </span>
      )}
    </div>
  )
}
