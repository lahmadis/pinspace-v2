/**
 * Section naming.
 *
 * A section's name is GENERATED, never typed: "Section 03 - Lahmadi". The
 * instructor supplies a number and their full name and the convention does the
 * rest, so the roster of a studio reads as one list instead of ten differently
 * spelled ones. Both the create dialog's live preview and the server's own
 * write go through `formatSectionName`, so the two can't disagree about what
 * the name should be.
 */

/** Two digits, so 'Section 03' sorts next to 'Section 10' as plain text. */
export const SECTION_NUMBER_PATTERN = /^\d{1,2}$/

/**
 * '3' -> '03', '03' -> '03', '0' / '100' / 'x' -> null.
 *
 * Zero is rejected along with the non-numerics: there is no Section 00, and
 * silently padding it to '00' would file a real section under a name nobody
 * would look for.
 */
export function normalizeSectionNumber(raw: string): string | null {
  const trimmed = raw.trim()
  if (!SECTION_NUMBER_PATTERN.test(trimmed)) return null
  const n = Number(trimmed)
  if (n < 1) return null
  return String(n).padStart(2, '0')
}

/**
 * The surname to hang the section name on.
 *
 * Everything before the first comma, then that fragment's last whitespace-
 * separated word. The two-step handles both orders people actually type:
 * "Lahmadi, Sarah" -> "Lahmadi" (comma-first surname) and
 * "Sarah Lahmadi, AIA" -> "Lahmadi" (trailing credential). Taking the last
 * token alone would return "Sarah" for the first and "AIA" for the second.
 *
 * A trailing generational suffix ("Sarah Lahmadi Jr.") is NOT handled — it
 * would need a list of suffixes, and the instructor can always re-type their
 * name without it.
 */
export function instructorLastName(fullName: string): string {
  const beforeComma = fullName.split(',')[0]?.trim() ?? ''
  if (!beforeComma) return fullName.trim()
  const parts = beforeComma.split(/\s+/).filter(Boolean)
  return parts[parts.length - 1] ?? beforeComma
}

/**
 * The canonical section name. Returns null when either half is unusable, so a
 * caller can't accidentally persist "Section  - " for a blank name.
 */
export function formatSectionName(
  sectionNumber: string,
  instructorFullName: string
): string | null {
  const number = normalizeSectionNumber(sectionNumber)
  if (!number) return null
  const last = instructorLastName(instructorFullName)
  if (!last) return null
  return `Section ${number} - ${last}`
}
