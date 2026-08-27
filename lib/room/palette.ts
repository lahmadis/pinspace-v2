/**
 * Room palette, shared by the 3D scene and every 2D room surface.
 *
 * Matches the pinspace design-system reference: a warm paper/ink
 * architectural palette with a single blue accent. ACCENT MARKS ACTIVE STATE
 * AND ANNOTATION — the selected student, the current wall in the compass, and
 * every callout marker — but never a wall, a floor, or the field behind a
 * board. Architecture sheets are white with black linework and a saturated
 * ground fights them.
 *
 * REDLINE is NOT for comment markers. It used to be, which is why the room
 * shipped red callout bubbles for a while; they now use the accent, because
 * this same red is the app's destructive colour and a red badge read as
 * "something is broken". See the token's own note below.
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
  /**
   * Red pen. NOT callout/comment markers any more — those are `accent` now, in
   * the room, the roster, plan view, the 2D archive and the lightbox pins alike,
   * because this same red is the app's destructive colour (error toasts, delete
   * flows, form errors) and a red pin read as "something is wrong" rather than
   * "someone left a note".
   *
   * Currently referenced only as a literal, by the trace tool's pen swatches in
   * components/LightboxModal.tsx — a deliberate multi-option picker where red is
   * one choice among four, not a status.
   */
  redline: '#C2452D',
  /** Borders and separators. */
  hairline: '#DCE2ED',
  /** Flat neutral chip background (roster avatars, icon buttons at rest). */
  chip: '#E7EBF3',
} as const

/**
 * The 3D scene's sky/horizon color. Deliberately NOT ROOM.background above —
 * that one is the 2D room-void behind the flat surfaces, and these two are
 * tuned separately against different neighbours.
 *
 * Lives here rather than in components/3d/WallSystem.tsx (which re-exports it as
 * ROOM_SKY_COLOR, its long-standing name) because several surfaces outside the
 * 3D tree need it and WallSystem already imports BoardThumbnail, so reaching
 * back into WallSystem would be an import cycle. Ghosting no longer reads this
 * value at all — that is ROOM_GHOST's job now, below.
 *
 * The Canvas background, the scene fog color and the ground plane's fade target
 * must all be this exact value: if the fog color and the background differ at
 * all, the ground plane's own edge shows up as a visible ring instead of an
 * invisible horizon.
 *
 * The floor plate and ground plane are BOTH GONE now (see WallSystem) — the
 * horizon grid draws straight over this colour, with nothing behind it. The
 * fog/background match rule above still stands and is still the reason a
 * mismatch shows as a ring, but there is no ground left to fade into the sky,
 * so this value is now read almost entirely against the walls and that grid.
 *
 * A very light tint of the palette accent (#3B6EF6): white + about 7%.
 *
 * READ THIS BEFORE CHANGING IT. An earlier pass held this at the luminance of
 * the cool grey it replaced, so the sky and the walls were the SAME value,
 * 1.10:1, and the room lost its silhouette against the horizon entirely. The
 * fix at the time was to push the sky well below the walls (28% accent,
 * 1.34:1), which worked but made the room read as a wall standing in front of a
 * coloured backdrop rather than as an airy space.
 *
 * It is now light again — deliberately, and only because the thing that failed
 * last time has been replaced. A wall no longer earns its silhouette from a
 * value step in the sky; it earns it from the soft contact shadow beneath it
 * (WallSystem). That is how the reference this matches does it too: near-white
 * panels on a near-white ground, separated by shadow, not by tone.
 *
 * So the rule is: THIS VALUE AND THE CONTACT SHADOW ARE ONE DECISION. Lighten
 * the sky further and the shadow has to carry more; remove or weaken the shadow
 * and this has to go back down, or the walls dissolve exactly as they did
 * before. Do not tune either one alone — the shadow is now the ONLY thing
 * holding a wall off the horizon, so it has no second line of defence.
 */
export const ROOM_SKY = '#EDF1FB'

/**
 * What an unfocused surface is blended toward when a wall takes focus.
 *
 * This used to be ROOM_SKY itself, on the reasoning that a ghosted wall should
 * fade into the background. That only worked while the sky was clearly darker
 * than the walls. Now that both are near-white, blending a white wall toward a
 * near-white sky is very nearly the identity function, and wall focus would
 * have quietly stopped doing anything visible.
 *
 * A cool grey below both instead, so an unfocused wall recedes by going flat
 * and slightly grey rather than by matching the horizon. Kept close enough in
 * hue that ghosting reads as depth rather than as a colour change.
 */
export const ROOM_GHOST = '#D3DCEC'

/** Monospace stack for sheet numbers, wall labels and the revision strip. */
export const MONO_STACK = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"

/** Sans stack for names and other identity text — the app's ambient Onest. */
export const SANS_STACK = "'Onest', system-ui, sans-serif"

/**
 * Onest for text rendered INSIDE the 3D canvas (drei's <Text>, i.e. troika).
 *
 * Troika can't read a CSS font stack like SANS_STACK above — it needs an actual
 * font file it can parse into SDF glyphs, and with no `font` prop it silently
 * falls back to its own bundled Roboto. That's why 3D labels used to render in a
 * face that appears nowhere else in the app.
 *
 * MUST BE .ttf/.otf/.woff — NEVER .woff2. troika-three-text (0.52.4) converts
 * woff via woff2otf but hard-rejects woff2 with "woff2 fonts not supported", and
 * the way that fails is vicious rather than obvious: drei's <Text> wraps
 * preloadFont in suspend-react, so an unparseable font never resolves, the
 * component suspends forever, and the nearest boundary — next/dynamic's, up in
 * app/studio/[id]/page.tsx — sits on "Loading space…" indefinitely. It reads
 * like a broken data fetch, not a font problem. A .woff2 here cost a debugging
 * session; don't reintroduce one.
 *
 * Self-hosted rather than pointed at fonts.gstatic.com because those URLs carry
 * a version hash, and a stale one fails silently back to Roboto. Same Onest the
 * Google Fonts CSS in app/globals.css serves the DOM, so 3D labels and the
 * surrounding UI share one typeface. This is the regular (400) static instance;
 * troika has no variable-axis support, which is why the name plates fake their
 * heavier weight with an outline instead.
 */
export const ROOM_FONT_3D = '/fonts/onest-regular.ttf'
