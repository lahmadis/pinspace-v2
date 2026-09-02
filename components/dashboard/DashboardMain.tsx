'use client'

import { getOrgBrand } from '@/lib/constants/orgBranding'
import { scopeConfig } from './dashboardScope'
import BrandCard from './BrandCard'
import CurrentStudioCard from './CurrentStudioCard'
import NetworkPanel from './NetworkPanel'
import PinspacesRow from './PinspacesRow'
import { SHELL_COLUMN } from './ChromeNav'
import type { Scope, DashboardWorkspace } from './dashboardScope'

// Re-exported so /dashboard and /archive keep importing this type from here.
export type { DashboardWorkspace } from './dashboardScope'

interface DashboardMainProps {
  scope: Scope
  rooms: DashboardWorkspace[]
  institutionHome: string | null
  loading: boolean
  organization: { name: string; slug: string } | null
  /** The studio the top bar's switcher has selected. */
  currentWorkspaceId: string | null
}

/**
 * The dashboard, as a home rather than an index.
 *
 * What was here: a grid of cards, one per studio you belong to, each with a
 * preview, a meta line and an actions menu — the same list the sidebar already
 * shows, drawn twice at two sizes. It answered "what do I have", which is the
 * question you can answer from the sidebar at a glance, and it answered it in
 * the whole width of the screen.
 *
 * What is here now answers "what is happening": the section you are in and who
 * has pinned work up in it, the archive as a place you can see into, and the
 * spaces you kept from it. The studio LIST moved to the sidebar entirely, along
 * with its rename/delete/leave menu and the create and join buttons — one list
 * of your spaces, in the one column that is about your spaces.
 *
 * Two columns: a narrow one of identity and current state, a wide one of the
 * archive. They stack on anything under lg, in that order, because the current
 * section is what a phone should open on.
 */
export function DashboardMain({
  scope, rooms, institutionHome, loading, organization, currentWorkspaceId,
}: DashboardMainProps) {
  const cfg = scopeConfig(scope, organization, institutionHome, false)

  // The institution's branding, and only on the institution's own tab. Personal
  // studios are not the school's, so branding them would be a lie about where
  // the work lives. Null throughout for an org with no artwork.
  const brand = scope === 'wentworth' ? getOrgBrand(organization?.slug) : null

  /**
   * Where the archive is, and what it is called there.
   *
   * Deliberately NOT gated on `organization` being loaded: the Wentworth tab is
   * already unreachable without an org (the sidebar renders it behind
   * hasOrganization), and `organization` is null while the profile fetch is in
   * flight — gating here is what used to make the network card vanish for the
   * exact users it serves.
   */
  const isOrgScope = scope === 'wentworth'
  const archiveHref = isOrgScope
    ? organization?.slug
      ? `/explore?institution=${encodeURIComponent(organization.slug)}`
      : '/explore'
    : '/network'
  // One label for both scopes. It read "Enter the archives" on the org tab
  // while pointing at /explore — the NETWORK — and "the archive" is a different
  // page (/archive) that this link has never gone to. The pin tile beside it
  // had the same wrong word and was corrected already; this is the other half.
  const archiveLabel = 'Enter the Network'

  /**
   * The current section — now something you PICK, in the top bar's switcher.
   *
   * It used to be "the most recent live one", chosen for you, because the
   * sidebar's studio list was a list of links and there was nowhere to express
   * a choice. The switcher is that place. Falls back to the newest live studio
   * until a choice exists, so the card is never empty on a first load.
   */
  const live = rooms.filter((r) => !r.is_archived)
  const current = live.find((r) => r.id === currentWorkspaceId) ?? live[0] ?? null

  // The org card's short name. "Wentworth Institute of Technology" is a page
  // title, not a lockup — the seal above it is already saying which Wentworth.
  const brandTitle = isOrgScope
    ? organization?.name?.split(' ')[0] || 'Network'
    : 'Personal'

  /**
   * Full width, with a gutter.
   *
   * This was capped at 1010px and centred, on the reasoning that the pins would
   * otherwise become billboards. The cap solved that and caused something
   * worse: on a real monitor the whole dashboard sat in the middle third with
   * empty grey either side, and the two columns inside it were cramped against
   * each other. The pins are held in shape by their own aspect ratio and a
   * five-across cap now (see PinspacesRow), which is where that problem
   * actually belonged.
   */
  return (
    <div className="min-w-0 flex-1 overflow-y-auto pb-8 pt-5">
      {/* The centred column, straight on the page's own background. The white
          card that used to wrap all of this is gone: every pane inside already
          carries its own surface, so the wrapper was a second white rectangle
          behind four white rectangles, and it forced the row to run the full
          width of the monitor. SHELL_COLUMN carries the offset that puts this
          column's left edge under the Wentworth tab. */}
      {/* Height comes from the CONTENT, not from the viewport. Stretching the
          row to fill the window was tried and is worse: the pin tiles have one
          fixed column width, so every pixel of leftover page height went into
          their height and they came out as 95px-wide, 430px-tall slivers, with
          the studio card grown to match and a still-larger hole inside it.

          The two columns stay level with each other — that is flex's own
          stretch, and it is what lets the studio card reach the bottom of the
          pin shelf — but neither reaches for the bottom of the screen. */}
      <div className={`${SHELL_COLUMN} flex flex-col gap-5 lg:flex-row`}>
      {/* Identity, then where you are.
          440, up from 265 and then 340. At 265 the lockup and the studio name
          were the two things on the dashboard with the least room to say
          themselves, next to a graph with the most; at 340 the brand card's
          subtitle still broke across three lines. It is about 28% of the row,
          which is the share it holds in the reference — a fixed width rather
          than a percentage so the card's own type does not have to be re-reckoned
          every time the window moves.

          The column stretches to the row's height (flex default), which is what
          lets the studio card below reach the bottom of the pin shelf. */}
      <div className="flex w-full shrink-0 flex-col gap-5 lg:w-[440px]">
        <BrandCard
          brand={brand}
          title={brandTitle}
          subtitle={isOrgScope ? brand?.cardSubtitle ?? null : null}
        />

        {loading ? (
          <div className="min-h-[400px] flex-1 animate-pulse rounded-2xl bg-[#F2F3F6]" />
        ) : current ? (
          <CurrentStudioCard workspace={current} institutionSlug={institutionHome} />
        ) : (
          <div className="flex-1 rounded-2xl border border-[#16181D]/[0.08] bg-white p-5">
            <h2 className="text-[15px] font-bold text-[#16181D]">{cfg.emptyTitle}</h2>
            {/* Points at the sidebar rather than repeating its buttons here.
                Two create affordances on one screen is how you end up with two
                that drift apart. */}
            <p className="mt-1.5 text-[13px] leading-relaxed text-[#5A5E6B]">
              Your {cfg.listLabel.toLowerCase()} will show up here. Start one from the
              sidebar and it opens in this spot.
            </p>
          </div>
        )}
      </div>

      {/* The network, and what you kept from it. The panel holds its own
          height — the bubble simulation is laid out for it — so the shelf is
          the pane that takes up the slack. */}
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <NetworkPanel href={archiveHref} label={archiveLabel} scope={scope} />
        <PinspacesRow archiveHref={archiveHref} />
      </div>
      </div>
    </div>
  )
}
