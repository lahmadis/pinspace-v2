/**
 * Room palette, shared by the 3D scene and every 2D room surface.
 *
 * Matches the reference prototype (pinspace-prototype.html): a warm paper/ink
 * architectural palette. AMBER IS ACTIVE STATE ONLY — it marks the selected
 * student, the current wall in the compass, and the active revision node —
 * never a wall, a floor, or the field behind a board. REDLINE marks
 * instructor comments specifically, nothing else. Architecture sheets are
 * white with black linework and a saturated ground fights them.
 *
 * No green: the previous palette used it as a generic "identity" accent for
 * owner names and wall tags. The reference sets that text in plain ink
 * instead, so it's retired rather than re-mapped — see room-restyle notes in
 * the components that read this.
 */
export const ROOM = {
  /** Pin-up wall / card surface. */
  wall: '#FBFAF6',
  /** Floor base tone (gradient center stop — see RoomStage's floor). */
  floor: '#E4DFD4',
  /** Room void / page background behind the walls. */
  background: '#EAE6DD',
  /** Primary text, linework, borders on active elements. */
  ink: '#211F1B',
  /** Secondary/muted text — labels, captions, inactive chrome. */
  ink2: '#6E695F',
  /** The one accent color. Active/selected state only. */
  amber: '#DE9A1F',
  /** Instructor comment markers only. */
  redline: '#C23B2A',
  /** Borders and separators. */
  hairline: '#D8D2C5',
  /** Flat neutral chip background (roster avatars, icon buttons at rest). */
  chip: '#E3DDD0',
} as const

/** Monospace stack for sheet numbers, wall labels and the revision strip. */
export const MONO_STACK = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"

/** Sans stack for names and other identity text — distinct from the app's ambient Inter. */
export const SANS_STACK = "'Archivo', system-ui, sans-serif"
