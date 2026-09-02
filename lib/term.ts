/**
 * The SEMESTER a section runs in — 'Fall 2025', 'Spring 2026', 'Summer 2026'.
 *
 * This replaced the academic year ('2025-2026') as the unit the network files
 * by. An academic year is three semesters wide, so one bubble held Fall's
 * reviews and the following Summer's together — fourteen months of unrelated
 * work behind one label, and no way to ask for "this semester" at all. A
 * semester is the unit a class actually is: it starts, it ends, and the work
 * inside it belongs together.
 *
 * STORED IN `workspaces.academic_year`, WHICH KEEPS ITS NAME. That column, the
 * `academicYear` field on every API payload, and the `academicYear` prop
 * threaded through explore are wire/storage names that dozens of rows and call
 * sites already depend on — the same split lib/constants/studios documents for
 * 'studio' in code vs 'class' in the UI. Renaming them is a schema migration
 * plus a thirty-file sweep; changing what the value MEANS is this file and the
 * four forms that write it. Read `academic_year` as "the term this ran in".
 *
 * So anything that only reads the column back and prints it needed no change —
 * it printed '2025-2026' and now prints 'Fall 2025'. What did need changing is
 * everything that GENERATES, VALIDATES or SORTS the value, and all of that is
 * here.
 */

/**
 * Chronological within a calendar year, which is what makes `ordinal` below a
 * plain number. Array order IS sort order; don't reorder.
 */
export const SEASONS = ['Spring', 'Summer', 'Fall'] as const

export type Season = (typeof SEASONS)[number]

export interface ParsedTerm {
  season: Season
  year: number
}

const TERM_PATTERN = /^(Spring|Summer|Fall)\s+(\d{4})$/

/**
 * Which term a date belongs to, by month:
 *
 *   Jan–Apr → Spring · May–Jun → Summer · Jul–Dec → Fall
 *
 * JULY IS FALL, and that is inherited rather than invented. The academic year
 * this replaced rolled over in July, on the grounds that a class created in
 * late July is being set up for the coming Fall and not wrapping up the spring.
 * Keeping the boundary in the same place means every date still lands in the
 * academic year it used to: Fall Y, Spring Y+1 and Summer Y+1 are exactly the
 * three terms of academic year 'Y-(Y+1)'. That is what lets migrations/046
 * rewrite the stored values without moving a single row into a different year.
 *
 * It answers "what is being set up now", not "what is running today" — which is
 * the question a default needs to answer, since that is all it is used for.
 */
export function termFor(date: Date): string {
  const month = date.getMonth() + 1
  const year = date.getFullYear()
  if (month <= 4) return `Spring ${year}`
  if (month <= 6) return `Summer ${year}`
  return `Fall ${year}`
}

export function currentTerm(): string {
  return termFor(new Date())
}

export function parseTerm(value: unknown): ParsedTerm | null {
  if (typeof value !== 'string') return null
  const match = TERM_PATTERN.exec(value.trim())
  if (!match) return null
  return { season: match[1] as Season, year: Number(match[2]) }
}

/**
 * Whether a value is a term this app would have written.
 *
 * The write paths check this instead of trusting the client: the value becomes
 * a bucket in the explore drill-down, so an unrecognised one opens a bubble no
 * other section can ever be filed into. Same reason isStudio exists.
 */
export function isTerm(value: unknown): value is string {
  return parseTerm(value) !== null
}

/** A term as a single sortable integer. Spring 2026 → 2026*3 + 0. */
function ordinal(term: ParsedTerm): number {
  return term.year * SEASONS.length + SEASONS.indexOf(term.season)
}

function fromOrdinal(n: number): string {
  return `${SEASONS[n % SEASONS.length]} ${Math.floor(n / SEASONS.length)}`
}

/**
 * Newest term first — the order every list of terms in the app wants, since a
 * visitor is far more often after the current semester than one three years
 * back.
 *
 * Terms CANNOT be string-sorted the way academic years could: '2025-2026' <
 * '2026-2027' held for plain text, but 'Fall 2025' sorts after 'Spring 2026'
 * alphabetically while falling before it in time. Every `localeCompare` on a
 * term was replaced by this.
 *
 * Anything unparseable — the 'No semester'/'Undated' buckets these lists carry
 * for rows filed before terms were recorded — sorts LAST, and last in the
 * ascending direction too. That asymmetry is why this is written out rather
 * than being `-compareTerms(a, b)`: negating would float the unfiled bucket to
 * the top of the descending list, which is the one place it must never be.
 */
export function compareTermsDesc(a: string, b: string): number {
  const pa = parseTerm(a)
  const pb = parseTerm(b)
  if (!pa && !pb) return a.localeCompare(b)
  if (!pa) return 1
  if (!pb) return -1
  return ordinal(pb) - ordinal(pa)
}

/** Oldest term first. Same handling of unparseable values — they still sort last. */
export function compareTerms(a: string, b: string): number {
  const pa = parseTerm(a)
  const pb = parseTerm(b)
  if (!pa && !pb) return a.localeCompare(b)
  if (!pa) return 1
  if (!pb) return -1
  return ordinal(pa) - ordinal(pb)
}

/**
 * The terms a picker offers, newest first.
 *
 * `forward` IS THE PART THAT IS NEW, and it exists because the academic year
 * had a trick this doesn't. Its July rollover meant the coming year became the
 * current value from July onward, so a list of "this one and earlier" already
 * covered everything anyone would file — and the admin provisioning route says
 * exactly that in a comment. A semester has no such overlap: an instructor
 * setting up a Spring section does it in November, while Fall is current, and a
 * list that stopped at the current term could not express it. Two ahead is the
 * rest of the academic year when you are standing in Fall.
 *
 * Callers must default to `currentTerm()`, NEVER to `termOptions()[0]` — the
 * first entry is now a future term, and pre-selecting it would file every new
 * section two semesters out.
 */
export function termOptions({ back = 5, forward = 2 }: { back?: number; forward?: number } = {}): string[] {
  const now = parseTerm(currentTerm())
  // currentTerm() is generated by termFor and always parses; the fallback keeps
  // the non-null assertion out of the file rather than guarding a real case.
  if (!now) return []
  const newest = ordinal(now) + forward
  return Array.from({ length: forward + 1 + back }, (_, i) => fromOrdinal(newest - i))
}
