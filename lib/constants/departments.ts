/**
 * Canonical department and year-level lists.
 *
 * CLAUDE.md requires department lists to import from this file rather than
 * defining a local copy. The file did not exist when that rule was written, so
 * the list is currently duplicated across several surfaces (the explore pages
 * and API, the publish modal, and the union type in types/index.ts). New code
 * imports from here; consolidating the existing copies is a separate pass —
 * they touch the explore and publish flows and should not ride along with an
 * unrelated feature.
 *
 * Both lists live together because they travel together: workspaces
 * .network_metadata is `{ department, year }`, and neither half is meaningful
 * on its own.
 */

/**
 * The three design departments pinspace is for.
 *
 * Narrowed from eight — the five engineering entries went. Safe to remove
 * outright rather than deprecate: every populated workspaces.network_metadata
 * row is 'Architecture', so nothing stored referenced them. (user_profiles
 * .major does hold engineering values, but it is free text and has never read
 * this list.)
 */
export const DEPARTMENTS = [
  'Architecture',
  'Interior Design',
  'Industrial Design',
] as const

export type Department = (typeof DEPARTMENTS)[number]

/**
 * Student year level, the `year` half of network_metadata.
 *
 * These strings are STORED VALUES, not display text, and they must not be
 * renamed. They sit in user_profiles.year (21 rows) and workspaces
 * .network_metadata (7), they are the /explore/[department]/[year] URL slugs
 * ('year-1', 'masters'), and they key the year-colour maps on the explore
 * pages. Renaming them here would orphan every one of those at once.
 *
 * What the reader sees comes from YEAR_LABELS below.
 */
export const YEAR_LEVELS = [
  'Year 1',
  'Year 2',
  'Year 3',
  'Year 4',
  'Year 5',
  'Masters',
] as const

export type YearLevel = (typeof YEAR_LEVELS)[number]

/**
 * Display text for each stored year value. Architecture runs five years, so
 * Year 5 keeps a numeric name — there is no fifth class year to name it after.
 */
export const YEAR_LABELS: Record<YearLevel, string> = {
  'Year 1': 'Freshman',
  'Year 2': 'Sophomore',
  'Year 3': 'Junior',
  'Year 4': 'Senior',
  'Year 5': 'Fifth year',
  'Masters': 'Masters',
}

/**
 * Label for a stored year value, falling back to the value itself. The
 * fallback matters: a profile written before this list existed still renders
 * as something rather than as a blank option.
 */
export function yearLabel(value: string): string {
  return (YEAR_LABELS as Record<string, string>)[value] ?? value
}

/**
 * The same label, for a value that may not be the stored string.
 *
 * The explore API does not send 'Year 2' — it parses the digit out of the
 * stored value and sends the NUMBER 2, with 'Masters' as the one string
 * exception (see yearNum in app/api/explore/studios/route.ts). So the network
 * was left rebuilding "Year 2" by hand and drawing that on the bubble, while
 * every form that WROTE the value showed "Sophomore". One value, two names,
 * depending on which screen you were standing on.
 *
 * Takes 2, '2', 'Year 2' or 'Masters' and returns what the section settings
 * called it. Anything unrecognised falls through to yearLabel, which returns
 * the value itself rather than a blank.
 */
export function gradeLabel(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return 'Unknown'
  const raw = String(value).trim()
  return yearLabel(/^\d+$/.test(raw) ? `Year ${raw}` : raw)
}

export function isDepartment(value: unknown): value is Department {
  return typeof value === 'string' && (DEPARTMENTS as readonly string[]).includes(value)
}

export function isYearLevel(value: unknown): value is YearLevel {
  return typeof value === 'string' && (YEAR_LEVELS as readonly string[]).includes(value)
}

/**
 * URL slug for a department, e.g. 'Interior Design' -> 'interior-design'.
 * Matches the slugs the explore routes already hardcode, so those copies can
 * be folded into this file later without changing any URL.
 */
export function departmentSlug(name: Department): string {
  return name.toLowerCase().replace(/\s+/g, '-')
}

export function departmentFromSlug(slug: string): Department | null {
  return DEPARTMENTS.find((d) => departmentSlug(d) === slug) ?? null
}
