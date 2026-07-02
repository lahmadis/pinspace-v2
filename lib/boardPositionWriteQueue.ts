/**
 * Per-board serializer for board position/size writes.
 *
 * The move PUT (useBoardState.updateBoardPosition) and the resize PATCH
 * (DraggableBoard) previously fired overlapping, unsequenced requests for the
 * same board, so rapid successive edits could commit out of order (the DB
 * settled on whichever request finished last, not the one issued last). This
 * chains writes PER board id: a new write for a board waits for the previous
 * write to that board to settle before its request is dispatched, so same-board
 * writes always commit in issue order. Writes for DIFFERENT boards keep their
 * own independent chains and stay fully parallel.
 *
 * The chain does NOT swallow the task's result/rejection — the returned promise
 * resolves/rejects exactly like the wrapped `fetch`, so callers keep their
 * existing response-check / rollback / toast behavior. A failed write does not
 * wedge the chain: the next write runs regardless of the previous outcome.
 */

// One promise chain per board id. The stored value is a "tail" that never
// rejects, so the next write's wait always proceeds.
const chains = new Map<string, Promise<unknown>>()

export function enqueueBoardWrite<T>(boardId: string, task: () => Promise<T>): Promise<T> {
  const prev = chains.get(boardId) ?? Promise.resolve()
  // Run the task once the previous write has settled (success OR failure), so
  // one failed write never blocks subsequent writes for the same board.
  const run = prev.then(task, task)
  // Tail resolves after `run` settles and never rejects — this is what the next
  // enqueue waits on, so a rejected write can't poison the chain.
  const tail = run.then(() => {}, () => {})
  chains.set(boardId, tail)
  // Best-effort cleanup: drop the entry once this write drains, unless a newer
  // write has already been queued behind it (then our tail is no longer current).
  void tail.then(() => {
    if (chains.get(boardId) === tail) chains.delete(boardId)
  })
  return run
}
