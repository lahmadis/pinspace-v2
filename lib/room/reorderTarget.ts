/**
 * Map "the user dropped this card here" onto the position POST
 * /api/boards/reorder wants.
 *
 * Why this isn't just `newIndex + 1`: sort_order is ROOM-WIDE (the route pulls
 * every board in the room, splices, and renumbers 1..N), but a drag can happen
 * inside a filtered grid — one student's four sheets out of the room's
 * eighteen. Sending the subset index would move the board to that slot in the
 * whole room, which is a different board's place entirely.
 *
 * So the drop is resolved by NEIGHBOUR rather than by index: whatever card the
 * moved one now sits behind in the visible list, it must sit immediately behind
 * that same card in the room's list. Everyone else keeps their relative order,
 * because a splice never reorders the rows it doesn't touch.
 *
 * When the visible list IS the whole room this degrades to exactly newIndex + 1.
 */
export function reorderTargetPosition(
  /** Every board id in the room, in current slideshow order. */
  globalIds: readonly string[],
  /** The ids actually on screen, in current display order (may be a subset). */
  displayIds: readonly string[],
  /** The id being dragged. */
  activeId: string,
  /** Where it landed in the DISPLAY list, 0-based. */
  newDisplayIndex: number,
): number | null {
  if (!globalIds.includes(activeId)) return null

  // Both lists with the dragged card pulled out — the same state the route
  // computes before it re-inserts, so indices line up with what it will do.
  const globalWithout = globalIds.filter((id) => id !== activeId)
  const displayWithout = displayIds.filter((id) => id !== activeId)

  // Anchor on the card the moved one now follows. That's the one whose place in
  // the room's order actually pins it down.
  const beforeId = newDisplayIndex > 0 ? displayWithout[newDisplayIndex - 1] : undefined
  if (beforeId !== undefined) {
    const idx = globalWithout.indexOf(beforeId)
    if (idx === -1) return null
    // +2, not +1: idx is 0-based, and we want the slot AFTER it.
    return idx + 2
  }

  // Dropped at the head of the visible list: take the slot of whatever used to
  // be first there, so it lands ahead of its own group without jumping over
  // unrelated boards that happen to sort earlier in the room.
  const afterId = displayWithout[0]
  if (afterId === undefined) return 1
  const idx = globalWithout.indexOf(afterId)
  if (idx === -1) return null
  return idx + 1
}
