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
