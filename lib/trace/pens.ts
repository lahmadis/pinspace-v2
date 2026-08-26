/**
 * The trace pen: one palette, shared by every surface that draws over work.
 *
 * Imports nothing, like the other shared type modules, so both the lightbox and
 * the desk crit workspace can read it without dragging each other in.
 *
 * There are two annotation implementations in this app and that is deliberate
 * (see docs/KNOWN_BUGS.md §8): the lightbox marks a `boards` row through its
 * own API routes, the crit workspace marks a `canvas_nodes` image. They cannot
 * share their storage without turning crit work into boards. They CAN share
 * what the pen looks like, and that is the part a user would notice drifting —
 * a red that is a slightly different red on the other screen reads as a bug.
 */

/**
 * Four pens. Red first because it is the one people reach for.
 *
 * Note ROOM.redline is this same red, and the palette's own note says it is
 * "the app's destructive colour". That is fine HERE and only here: as one
 * choice among four it reads as a pen, not as a status.
 */
// Typed as string[], NOT `as const`: with a literal tuple type,
// `useState(TRACE_COLORS[0])` infers the single literal '#C2452D' and every
// other pen becomes a type error at the point of selection.
export const TRACE_COLORS: readonly string[] = ['#C2452D', '#B08430', '#4E9F8F', '#3B6EF6']

/**
 * Pen weights as a FRACTION of the board's width.
 *
 * The lightbox draws to a canvas and multiplies these by the rendered size, so
 * a stroke keeps its weight relative to the drawing however the window is
 * sized. Anything rendering these in a unit that does not scale with the board
 * — an SVG with `vectorEffect="non-scaling-stroke"`, say — must convert rather
 * than pass the number through: 0.004 as a raw pixel width is an invisible
 * hairline. See tracePx below.
 */
export const TRACE_WIDTHS: Array<{ label: string; value: number }> = [
  { label: 'Thin', value: 0.004 },
  { label: 'Thick', value: 0.01 },
]

/**
 * A fractional pen weight as pixels, for a surface that strokes in pixels.
 *
 * `boardWidthPx` is how wide the drawing is on screen right now. The floor
 * keeps a thin pen visible on a small thumbnail, where the true fraction would
 * round to something you cannot see.
 */
export function tracePx(fraction: number, boardWidthPx: number): number {
  return Math.max(1.5, fraction * boardWidthPx)
}
