/**
 * The classes a section can belong to.
 *
 * NAMED "STUDIO" IN CODE, "CLASS" IN THE UI, and the split is deliberate. Every
 * identifier here — STUDIOS, isStudio, studioSlug, and above all the stored
 * `network_metadata.studio` key — is a wire/storage name that thousands of rows
 * and every explore URL already depend on. The user-facing label for the level
 * is "Class", because the list stopped being studios-only: a studio is one KIND
 * of class, alongside the media and representation courses below. Renaming the
 * identifiers would be a migration, not a rename; renaming the labels is free.
 *
 * A CLASS is a taxonomy level, not a row. Nothing is created when one gains its
 * first section and nothing is deleted when it loses its last — the list below
 * is the whole definition. That is deliberate: a department runs the same
 * classes every year, so making them rows would mean provisioning a record per
 * department per term that carries no information the string doesn't.
 *
 * What IS a row is the section — a `workspaces` record whose
 * `network_metadata.studio` holds one of these values. So the network reads
 * department → year → class → sections, and the class level is a GROUP BY
 * rather than a table.
 *
 * These strings are STORED VALUES inside workspaces.network_metadata. Renaming
 * one orphans every section already filed under it, exactly as with YEAR_LEVELS
 * in ./departments. Add to the end; don't rewrite.
 *
 * Array order IS display order — app/explore sorts on STUDIOS.indexOf — so the
 * numbered studios stay first and anything appended lands after them. They are
 * zero-padded so 'Studio 02' sorts before 'Studio 10' as plain text, since the
 * explore queries group on this column and would otherwise need a numeric
 * extraction to order the drill-down correctly.
 */
export const STUDIOS = [
  'Studio 01',
  'Studio 02',
  'Studio 03',
  'Studio 04',
  'Studio 05',
  'Studio 06',
  'Studio 07',
  'Studio 08',
  'Global Research Studio',
  'Thesis Studio',
  'Architectural Media',
  'Architectural Representation',
  'Building Matters',
] as const

export type Studio = (typeof STUDIOS)[number]

export function isStudio(value: unknown): value is Studio {
  return typeof value === 'string' && (STUDIOS as readonly string[]).includes(value)
}

/**
 * URL slug for a class, e.g. 'Studio 01' -> 'studio-01', 'Building Matters' ->
 * 'building-matters'. Same shape as departmentSlug in ./departments so the
 * explore route segments read consistently.
 */
export function studioSlug(name: Studio): string {
  return name.toLowerCase().replace(/\s+/g, '-')
}

export function studioFromSlug(slug: string): Studio | null {
  return STUDIOS.find((s) => studioSlug(s) === slug) ?? null
}
