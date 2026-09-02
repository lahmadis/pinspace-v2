'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { SuperadminOrgSwitcher } from './SuperadminOrgSwitcher'
import type { OrgBrand } from '@/lib/constants/orgBranding'
import type { Scope } from './dashboardScope'

/**
 * The width the wordmark reserves in the bar.
 *
 * FIXED, and that is the whole point: it is what makes the first tab's left
 * edge a number rather than a consequence of how wide "pinspace." happens to
 * render. SHELL_COLUMN below is measured from it. ~84px fits the wordmark at
 * 17px extrabold with a few px to spare; it must not be narrower than the text
 * or the tabs shift right and the alignment goes with them.
 */
const WORDMARK_SLOT = 'w-[84px]'

/**
 * The content column on every signed-in page.
 *
 * LEFT-ALIGNED TO THE FIRST TAB, not centred. Centring was tried at three
 * different widths and the problem is structural rather than a matter of
 * picking a better number: the tab's left edge is fixed by the bar's padding,
 * the column's is half of whatever is left over, so the two agree at exactly
 * one window width and drift apart everywhere else. Pinning the column to the
 * same offset makes it agree at all of them.
 *
 * The 130px is that offset, and it is arithmetic, not taste:
 *
 *     20  px-5   the bar wrapper's gutter
 *   + 16  px-4   the bar's own padding
 *   + 84  WORDMARK_SLOT
 *   +  4  mr-1   on the wordmark
 *   +  6  gap-1.5 between the bar's children
 *   = 130        where the Wentworth tab starts
 *
 * CHANGE ANY OF THOSE FIVE AND THIS BREAKS SILENTLY — nothing type-checks the
 * sum.
 *
 * THE SAME INSET ON BOTH SIDES. The right was briefly 36 (20 + 16), landing the
 * column's right edge on the bar's inner edge under the avatar — which is a
 * defensible edge to hang it on and still reads as a mistake, because a page
 * with 130 of margin on the left and 36 on the right just looks off-centre. The
 * left edge is the one carrying meaning (it lines up with the tab); the right
 * only has to match it.
 *
 * Written as literal classes because Tailwind's JIT only generates arbitrary
 * values it can SEE: an interpolated `px-[${n}px]` compiles to nothing at all.
 * Below `lg` the offsets collapse to a plain gutter — 130px of side padding on
 * a phone would leave the cards a sliver wide.
 */
export const SHELL_COLUMN = 'w-full px-5 lg:px-[130px]'

/**
 * The bar across the top of the signed-in product.
 *
 * A FLOATING CARD, not a full-bleed strip. It was briefly bled to the edges
 * with its contents locked to a three-track grid so the tabs sat exactly above
 * the content column — which aligned, and lost the thing that made the bar read
 * as a bar: it stopped being an object on the page and became the page's top
 * edge. It is a rounded white card in a gutter again, with the wordmark and the
 * tabs together at its left the way a masthead reads.
 *
 * The grid is gone with it, but not the alignment it bought: the content
 * column below is offset to start under the first tab instead (SHELL_COLUMN),
 * which gets the same result without the bar having to be the full width of
 * the window to do it.
 *
 * The lockup itself was written inside DashboardTopBar and lived only there, so
 * /desk-crits — the one other place these tabs point at — opened on a
 * completely different header: a back arrow, a page title and a subtitle. Two
 * chromes for two pages one click apart, and the "Desk Crits" tab led somewhere
 * that had no tabs to come back by. Both pages render this now, gutter
 * included, so neither page has to know how the bar is inset.
 */
export function ChromeBar({
  currentScope,
  onScopeChange,
  hasOrganization,
  orgLabel,
  brand,
  children,
}: {
  /**
   * The scope tab to light up, or NULL on a page that is not a scope.
   *
   * /desk-crits is that page: it is its own destination, so nothing on the
   * scope side of the bar is current and the Desk Crits tab carries the
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
  /** The page's own controls, right-aligned inside the bar. */
  children?: React.ReactNode
}) {
  const pathname = usePathname()
  const onDeskCrits = pathname === '/desk-crits'

  // rounded-full, not rounded-xl: a tab is a bubble here, the same shape as
  // the pills in the right-hand group, so the whole bar reads as one row of
  // rounded controls rather than as squared tabs beside rounded buttons.
  const navPill = (active: boolean) =>
    `flex shrink-0 items-center gap-2 rounded-full px-3.5 py-2 text-sm font-semibold transition-colors ${
      active ? 'text-[#16181D]' : 'text-[#5A5E6B] hover:bg-[#16181D]/[0.06]'
    }`

  /** The selected tab's fill. One value, so the three tabs cannot disagree. */
  const selectedFill = 'bg-[#16181D]/[0.06]'

  return (
    <div className="px-5 pt-4">
      <header className="flex flex-wrap items-center gap-1.5 rounded-2xl bg-white px-4 py-2.5">
        {/* The wordmark's slot is load-bearing — see SHELL_COLUMN. */}
        <Link href="/" className={`mr-1 shrink-0 ${WORDMARK_SLOT} transition-opacity hover:opacity-80`}>
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
            // The brand wash IS this tab's selected state when the org has
            // artwork. When it does not — Sasaki and NYSID have no entry in
            // orgBranding — it falls back to the same neutral fill the other
            // two tabs use, or the selected org tab would have drawn no
            // background at all and read as unselected.
            className={`${navPill(currentScope === 'wentworth')} ${
              currentScope === 'wentworth' && !brand ? selectedFill : ''
            }`}
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

        {/* A Link, not a scope button: this one is a page of its own rather
            than a filter on the dashboard. It draws itself selected when you
            are standing on it — it never did, so the tab that got you to
            /desk-crits looked exactly as unselected once you arrived.

            DIRECTLY AFTER Personal. The superadmin switcher used to sit
            between them, so on a superadmin's screen the three tabs were not
            three tabs — they were two, a form control, and a third tab a
            third of the way across the bar. */}
        <Link
          href="/desk-crits"
          aria-current={onDeskCrits ? 'page' : undefined}
          className={`${navPill(onDeskCrits)} ${onDeskCrits ? selectedFill : ''}`}
        >
          Desk Crits
        </Link>

        {/* Everything the page can DO, right-aligned. min-w-0 so a long
            section name truncates inside the switcher rather than widening
            this group past the column and wrapping the bar. */}
        <div className="ml-auto flex min-w-0 items-center justify-end gap-2">
          {/* Superadmin-only, and it self-gates — renders nothing for
              everyone else, verified server-side by its own endpoint. It
              lives with the controls rather than among the tabs: it is a
              tool, not a place, and it is the one thing here that most
              people never see. */}
          <SuperadminOrgSwitcher />
          {children}
        </div>
      </header>
    </div>
  )
}

export default ChromeBar
