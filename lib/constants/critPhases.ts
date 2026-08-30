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
 * "etc." — and a new phase should be one line here, not a migration. The API
 * validates against this same array, so the constraint is real, it just lives
 * where it can change cheaply. Same call ./departments and ./studios make.
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
 * The phase a new crit opens on.
 *
 * Not null: a crit with no phase is the state this exists to prevent, and
 * asking someone to pick before they have typed a title is the fastest way to
 * get everything filed under whatever is first in the list anyway. Concept is
 * the honest middle — early enough to be usual, specific enough to be worth
 * correcting.
 */
export const DEFAULT_CRIT_PHASE: CritPhase = 'Concept'
