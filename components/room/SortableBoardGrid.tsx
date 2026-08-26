'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  arrayMove,
  rectSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Board } from '@/types'
import { ROOM, MONO_STACK, SANS_STACK } from '@/lib/room/palette'
import { reorderTargetPosition } from '@/lib/room/reorderTarget'
import { boardAuthorName } from '@/lib/displayName'

interface SortableBoardGridProps {
  /** Boards to show, already in display order. */
  boards: Board[]
  /**
   * Every board id in the room, in slideshow order. Needed even when `boards`
   * is the whole room, because the reorder API addresses ROOM positions — see
   * reorderTargetPosition.
   */
  globalOrderIds: readonly string[]
  /** Off for anyone who can't reorder; cards still open on click. */
  canReorder?: boolean
  /** Persist a move. Resolves false on failure so the grid can roll back. */
  onReorder?: (boardId: string, targetPosition: number) => Promise<boolean | void>
  onBoardClick?: (board: Board) => void
  /** Show each card's 1-based slot. On in presentation, off in the archive. */
  showPosition?: boolean
  /** Owner name under the title — presentation mixes people, the archive doesn't. */
  labelOwner?: boolean
}

function sheetLabel(board: Board, index: number): string {
  const title = board.title?.trim()
  if (title) return title
  return `Sheet ${String(index + 1).padStart(2, '0')}`
}

/**
 * A grid of board cards you can drag into order.
 *
 * Shared by the 2D archive (one person's sheets) and the presentation view (the
 * whole room), because they are the same interaction over different slices, and
 * the slice is exactly what makes the index mapping subtle — see
 * reorderTargetPosition.
 *
 * Order is applied optimistically: the API renumbers the entire room and the
 * new order only comes back through a refetch, so waiting for the round trip
 * would leave the card you just dropped sitting in its old slot for a beat.
 */
export default function SortableBoardGrid({
  boards,
  globalOrderIds,
  canReorder = false,
  onReorder,
  onBoardClick,
  showPosition = false,
  labelOwner = false,
}: SortableBoardGridProps) {
  const sensors = useSensors(
    // Same 5px activation the workspace room grid uses: without it a click that
    // drifts a pixel is swallowed as a drag and the card never opens.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const boardsById = useMemo(() => {
    const m = new Map<string, Board>()
    for (const b of boards) m.set(b.id, b)
    return m
  }, [boards])

  const incomingIds = useMemo(() => boards.map((b) => b.id), [boards])
  const [orderIds, setOrderIds] = useState<string[]>(incomingIds)
  /**
   * True between dropping a card and the write settling.
   *
   * The optimistic order and the props disagree for exactly that window, and
   * the re-sync below can't tell that disagreement from a genuine server
   * change. A reorder rewrites every row in the room, so any unrelated board
   * update arriving in the gap (realtime, another user's edit) would re-run the
   * sync and snap the card back to its old slot until the refetch landed. Held
   * in a ref, not state: it must not itself trigger a render.
   */
  const reorderInFlight = useRef(false)

  // Re-sync when the server's order (or the set of boards) actually changes.
  // Compared by value, not identity: `boards` is a fresh array most renders and
  // an identity check would stomp the optimistic order on every parent render.
  useEffect(() => {
    if (reorderInFlight.current) return
    setOrderIds((prev) =>
      prev.length === incomingIds.length && prev.every((id, i) => id === incomingIds[i])
        ? prev
        : incomingIds
    )
  }, [incomingIds])

  const ordered = useMemo(
    () => orderIds.map((id) => boardsById.get(id)).filter((b): b is Board => Boolean(b)),
    [orderIds, boardsById]
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = orderIds.indexOf(String(active.id))
    const newIndex = orderIds.indexOf(String(over.id))
    if (oldIndex === -1 || newIndex === -1) return

    const activeId = String(active.id)
    const target = reorderTargetPosition(globalOrderIds, orderIds, activeId, newIndex)
    if (target == null) return

    const previous = orderIds
    setOrderIds(arrayMove(orderIds, oldIndex, newIndex))
    reorderInFlight.current = true

    Promise.resolve(onReorder?.(activeId, target)).then((ok) => {
      // Roll back only on an explicit false; undefined means the caller doesn't
      // report and the refetch will settle it either way.
      if (ok === false) setOrderIds(previous)
    }).catch(() => setOrderIds(previous)).finally(() => {
      reorderInFlight.current = false
    })
  }

  const grid = (
    <div className="grid gap-5 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
      {ordered.map((board, i) => (
        <SortableBoardCard
          key={board.id}
          board={board}
          index={i}
          canReorder={canReorder}
          onBoardClick={onBoardClick}
          showPosition={showPosition}
          labelOwner={labelOwner}
        />
      ))}
    </div>
  )

  if (!canReorder) return grid

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={orderIds} strategy={rectSortingStrategy}>
        {grid}
      </SortableContext>
    </DndContext>
  )
}

function SortableBoardCard({
  board,
  index,
  canReorder,
  onBoardClick,
  showPosition,
  labelOwner,
}: {
  board: Board
  index: number
  canReorder: boolean
  onBoardClick?: (board: Board) => void
  showPosition: boolean
  labelOwner: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: board.id,
    disabled: !canReorder,
  })

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
    zIndex: isDragging ? 20 : undefined,
  }

  const headerStyle = { fontFamily: MONO_STACK, color: ROOM.ink2 } as const

  return (
    <div ref={setNodeRef} style={style} className="relative">
      <button
        type="button"
        onClick={() => onBoardClick?.(board)}
        className="group text-left w-full"
        // The whole card is the drag handle when reordering is allowed. dnd-kit's
        // distance constraint is what keeps this from eating plain clicks, and
        // touch-none stops the browser scrolling the grid mid-drag.
        {...(canReorder ? attributes : {})}
        {...(canReorder ? listeners : {})}
        style={canReorder ? { touchAction: 'none', cursor: isDragging ? 'grabbing' : 'grab' } : undefined}
      >
        <div
          className="relative w-full aspect-[4/3] rounded-lg overflow-hidden flex items-center justify-center transition-shadow group-hover:shadow-lg"
          style={{
            background: ROOM.wall,
            border: `1px solid ${isDragging ? ROOM.accent : ROOM.hairline}`,
          }}
        >
          {board.thumbnailUrl || board.fullImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={board.thumbnailUrl || board.fullImageUrl}
              alt={sheetLabel(board, index)}
              loading="lazy"
              draggable={false}
              className="w-full h-full object-contain"
            />
          ) : (
            <span className="text-[10px] uppercase tracking-[0.14em]" style={headerStyle}>
              No preview
            </span>
          )}

          {showPosition && (
            <span
              className="absolute top-2 left-2 text-[10px] px-1.5 py-0.5 rounded-full tabular-nums"
              style={{ fontFamily: MONO_STACK, background: ROOM.ink, color: ROOM.wall }}
            >
              {String(index + 1).padStart(2, '0')}
            </span>
          )}
        </div>
        <p className="mt-2 text-[12px] truncate" style={{ color: ROOM.ink, fontFamily: SANS_STACK }}>
          {sheetLabel(board, index)}
        </p>
        {labelOwner && (
          <p className="text-[10px] uppercase tracking-[0.12em] truncate" style={headerStyle}>
            {boardAuthorName(board) || 'Unattributed'}
          </p>
        )}
      </button>
    </div>
  )
}
