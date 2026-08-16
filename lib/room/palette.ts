/**
 * Room palette, shared by the 3D scene and every 2D room surface.
 *
 * YELLOW IS ACTIVE STATE ONLY. It marks the selected student, the current wall
 * in the minimap, and the active revision node — never a wall, a floor, or the
 * field behind a board. Architecture sheets are white with black linework and a
 * saturated ground fights them.
 */
export const ROOM = {
  wall: '#FFFCF0',
  floor: '#D8D3C6',
  background: '#EDE9DE',
  ink: '#0B0B0B',
  green: '#14705C',
  yellow: '#FFC800',
  redline: '#C0392B',
  hairline: '#C9C3B4',
} as const

/** Monospace stack for sheet numbers, wall labels and the revision strip. */
export const MONO_STACK = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
