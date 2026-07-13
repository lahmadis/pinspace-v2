/**
 * Board size, in absolute inches, independent of any wall.
 *
 * Board size used to be stored as a percentage of the wall and multiplied by
 * the live wall dimensions at render time, so resizing a wall distorted every
 * board on it. Size is now an absolute inch value (board_width_in /
 * board_height_in). These helpers resolve that size, with a fallback chain for
 * boards uploaded before the column existed (mirrors migration 025's backfill).
 */

import { Board } from '@/types'

/** Default size for a board with no usable dimension data: square, 36" sides. */
const DEFAULT_LARGER_DIM_IN = 36

interface SizeSource {
  aspectRatio?: number | null   // width / height (>= 1 landscape, < 1 portrait)
  physicalWidth?: number | null // inches
  physicalHeight?: number | null // inches
}

/**
 * Compute absolute board size in inches from raw source data, in priority order:
 *   1. physical width AND height -> use them directly (true real-world inches)
 *   2. aspect ratio -> scale so the larger dimension = 36"
 *   3. neither -> 36 x 36
 */
export function boardSizeInchesFromSource(src: SizeSource): { widthIn: number; heightIn: number } {
  const { aspectRatio, physicalWidth, physicalHeight } = src

  if (physicalWidth != null && physicalHeight != null && physicalWidth > 0 && physicalHeight > 0) {
    return { widthIn: physicalWidth, heightIn: physicalHeight }
  }

  const ar = aspectRatio != null && Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1
  return ar >= 1
    ? { widthIn: DEFAULT_LARGER_DIM_IN, heightIn: DEFAULT_LARGER_DIM_IN / ar } // landscape: width is larger
    : { widthIn: DEFAULT_LARGER_DIM_IN * ar, heightIn: DEFAULT_LARGER_DIM_IN } // portrait: height is larger
}

/**
 * Resolve a board's absolute render size in inches. Prefers the stored
 * board_width_in / board_height_in; falls back to physical / aspect-ratio data
 * for boards not yet backfilled.
 */
export function getBoardSizeInches(board: Board): { widthIn: number; heightIn: number } {
  if (
    board.boardWidthIn != null && board.boardHeightIn != null &&
    board.boardWidthIn > 0 && board.boardHeightIn > 0
  ) {
    return { widthIn: board.boardWidthIn, heightIn: board.boardHeightIn }
  }
  return boardSizeInchesFromSource({
    aspectRatio: board.aspectRatio,
    physicalWidth: board.physicalWidth,
    physicalHeight: board.physicalHeight,
  })
}

/** A named real-world sheet size, in inches. Used by the manual board-size picker. */
export interface SheetSizePreset {
  label: string
  widthIn: number
  heightIn: number
}

/**
 * Common architecture/design sheet sizes for the manual board-size control.
 * ARCH + ISO A-series, portrait dimensions (width < height); the picker fits the
 * image within these preserving its own aspect, so orientation is handled there.
 */
export const SHEET_SIZE_PRESETS: SheetSizePreset[] = [
  { label: '24 × 36', widthIn: 24, heightIn: 36 },
  { label: '30 × 42', widthIn: 30, heightIn: 42 },
  { label: '36 × 42', widthIn: 36, heightIn: 42 },
  { label: '36 × 48', widthIn: 36, heightIn: 48 },
  { label: 'A1', widthIn: 23.4, heightIn: 33.1 },
  { label: 'A0', widthIn: 33.1, heightIn: 46.8 },
]

/**
 * Largest rectangle with the given aspect ratio (width/height) that fits inside
 * a sheet of sheetW × sheetH inches. Used when applying a sheet preset so the
 * image is fit within the sheet rather than distorted to fill it. Both sheet
 * orientations are considered so a portrait image on a portrait sheet fills it.
 */
export function fitBoardWithinSheet(
  aspectRatio: number | null | undefined,
  sheetW: number,
  sheetH: number,
): { widthIn: number; heightIn: number } {
  const ar = aspectRatio != null && Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : sheetW / sheetH
  let widthIn = sheetW
  let heightIn = sheetW / ar
  if (heightIn > sheetH) {
    heightIn = sheetH
    widthIn = sheetH * ar
  }
  return { widthIn, heightIn }
}

/**
 * How much we actually KNOW about a board's real-world size, for honest UI:
 *   'true'    — physical dimensions were captured (PDF points/72) and the
 *               rendered size still matches them.
 *   'set'     — a human set the size explicitly (overrides physical, or a
 *               manual size on an image that has no physical data).
 *   'assumed' — no physical data; the size is the aspect-ratio-derived 36"
 *               default. A test-fit against this is a guess, not a measurement.
 */
export type BoardSizeProvenance = 'true' | 'set' | 'assumed'

function approxEqualInches(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(0.5, 0.01 * Math.max(a, b))
}

export function getBoardSizeProvenance(board: Board): BoardSizeProvenance {
  const hasPhysical =
    board.physicalWidth != null && board.physicalHeight != null &&
    board.physicalWidth > 0 && board.physicalHeight > 0
  const { widthIn, heightIn } = getBoardSizeInches(board)

  if (hasPhysical) {
    const matchesTrue =
      approxEqualInches(widthIn, board.physicalWidth as number) &&
      approxEqualInches(heightIn, board.physicalHeight as number)
    return matchesTrue ? 'true' : 'set'
  }

  // No physical data: is the size still the aspect-ratio 36" default, or set?
  const def = boardSizeInchesFromSource({ aspectRatio: board.aspectRatio })
  const matchesDefault = approxEqualInches(widthIn, def.widthIn) && approxEqualInches(heightIn, def.heightIn)
  return matchesDefault ? 'assumed' : 'set'
}

/**
 * Resolved size + provenance for display, e.g. `36 × 42 IN` (true/set) or
 * `36 × 24 IN` with provenance 'assumed' so the caller can append "(assumed)".
 */
export function getBoardSizeDisplay(board: Board): {
  widthIn: number
  heightIn: number
  provenance: BoardSizeProvenance
  label: string
} {
  const { widthIn, heightIn } = getBoardSizeInches(board)
  return {
    widthIn,
    heightIn,
    provenance: getBoardSizeProvenance(board),
    label: `${Math.round(widthIn)} × ${Math.round(heightIn)} IN`,
  }
}
