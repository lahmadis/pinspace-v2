import type { Board } from '@/types'

/**
 * Per-room slideshow ordering for the lightbox.
 *
 * The boards APIs order by `uploaded_at DESC` and that ORDER BY is left alone —
 * the 3D room, the 2D wall editor and the sidebar all keep consuming the array
 * exactly as the server returns it. Only the lightbox's prev/next sequence (and
 * therefore its "06 / 07" counter) is re-derived through the comparator below,
 * off the `boards.sort_order` column.
 *
 * Sorting the array is safe for the lightbox specifically because nothing about
 * board placement is index-derived: WallSystem selects boards by
 * `position.wallIndex`, computes coordinates from `position.x/y/side`, and keys
 * children by `localId || id`. See the read-only survey in the commit that
 * introduced this file.
 */

// Sentinel rank for "no usable value" — sorts last within its comparison step.
// Compared with < / > rather than subtraction so Infinity - Infinity (NaN) can
// never leak into the comparator and make the sort non-deterministic.
const LAST = Number.POSITIVE_INFINITY

/**
 * Slideshow rank. A board with no sort_order (null in the DB, or a row from a
 * client-side optimistic insert that has never been persisted) ranks last, so a
 * board that hasn't been given a slot yet lands at the end of the sequence
 * instead of jumping to the front.
 */
function orderRank(b: Board): number {
  const v = b.sortOrder
  return typeof v === 'number' && Number.isFinite(v) ? v : LAST
}

/**
 * Upload time as a timestamp. `Board.uploadedAt` is typed `Date` but every API
 * route serializes it as an ISO string, and optimistic temp boards construct a
 * real `Date` — so both shapes reach this function and both must work. Anything
 * unparseable ranks last and falls through to the id tiebreaker.
 */
function uploadedRank(b: Board): number {
  const raw: unknown = b.uploadedAt
  if (raw == null) return LAST
  const t = raw instanceof Date ? raw.getTime() : new Date(raw as string | number).getTime()
  return Number.isFinite(t) ? t : LAST
}

/**
 * Total order over boards: sort_order ascending (nulls last), then upload time
 * ascending, then id ascending.
 *
 * The id tiebreaker is what makes this fully deterministic — without it two
 * boards sharing a sort_order (or both null with identical timestamps, which a
 * multi-page PDF upload produces) could swap places between renders and the
 * lightbox counter would jump around.
 */
export function compareBoardOrder(a: Board, b: Board): number {
  const ao = orderRank(a)
  const bo = orderRank(b)
  if (ao !== bo) return ao < bo ? -1 : 1

  const at = uploadedRank(a)
  const bt = uploadedRank(b)
  if (at !== bt) return at < bt ? -1 : 1

  if (a.id !== b.id) return a.id < b.id ? -1 : 1
  return 0
}

/**
 * Sorted copy for the lightbox's `allBoards`. Returns a NEW array — the caller's
 * state array is never mutated, so the identical array instance can keep feeding
 * the 3D scene unchanged.
 *
 * Accepts null/undefined because Gallery3D's per-studio `boards` is optional.
 */
export function orderBoardsForLightbox(boards: readonly Board[] | null | undefined): Board[] {
  if (!Array.isArray(boards)) return []
  return [...boards].sort(compareBoardOrder)
}
