/**
 * Room palette, shared by the 3D scene and every 2D room surface.
 *
 * Matches the pinspace design-system reference: a warm paper/ink
 * architectural palette with a single blue accent. ACCENT IS ACTIVE STATE
 * ONLY — it marks the selected student, the current wall in the compass, and
 * the active revision node — never a wall, a floor, or the field behind a
 * board. REDLINE marks instructor comments specifically, nothing else.
 * Architecture sheets are white with black linework and a saturated ground
 * fights them.
 *
 * No green: the previous palette used it as a generic "identity" accent for
 * owner names and wall tags. The reference sets that text in plain ink
 * instead, so it's retired rather than re-mapped — see room-restyle notes in
 * the components that read this.
 */
export const ROOM = {
  /** Pin-up wall / card surface. */
  wall: '#FBFCFE',
  /** Floor base tone (gradient center stop — see RoomStage's floor). */
  floor: '#D8DEEA',
  /** Room void / page background behind the walls. */
  background: '#EDF1F9',
  /** Primary text, linework, borders on active elements. */
  ink: '#16181D',
  /** Secondary/muted text — labels, captions, inactive chrome. */
  ink2: '#8A8FA0',
  /** The one accent color. Active/selected state only. */
  accent: '#3B6EF6',
  /** Instructor comment markers only. */
  redline: '#C2452D',
  /** Borders and separators. */
  hairline: '#DCE2ED',
  /** Flat neutral chip background (roster avatars, icon buttons at rest). */
  chip: '#E7EBF3',
} as const

/** Monospace stack for sheet numbers, wall labels and the revision strip. */
export const MONO_STACK = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"

/** Sans stack for names and other identity text — the app's ambient Onest. */
export const SANS_STACK = "'Onest', system-ui, sans-serif"
