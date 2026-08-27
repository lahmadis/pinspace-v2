/**
 * Per-organization branding for the dashboard.
 *
 * Keyed by organizations.slug. Three orgs exist today — Wentworth (wit), Sasaki
 * Foundation, and New York School of Interior Design — and only Wentworth has
 * artwork, so everything here is OPTIONAL and the dashboard falls back to its
 * neutral blue treatment for an org with no entry. That fallback is the point:
 * branding the dashboard for Wentworth alone would put a leopard and gold on
 * the other two.
 *
 * Not read from organizations.logo_url, which exists on the table but is null
 * for all three rows and is a single URL. The header needs a wide wordmark, the
 * cards and sidebar need a square mark, and the accent has to be a real colour
 * token — one nullable text column cannot carry that. If logo_url is ever
 * populated it should override `wordmark` here rather than replace this file.
 */

export interface OrgBrand {
  /** Wide lockup for the dashboard header. */
  wordmark: string
  /** Square/circular mark for the sidebar, cards and org switcher. */
  mark: string
  /** Accessible alt text for the wordmark — it carries the org's full name. */
  wordmarkAlt: string
  /** The org's own accent, used for active nav, the network card and CTAs. */
  accent: string
  /** A wash of the accent, for tinted surfaces and active rows. */
  accentSoft: string
  /** Accent tone dark enough to sit as text/iconography on `accentSoft`. */
  accentInk: string
}

const ORG_BRANDS: Record<string, OrgBrand> = {
  wit: {
    wordmark: '/orgs/wit/wordmark.png',
    mark: '/orgs/wit/mark.png',
    wordmarkAlt: 'Wentworth Institute of Technology',
    // Wentworth gold. The leopard mark's own field colour, so the accent and
    // the artwork agree rather than the UI framing the logo in a second hue.
    accent: '#F5A81C',
    accentSoft: '#FEF6E7',
    accentInk: '#8A5A05',
  },
}

export function getOrgBrand(slug: string | null | undefined): OrgBrand | null {
  if (!slug) return null
  return ORG_BRANDS[slug] ?? null
}

/**
 * `#RRGGBB` + alpha -> `rgba(...)`.
 *
 * Exists so branded surfaces can be built ENTIRELY from an OrgBrand. The
 * alternative is what this replaced: a gradient and a shadow with Wentworth's
 * golds written in as literals, on a branch that runs for any branded org — so
 * the second org added here would have got its own accent sandwiched between
 * two Wentworth colours, and would have looked broken rather than unbranded.
 *
 * Returns the input untouched if it is not a 6-digit hex, so a malformed entry
 * degrades to a solid colour rather than to an invalid style string.
 */
export function withAlpha(hex: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return hex
  const n = parseInt(match[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}
