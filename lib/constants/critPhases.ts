/**
 * The phases of a project a desk crit can be about.
 *
 * A crit is not the same conversation at every point in a project — precedent
 * work is read differently from a massing study, and "what stage was this?" is
 * the first thing you ask looking back at a term of them. The date alone does
 * not answer it: two crits a week apart can sit either side of a phase change.
 *
 * ORDERED BY WHEN THEY HAPPEN, not alphabetically, because the dropdown is read
 * as a sequence — someone picking "Massing studies" is looking for it after
 * Concept, not between "Final review" and "Model making".
 *
 * These are STORED VALUES on canvases.phase. Renaming one orphans every crit
 * already filed under it, exactly as with STUDIOS and YEAR_LEVELS. Add to the
 * end of the list you want it to appear in; don't rewrite.
 *
 * Free text in the database rather than a CHECK constraint or an enum,
 * deliberately: this list will grow — the brief that produced it ended in
 * "etc." — and a new phase should be one line here, not a migration. Same call
 * ./departments and ./studios make.
 *
 * This list is the SUGGESTIONS, not the whole vocabulary: the card's phase
 * dropdown has an "Other…" entry that stores whatever you type. See
 * normaliseCritPhase below for what the API does and does not let through.
 */
export const CRIT_PHASES = [
  'Precedent',
  'Site analysis',
  'Concept',
  'Massing studies',
  'Schematic design',
  'Sketching',
  'Model making',
  'Design development',
  'Detailing',
  'Final review',
] as const

export type CritPhase = (typeof CRIT_PHASES)[number]

export function isCritPhase(value: unknown): value is CritPhase {
  return typeof value === 'string' && (CRIT_PHASES as readonly string[]).includes(value)
}

/**
 * How long a phase someone typed themselves may be.
 *
 * Sized against the list above — "Design development" is 18 characters — with
 * room for a studio's own wording ("Interim pin-up with the consultants"), and
 * short enough that the label still reads as a heading on a card rather than a
 * sentence wrapping over three lines.
 */
export const MAX_CRIT_PHASE_LENGTH = 60

/**
 * Clean up a phase for storage, whether it came from the list or from someone
 * typing their own.
 *
 * The list above is the set of phases we SUGGEST, not the set that exists. A
 * studio runs the crits it runs — "Interim pin-up", "Thesis prep", "Portfolio
 * review" — and refusing those meant the only honest answer was to file the
 * crit under a phase it wasn't. So free text is accepted, with two guards:
 *
 * - Whitespace collapsed and trimmed, so "Site  analysis " and "Site analysis"
 *   are not two buckets.
 * - Matched case-insensitively against the known list FIRST, and stored in the
 *   list's spelling when it hits. Someone typing "final review" into the Other
 *   box means the phase that is already there; storing it verbatim would split
 *   the filter into two entries that read identically.
 *
 * Returns null for anything that isn't usable text — the caller decides whether
 * that is a 400 or a fallback to DEFAULT_CRIT_PHASE.
 */
export function normaliseCritPhase(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value.replace(/\s+/g, ' ').trim()
  if (!cleaned) return null
  const known = CRIT_PHASES.find((phase) => phase.toLowerCase() === cleaned.toLowerCase())
  return known ?? cleaned.slice(0, MAX_CRIT_PHASE_LENGTH)
}

/**
 * The phase a new crit opens on.
 *
 * Not null: a crit with no phase is the state this exists to prevent, and
 * asking someone to pick before they have typed a title is the fastest way to
 * get everything filed under whatever is first in the list anyway. Concept is
 * the honest middle — early enough to be usual, specific enough to be worth
 * correcting.
 */
export const DEFAULT_CRIT_PHASE: CritPhase = 'Concept'
