/**
 * Cross-component registry of board ids that a local optimistic upload is in
 * the middle of reconciling (temp → real swap). The realtime postgres_changes
 * INSERT for a freshly-uploaded board can arrive at the page's channel handler
 * around the same time the uploader's own POST resolves and runs
 * replaceTempBoard. Without coordination the INSERT appends the real board
 * while the temp still exists, so the boards array briefly holds the same id
 * twice (the logged "rebuild listed the real id twice" race).
 *
 * useBoardState.replaceTempBoard marks the real id here on swap; the studio
 * page's INSERT handler checks it and skips appending. Entries self-expire so
 * a crashed/aborted upload can't wedge an id out of the array forever. This is
 * module-level shared state on purpose — the producer (useBoardState, inside
 * StudioRoom) and the consumer (the page's realtime handler) are different
 * components with no prop channel between them.
 */

const DEFAULT_TTL_MS = 60_000

const reconciling = new Map<string, number>() // boardId -> expiry epoch ms

export function markBoardReconciling(boardId: string, ttlMs: number = DEFAULT_TTL_MS): void {
  reconciling.set(boardId, Date.now() + ttlMs)
}

export function isBoardReconciling(boardId: string): boolean {
  const expiry = reconciling.get(boardId)
  if (expiry == null) return false
  if (expiry < Date.now()) {
    reconciling.delete(boardId)
    return false
  }
  return true
}

export function clearBoardReconciling(boardId: string): void {
  reconciling.delete(boardId)
}
