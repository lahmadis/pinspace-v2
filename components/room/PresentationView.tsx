'use client'

import { useMemo } from 'react'
import type { Board } from '@/types'
import { ROOM, SANS_STACK } from '@/lib/room/palette'
import SortableBoardGrid from './SortableBoardGrid'

interface PresentationViewProps {
  /** Every board in the room, already in slideshow order. */
  boards: Board[]
  canReorder?: boolean
  onReorder?: (boardId: string, targetPosition: number) => Promise<boolean | void>
  onBoardClick?: (board: Board) => void
}

/**
 * The room's whole pin-up as one running order.
 *
 * The other views are organised by WHERE work hangs (the space, a wall
 * unfolded, the plan) or by WHOSE it is (the 2D archive). This one is organised
 * by WHEN it gets shown: every sheet from every student in a single sequence,
 * which is the thing a crit actually runs off and which no per-person view can
 * express — a review moves between people, not through one person at a time.
 *
 * Drag a card and you are editing that sequence directly. It's the same
 * boards.sort_order the lightbox arrows already walk, so setting the order here
 * IS setting the slideshow, with no second concept to keep in sync.
 */
export default function PresentationView({
  boards,
  canReorder = false,
  onReorder,
  onBoardClick,
}: PresentationViewProps) {
  const globalOrderIds = useMemo(() => boards.map((b) => b.id), [boards])
  // Identical to the 2D archive's people-grid caption (TwoDView's mutedStyle +
  // classes). This line used to be 10px mono, uppercased and tracked out to
  // 0.14em, which made the room's two captions read as two different products.
  // The sans one won because it is the one that reads as a sentence.
  const captionStyle = { color: '#7a8290', fontFamily: SANS_STACK } as const

  return (
    <div className="w-full h-full overflow-y-auto" style={{ background: ROOM.background }}>
      <div className="max-w-6xl mx-auto px-6 py-8">
        <header className="mb-6">
          <h2
            className="text-[20px] font-semibold"
            style={{ color: ROOM.ink, fontFamily: SANS_STACK }}
          >
            Running Order
          </h2>
          <p className="mt-1 text-[13px] font-medium tracking-[-0.01em]" style={captionStyle}>
            {boards.length} board{boards.length === 1 ? '' : 's'}
            {canReorder ? ' · drag to reorder' : ''}
          </p>
        </header>

        {boards.length === 0 ? (
          <p className="text-[12px]" style={{ color: ROOM.ink2, fontFamily: SANS_STACK }}>
            Nothing pinned up in this space yet.
          </p>
        ) : (
          <SortableBoardGrid
            boards={boards}
            // The presentation grid IS the room, so display order and room order
            // are the same list — but it's still passed explicitly, because the
            // grid resolves drops against room positions either way.
            globalOrderIds={globalOrderIds}
            canReorder={canReorder}
            onReorder={onReorder}
            onBoardClick={onBoardClick}
            showPosition
            labelOwner
          />
        )}
      </div>
    </div>
  )
}
