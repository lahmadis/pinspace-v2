'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { SuperadminOrgSwitcher } from './SuperadminOrgSwitcher'
import type { OrgBrand } from '@/lib/constants/orgBranding'
import type { Scope } from './dashboardScope'

/**
 * Identity, then where you are — the left half of every bar in the signed-in
 * product.
 *
 * It was written inside DashboardTopBar and lived only there, so /desk-crits
 * (the one other place these tabs point at) opened on a completely different
 * header: a back arrow, a page title and a subtitle, in a full-bleed white
 * strip with a hard bottom border. Two chromes for two pages one click apart,
 * and the "Desk crits" tab on the dashboard led somewhere that had no tabs to
 * come back by.
 *
 * Extracted rather than copied. The wordmark, the pill shape, the org tint and
 * the order of the tabs are one lockup; a second hand-built copy is a promise
 * that they drift the first time any of it is adjusted.
 */
export function ChromeNav({
  currentScope,
  onScopeChange,
  hasOrganization,
  orgLabel,
  brand,
}: {
  /**
   * The scope tab to light up, or NULL on a page that is not a scope.
   *
   * /desk-crits is that page: it is its own destination, so nothing on the
   * scope side of the bar is current and the Desk crits tab carries the
   * selection instead. Passing 'personal' there would have shown two selected
   * tabs, one of them for a page you are not on.
   */
  currentScope: Scope | null
  /** Picking a scope belongs to /dashboard; callers elsewhere navigate to it. */
  onScopeChange: (scope: Scope) => void
  hasOrganization: boolean
  orgLabel: string
  /** Null for an org with no artwork, and on any tab but the org's own. */
  brand: OrgBrand | null
}) {
  const pathname = usePathname()
  const onDeskCrits = pathname === '/desk-crits'

  const navPill = (active: boolean) =>
    `flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${
      active ? 'text-[#16181D]' : 'text-[#5A5E6B] hover:bg-[#16181D]/[0.04]'
    }`

  /** The selected tab's fill. One value, so the three tabs cannot disagree. */
  const selectedFill = 'bg-[#16181D]/[0.06]'

  return (
    <>
      <Link href="/" className="mr-1 shrink-0 transition-opacity hover:opacity-80">
        <span className="text-[17px] font-extrabold tracking-[-0.04em] text-[#16181D]">
          pinspace
          <span
            aria-hidden="true"
            className="ml-[0.06em] inline-block h-[0.2em] w-[0.2em] rounded-full bg-[#3B6EF6] align-baseline"
          />
        </span>
      </Link>

      {/* Where you are. The org tab wears its own colour when it has one —
          the only tinted thing in the bar, because it is the only one that
          belongs to somebody other than pinspace. */}
      {hasOrganization && (
        <button
          type="button"
          onClick={() => onScopeChange('wentworth')}
          aria-current={currentScope === 'wentworth' ? 'page' : undefined}
          className={navPill(currentScope === 'wentworth')}
          style={
            currentScope === 'wentworth' && brand
              ? { background: brand.accentSoft }
              : undefined
          }
        >
          {brand && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brand.mark} alt="" aria-hidden="true" className="h-5 w-5" />
          )}
          {orgLabel}
        </button>
      )}

      <button
        type="button"
        onClick={() => onScopeChange('personal')}
        aria-current={currentScope === 'personal' ? 'page' : undefined}
        className={`${navPill(currentScope === 'personal')} ${
          currentScope === 'personal' ? selectedFill : ''
        }`}
      >
        Personal
      </button>

      {/* Superadmin-only, and it self-gates — renders nothing for everyone
          else, verified server-side by its own endpoint. Kept from the sidebar
          rather than dropped with it: it is the only way a superadmin reaches
          another institution's network, and it costs a normal account nothing
          because it does not render. */}
      <SuperadminOrgSwitcher />

      {/* A Link, not a scope button: this one is a page of its own rather than
          a filter on the dashboard. It draws itself selected when you are
          standing on it — it never did, so the tab that got you to /desk-crits
          looked exactly as unselected once you arrived. */}
      <Link
        href="/desk-crits"
        aria-current={onDeskCrits ? 'page' : undefined}
        className={`${navPill(onDeskCrits)} ${onDeskCrits ? selectedFill : ''}`}
      >
        Desk crits
      </Link>
    </>
  )
}

export default ChromeNav
