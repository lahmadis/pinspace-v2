/**
 * Month (1–12) at which the academic year rolls over.
 *
 * July, not August. A class created in late July is being set up for the Fall
 * term and genuinely belongs to the coming year, while a room created in May
 * belongs to the year that is ending. The previous August cutoff put a
 * 29-July-2026 creation in 2025-2026, which is wrong for the thing it is for.
 *
 * This is the ONE place the rule lives. It previously existed twice — once here
 * and once inline in academicYearOptions — and the backfill SQL in
 * migrations/032 mirrors it deliberately (see the note in that file).
 */
export const ACADEMIC_YEAR_ROLLOVER_MONTH = 7

/**
 * The academic year a given date falls in, as "YYYY-YYYY".
 *
 * Derived from the date's own month/year, so it is safe to call with a
 * created_at when backfilling as well as with `new Date()` for "now".
 */
export function academicYearFor(date: Date): string {
  const month = date.getMonth() + 1
  const year = date.getFullYear()
  return month >= ACADEMIC_YEAR_ROLLOVER_MONTH ? `${year}-${year + 1}` : `${year - 1}-${year}`
}

export function currentAcademicYear(): string {
  return academicYearFor(new Date())
}

/** Returns N academic years ending with the current one, descending. */
export function academicYearOptions(count = 5): string[] {
  // Derived from currentAcademicYear rather than re-deriving the cutoff, so the
  // picker can never disagree with what the write path stores.
  const startYear = Number(currentAcademicYear().slice(0, 4))
  return Array.from({ length: count }, (_, i) => {
    const y = startYear - i
    return `${y}-${y + 1}`
  })
}
