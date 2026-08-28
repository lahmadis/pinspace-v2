/**
 * The studios a section can belong to.
 *
 * A STUDIO is a taxonomy level, not a row. Nothing is created when a studio
 * gains its first section and nothing is deleted when it loses its last — the
 * list below is the whole definition. That is deliberate: a department runs the
 * same eight studios every year plus the two standing ones, so making them rows
 * would mean provisioning ten records per department per term that carry no
 * information the string doesn't.
 *
 * What IS a row is the section — a `workspaces` record whose
 * `network_metadata.studio` holds one of these values. So the network reads
 * department → year → studio → sections, and the studio level is a GROUP BY
 * rather than a table.
 *
 * These strings are STORED VALUES inside workspaces.network_metadata. Renaming
 * one orphans every section already filed under it, exactly as with YEAR_LEVELS
 * in ./departments. Add to the end; don't rewrite.
 *
 * Zero-padded so 'Studio 02' sorts before 'Studio 10' as plain text — the
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
] as const

export type Studio = (typeof STUDIOS)[number]

export function isStudio(value: unknown): value is Studio {
  return typeof value === 'string' && (STUDIOS as readonly string[]).includes(value)
}

/**
 * URL slug for a studio, e.g. 'Studio 01' -> 'studio-01', 'Thesis Studio' ->
 * 'thesis-studio'. Same shape as departmentSlug in ./departments so the explore
 * route segments read consistently.
 */
export function studioSlug(name: Studio): string {
  return name.toLowerCase().replace(/\s+/g, '-')
}

export function studioFromSlug(slug: string): Studio | null {
  return STUDIOS.find((s) => studioSlug(s) === slug) ?? null
}
