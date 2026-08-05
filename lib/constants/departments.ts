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

export const DEPARTMENTS = [
  'Aerospace Engineering',
  'Architecture',
  'Civil Engineering',
  'Electrical Engineering',
  'Industrial Design',
  'Interior Design',
  'Mechanical Engineering',
  'Robotics Engineering',
] as const

export type Department = (typeof DEPARTMENTS)[number]

/** Student year level, the `year` half of network_metadata. */
export const YEAR_LEVELS = [
  'Year 1',
  'Year 2',
  'Year 3',
  'Year 4',
  'Year 5',
  'Masters',
] as const

export type YearLevel = (typeof YEAR_LEVELS)[number]

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
