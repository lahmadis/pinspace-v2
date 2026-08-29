'use client'

import Link from 'next/link'
import { useRef, useEffect, useState } from 'react'
import {
  MoreVertical, Plus,
  Trash2, Pencil, Archive, UserPlus, LogOut, ArrowRight,
} from 'lucide-react'
import { useProfile } from '@/lib/ProfileContext'
import { getOrgBrand, withAlpha, type OrgBrand } from '@/lib/constants/orgBranding'
import GridPreview from '@/components/ui/GridPreview'
import NetworkBandPreview from './NetworkBandPreview'
import { scopeConfig, withInstitution, metaLine } from './dashboardScope'
import CreateSectionModal from './CreateSectionModal'
import type { Scope, DashboardWorkspace } from './dashboardScope'

// Re-exported so /dashboard and /archive keep importing this type from here.
export type { DashboardWorkspace } from './dashboardScope'

// ── Card preview ──────────────────────────────────────────────────────────────

/**
 * A studio's preview tile.
 *
 * Studios have no rendered thumbnail, so the tile is the ruling the work sits
 * on — the same cursor-reactive grid the landing page uses, contained to the
 * card. It replaces a drawing of two walls, which claimed to depict a specific
 * studio while being identical on every card.
 *
 * EVERY card gets the grid, including an empty one. It used to swap to a
 * dashed-rectangles placeholder at zero boards, on the reasoning that a
 * cursor-reactive grid invites a click toward nothing. But the grid is the
 * ground, not a depiction of contents — a studio with no work still HAS the
 * ruling, the way an empty sheet does — and swapping it out made a new section
 * look like a different kind of object than the studio beside it. The empty
 * state is still said, in the caption below and in the card's own "0 boards"
 * meta line.
 */
function StudioPreview({ boards }: { boards: number }) {
  return (
    <div className="relative h-full w-full">
      <GridPreview className="h-full w-full" />
      {boards === 0 && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] text-[#8A8FA0]">
          Nothing pinned yet
        </span>
      )}
    </div>
  )
}

// ── RoomCard ──────────────────────────────────────────────────────────────────

interface RoomCardProps {
  workspace: DashboardWorkspace
  isOwner: boolean
  openMenuId: string | null
  setOpenMenuId: (id: string | null) => void
  institutionSlug: string | null
  brand: OrgBrand | null
  onDelete: (id: string, name: string) => void
  onRename: (id: string, name: string) => void
  onLeave: (id: string, name: string) => void
  /** What this card is, from the scope's vocabulary — 'section' or 'studio'. */
  itemNoun: string
}

function RoomCard({
  workspace, isOwner, openMenuId, setOpenMenuId, institutionSlug, brand,
  onDelete, onRename, onLeave, itemNoun,
}: RoomCardProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const isMenuOpen = openMenuId === workspace.id
  const isArchived = Boolean(workspace.is_archived)

  useEffect(() => {
    if (!isMenuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpenMenuId(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [isMenuOpen, setOpenMenuId])

  const rooms = workspace.room_count ?? 0
  const boards = workspace.board_count ?? 0
  // Counts only. Department and academic_year are set on 16% and 48% of rows,
  // so a card that leads with them is blank for most studios; these two are
  // computed server-side for every workspace and are always true.
  const footerMeta = metaLine([
    rooms > 0 ? `${rooms} room${rooms === 1 ? '' : 's'}` : null,
    `${boards} board${boards === 1 ? '' : 's'}`,
  ])
  // Shown only when actually present, hence metaLine rather than a template.
  const subMeta = metaLine([workspace.network_metadata?.department, workspace.academic_year])

  // Prefixed: a bare "Aug 6" on a card reads as a deadline or an event. The
  // badge is the day the studio was made, and saying so costs one word.
  const created = workspace.created_at
    ? `Created ${new Date(workspace.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
    : null

  return (
    <div
      className={`group relative flex flex-col rounded-2xl border bg-white p-3 transition-shadow duration-200 ${
        isArchived
          ? 'border-[#16181D]/10 opacity-70'
          : 'border-[#16181D]/[0.08] shadow-[0_8px_24px_rgba(22,24,29,0.05)] hover:shadow-[0_16px_40px_rgba(22,24,29,0.10)]'
      }`}
    >
      {/* Top row: archived state (when it applies) + created date.
          There is no pill on a live studio: every card on this dashboard is one
          you own or belong to, so "Yours" was true of nearly all of them and
          told you nothing. Archived is the only state here worth marking. */}
      <div className="mb-2 flex items-center justify-between gap-2">
        {isArchived ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-[#16181D]/[0.08] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-[#5A5E6B]">
            <Archive className="h-3 w-3" /> Archived
          </span>
        ) : brand ? (
          // The org's mark, on org studios only. Shared and personal studios
          // are not the institution's, so branding them would be a lie about
          // where the work lives.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={brand.mark} alt="" aria-hidden="true" className="h-5 w-5 shrink-0" />
        ) : (
          <span />
        )}
        <div className="flex items-center gap-1">
          {created && <span className="text-[11px] text-[#8A8FA0]">{created}</span>}

          {/* Every dashboard card is a workspace the user owns or is a member of
              (the list is owned ∪ member), so Rename is available on all cards.
              Delete remains owner-only. (Settings was here too, until the
              workspace settings page was folded into the spaces page.)

              Faintly visible at rest rather than opacity-0: hover never fires on
              a touch screen, so the old version put Rename, Delete and Leave
              permanently out of reach on a phone. */}
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              aria-label="Studio actions"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpenMenuId(isMenuOpen ? null : workspace.id) }}
              className="rounded-full p-1.5 text-[#8A8FA0] opacity-50 transition-all hover:bg-[#16181D]/5 hover:text-[#16181D] group-hover:opacity-100"
            >
              <MoreVertical className="h-3.5 w-3.5" />
            </button>
            {isMenuOpen && (
              <div className="absolute right-0 top-9 z-20 w-44 rounded-2xl border border-[#16181D]/[0.08] bg-white py-1.5 shadow-[0_20px_50px_rgba(22,24,29,0.18)]">
                <button
                  type="button"
                  onClick={() => { onRename(workspace.id, workspace.name || ''); setOpenMenuId(null) }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-[#16181D] hover:bg-[#3B6EF6]/5"
                >
                  <Pencil className="h-4 w-4" /> Rename
                </button>
                {isOwner && (
                  <button
                    type="button"
                    onClick={() => onDelete(workspace.id, workspace.name || '')}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-[#C2452D] hover:bg-[#C2452D]/[0.08]"
                  >
                    <Trash2 className="h-4 w-4" /> Delete
                  </button>
                )}
                {/* Non-owner members can leave. Every non-owned dashboard card is a
                    membership, so !isOwner ⟹ member. Owners get Delete instead. */}
                {!isOwner && (
                  <button
                    type="button"
                    onClick={() => { onLeave(workspace.id, workspace.name || ''); setOpenMenuId(null) }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-[#C2452D] hover:bg-[#C2452D]/[0.08]"
                  >
                    <LogOut className="h-4 w-4" /> Leave studio
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Title */}
      <Link href={withInstitution(`/workspace/${workspace.id}`, institutionSlug)} className="block">
        <h3 className="truncate text-[15px] font-extrabold tracking-[-0.02em] text-[#16181D] transition-colors hover:text-[#3B6EF6]">
          {workspace.name || 'Unnamed'}
        </h3>
      </Link>
      {subMeta && <p className="mt-0.5 truncate text-xs text-[#8A8FA0]">{subMeta}</p>}

      {/* Preview. A tinted panel, not a render — studios have no thumbnail yet.
          The aspect-ratio box is what makes the card shrink gracefully: the panel
          rescales with the column instead of holding a fixed height. */}
      <Link
        href={withInstitution(`/workspace/${workspace.id}`, institutionSlug)}
        className="mt-2.5 block overflow-hidden rounded-xl border border-[#16181D]/[0.06]"
      >
        <div
          // No padding: the grid runs to the tile's edges, which is what makes
          // it read as ruled ground rather than as a picture of a grid. The
          // empty-state placeholder centres itself, so it needs none either.
          className="flex aspect-[16/11] items-center justify-center"
          style={{ background: isArchived
            ? 'linear-gradient(150deg, #F2F4F8, #E9ECF3)'
            : 'linear-gradient(150deg, #F4F7FD, #E4EBF7)' }}
        >
          <StudioPreview boards={boards} />
        </div>
      </Link>

      {/* Footer meta + actions */}
      <p className="mt-2.5 text-[11px] text-[#8A8FA0]">{footerMeta}</p>

      <Link
        href={withInstitution(`/workspace/${workspace.id}`, institutionSlug)}
        className="mt-2.5 block rounded-full bg-[#16181D] px-4 py-2 text-center text-[12.5px] font-bold text-white transition-colors hover:bg-[#3B6EF6]"
      >
        Open {itemNoun}
      </Link>
    </div>
  )
}

// ── Enter Network card ────────────────────────────────────────────────────────

/**
 * The one dark surface on the dashboard. It is the only element here that is a
 * place rather than a list item, and the contrast is what says so.
 */
/**
 * The network entry point.
 *
 * Two treatments. With org branding it is a warm wash carrying the institution's
 * own seal — the one surface on the dashboard that belongs to the school rather
 * than to pinspace. Without it, the original dark card: an unbranded org has no
 * accent to wash with, and a beige card with no mark on it is just a beige card.
 */
function EnterNetworkCard({
  href, brand,
}: { href: string; brand: OrgBrand | null }) {

  if (brand) {
    return (
      <Link href={href} className="group block h-full">
        <div
          // The hover shadow goes through a CSS variable rather than a literal
          // in the class: a Tailwind arbitrary value is a static string, so an
          // org colour cannot be interpolated into one, but it CAN read a
          // variable that inline style sets per-org.
          // Lays out ALONG its length now that it is a full-width band: seal and
          // copy on the left, the action on the right, centred. Stacked
          // bottom-anchored content was right for a tall grid cell and leaves a
          // wide short band mostly empty.
          className="relative min-h-[190px] overflow-hidden rounded-2xl border px-6 py-5 transition-shadow duration-200 hover:shadow-[0_16px_40px_var(--brand-shadow)]"
          style={{
            // Every stop derives from the brand — no literal golds, so a second
            // branded org gets its own colours rather than Wentworth's.
            background: `linear-gradient(150deg, #FFFFFF 0%, ${brand.accentSoft} 58%, ${withAlpha(brand.accent, 0.28)} 100%)`,
            borderColor: withAlpha(brand.accentInk, 0.16),
            '--brand-shadow': withAlpha(brand.accentInk, 0.16),
          } as React.CSSProperties}
        >
          {/* The bubble diagram, filling the band behind everything else. It
              is the first child so the seal, the name and the action paint
              over it. */}
          <NetworkBandPreview height={190} tone="dark" />

          {/* Warm bleed, now on the right where the band has room for it. */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -right-10 -top-16 h-64 w-64 rounded-full opacity-40 blur-[2px]"
            style={{ background: `radial-gradient(closest-side, ${brand.accent}55, transparent)` }}
          />

          {/* Seal in one corner, name and action in the opposite one, with the
              live graph running between them. A single centred row put all
              three abreast and left the band reading as a toolbar; pushed to
              opposite corners they frame the network instead of sitting on it.
              Absolute rather than flexed, so neither corner constrains the
              other and the bubbles get the whole width. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={brand.mark}
            alt=""
            aria-hidden="true"
            className="absolute left-6 top-5 hidden h-20 w-20 opacity-95 sm:block"
          />

          <div className="absolute bottom-5 right-6 flex items-center gap-4">
            <span className="text-[20px] font-extrabold tracking-[-0.02em] text-[#16181D]">
              The Network
            </span>
            {/* Says Enter, like the Shared and Personal bands do. A bare arrow
                disc was the only action in the product that made you infer the
                verb from a glyph. Filled with the brand accent rather than the
                white those two use — white on this pale gradient would have no
                edge to it. */}
            <span
              className="inline-flex shrink-0 items-center gap-2 rounded-full px-5 py-2.5 text-[14px] font-bold text-white transition-transform duration-200 group-hover:translate-x-0.5"
              style={{ background: brand.accent }}
            >
              Enter
              <ArrowRight className="h-4 w-4" />
            </span>
          </div>
        </div>
      </Link>
    )
  }

  return (
    <Link href={href} className="block h-full">
      <div
        // Same band layout as the branded arm — copy left, action right.
        className="group relative flex min-h-[190px] items-center gap-5 overflow-hidden rounded-2xl px-6 py-5 transition-shadow duration-200 hover:shadow-[0_20px_50px_rgba(22,24,29,0.28)]"
        style={{ background: 'linear-gradient(120deg, #171A24 0%, #1D2436 55%, #27365C 100%)' }}
      >
        <NetworkBandPreview height={190} tone="light" />

        {/* Decorative bubbles, echoing what the network itself renders. Moved
            right, where a wide band has the room for them. */}
        <span aria-hidden="true" className="pointer-events-none absolute -top-12 right-16 h-56 w-56 rounded-full bg-[#3B6EF6]/25 blur-[2px]" />
        <span aria-hidden="true" className="pointer-events-none absolute -bottom-8 right-56 h-28 w-28 rounded-full bg-white/[0.06]" />

        <div className="relative min-w-0 flex-1">
          <h3 className="text-[24px] font-extrabold leading-[1.05] tracking-[-0.03em] text-white">
            The Network
          </h3>
        </div>

        <span className="relative inline-flex w-fit shrink-0 items-center gap-2 rounded-full bg-white px-6 py-3 text-[14px] font-bold text-[#16181D] transition-transform duration-200 group-hover:translate-x-0.5">
          Enter
          <ArrowRight className="h-4 w-4" />
        </span>
      </div>
    </Link>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface DashboardMainProps {
  scope: Scope
  rooms: DashboardWorkspace[]
  userId: string | undefined
  institutionHome: string | null
  loading: boolean
  organization: { name: string; slug: string } | null
  onDelete: (id: string, name: string) => void
  onRename: (id: string, name: string) => void
  onLeave: (id: string, name: string) => void
  onShowJoinModal: () => void
}

export function DashboardMain({
  scope, rooms, userId, institutionHome, loading,
  organization, onDelete, onRename, onLeave, onShowJoinModal,
}: DashboardMainProps) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  // Owned here rather than by each trigger: the header button and the
  // empty-state button are two affordances for one dialog, and they are never
  // both on screen — an empty scope has no header row to hang the first on.
  const [showCreateSection, setShowCreateSection] = useState(false)
  const { profile } = useProfile()

  // Only instructors may create org-facing classes (the Wentworth tab). Shared
  // rooms are peer-to-peer collab and Personal rooms are the user's own space —
  // both stay open to everyone. Mirrors the server gate in POST /api/workspaces
  // (type === 'class'); hiding here is UX only, the API is the real boundary.
  const requiresInstructor = scope === 'wentworth'
  const isInstructor = profile.accountRole === 'instructor'
  const canCreate = !requiresInstructor || isInstructor

  // Enter Network is an org-wide entry point, not a class action. It is gated on
  // nothing at all now — never account_role, never "owns/joined at least one
  // room" — because the grid it lives in renders unconditionally (see below).
  // Deliberately NOT gated on `organization` either: the Wentworth tab is
  // already unreachable without an org (DashboardSidebar renders it behind
  // hasOrganization), and `organization` is null while the profile fetch is in
  // flight or if it fails — re-adding that check would make the card vanish
  // again for the exact users it serves.
  const networkHref =
    scope === 'wentworth'
      ? organization?.slug ? `/explore?institution=${encodeURIComponent(organization.slug)}` : '/explore'
      : scope === 'shared' ? '/network/shared' : '/network'

  const cfg = scopeConfig(scope, organization, institutionHome, canCreate)

  // The institution's branding, and only on the institution's own tab. Shared
  // and Personal studios are not the school's, so they keep the neutral
  // treatment even for a user who belongs to a branded org. Null throughout for
  // an org with no artwork — see lib/constants/orgBranding.
  const brand = getOrgBrand(organization?.slug)
  const brandHeader = scope === 'wentworth' ? brand : null
  const hasArchived = rooms.some((r) => r.is_archived)
  const visibleRooms = showArchived ? rooms : rooms.filter((r) => !r.is_archived)
  /**
   * The card grid shrinks its cells as studios accumulate rather than holding
   * one fixed size and wrapping: a lone studio gets a wide card, a term with
   * six gets six small ones. Written as whole literal class strings because
   * Tailwind scans source text and cannot resolve an interpolated column count.
   */
  const gridCols =
    visibleRooms.length <= 2
      ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
      : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'

  // Reset showArchived when scope changes
  useEffect(() => { setShowArchived(false); setOpenMenuId(null) }, [scope])

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[#F4F6FB]">
      {/* Header. Wraps below sm so the title and the action buttons each get
          their own row on narrow viewports instead of the buttons being pushed
          past the right edge; min-w-0 lets the title shrink rather than shove
          them off. */}
      <div className="shrink-0 border-b border-[#16181D]/[0.06] bg-white/60 px-5 pb-3 pt-4 backdrop-blur-sm sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {/* The institution's own lockup stands in for the title when we
                have it. h1 either way — the wordmark carries the org's name, so
                the alt text is the heading and the page keeps one. */}
            {brandHeader ? (
              <h1 className="pl-10 md:pl-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={brandHeader.wordmark}
                  alt={brandHeader.wordmarkAlt}
                  className="h-11 w-auto max-w-full object-contain object-left sm:h-14"
                />
              </h1>
            ) : (
              <h1 className="truncate pl-10 text-[26px] font-extrabold tracking-[-0.035em] text-[#16181D] md:pl-0">
                {cfg.title}
              </h1>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Revealing your own archived rooms is a VIEW action, so it is not
                gated on account_role. It used to be, which made archiving a
                one-way door: a student-account owner can archive a personal or
                shared studio (that check is the workspace MEMBER role, and every
                creator is inserted as an instructor member) but could never
                unhide it again, because this check was the ACCOUNT role. The
                rooms are already in `rooms` — this only toggles the filter. */}
            {hasArchived && (
              <button
                type="button"
                onClick={() => setShowArchived((v) => !v)}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                  showArchived
                    ? 'bg-[#16181D]/10 text-[#16181D]'
                    : 'border border-[#16181D]/[0.12] text-[#8A8FA0] hover:bg-[#16181D]/5'
                }`}
              >
                <Archive className="h-3.5 w-3.5" />
                {showArchived ? 'Hide archived' : 'Show archived'}
              </button>
            )}
            {cfg.showJoin && (
              <button
                type="button"
                onClick={onShowJoinModal}
                className="flex items-center gap-1.5 rounded-full border border-[#3B6EF6]/40 px-3 py-1.5 text-xs font-semibold text-[#3B6EF6] transition-colors hover:bg-[#3B6EF6]/[0.08]"
              >
                <UserPlus className="h-3.5 w-3.5" />
                Join with Code
              </button>
            )}
            {canCreate && (
              cfg.newMode === 'section-dialog' ? (
                <button
                  type="button"
                  onClick={() => setShowCreateSection(true)}
                  className="flex items-center gap-1.5 rounded-full bg-[#16181D] px-3.5 py-1.5 text-xs font-bold text-white transition-colors hover:bg-[#3B6EF6]"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {cfg.newLabel}
                </button>
              ) : (
                <Link
                  href={cfg.newHref}
                  className="flex items-center gap-1.5 rounded-full bg-[#16181D] px-3.5 py-1.5 text-xs font-bold text-white transition-colors hover:bg-[#3B6EF6]"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {cfg.newLabel}
                </Link>
              )
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5 sm:p-6">
        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="animate-pulse rounded-2xl border border-[#16181D]/[0.08] bg-white p-3">
                <div className="mb-3 h-4 w-1/3 rounded bg-[#16181D]/5" />
                <div className="mb-3 h-5 w-3/4 rounded bg-[#16181D]/5" />
                <div className="aspect-[16/11] rounded-xl bg-[#16181D]/5" />
                <div className="mt-3 h-9 rounded-full bg-[#16181D]/5" />
              </div>
            ))}
          </div>
        ) : (
          <>
            {/* Persistent chrome. Enter Network and the create button (New
                Section on the class tab) are entry points,
                not content, so they render unconditionally rather than inside
                the populated branch of an empty-state ternary — that structure
                is what silently deleted Enter Network for every user with zero
                rooms. Anything added to this grid later inherits the fix. */}
            {/* The network is a BAND, not a cell. It is an entry point to a
                different place rather than one more studio, and sitting it in
                the same grid made it read as the first item in the list. Full
                width also lets it lay out along its length instead of stacking
                in a narrow column. */}
            <div className="mb-4">
              <EnterNetworkCard href={networkHref} brand={brandHeader} />
            </div>

            <div className={`grid gap-4 ${gridCols}`}>
              {visibleRooms.map((room) => (
                <RoomCard
                  key={room.id}
                  workspace={room}
                  isOwner={room.owner_id === userId}
                  openMenuId={openMenuId}
                  setOpenMenuId={setOpenMenuId}
                  institutionSlug={institutionHome}
                  brand={scope === 'wentworth' ? brand : null}
                  onDelete={onDelete}
                  onRename={onRename}
                  onLeave={onLeave}
                  itemNoun={cfg.itemNoun}
                />
              ))}
            </div>

            {visibleRooms.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <h3 className="mb-2 text-lg font-bold text-[#16181D]">{cfg.emptyTitle}</h3>
                <p className="mb-6 max-w-xs text-sm text-[#5A5E6B]">{cfg.emptySubtext}</p>
                <div className="flex flex-wrap justify-center gap-2.5">
                  {cfg.showJoin && (
                    <button
                      type="button"
                      onClick={onShowJoinModal}
                      className="flex items-center gap-1.5 rounded-full border border-[#3B6EF6]/40 px-4 py-2 text-sm font-semibold text-[#3B6EF6] transition-colors hover:bg-[#3B6EF6]/[0.08]"
                    >
                      <UserPlus className="h-4 w-4" /> Join with Code
                    </button>
                  )}
                  {canCreate && (
                    cfg.newMode === 'section-dialog' ? (
                      <button
                        type="button"
                        onClick={() => setShowCreateSection(true)}
                        className="flex items-center gap-1.5 rounded-full bg-[#16181D] px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-[#3B6EF6]"
                      >
                        <Plus className="h-4 w-4" /> {cfg.newLabel}
                      </button>
                    ) : (
                      <Link
                        href={cfg.newHref}
                        className="flex items-center gap-1.5 rounded-full bg-[#16181D] px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-[#3B6EF6]"
                      >
                        <Plus className="h-4 w-4" /> {cfg.newLabel}
                      </Link>
                    )
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Mounted unconditionally under canCreate rather than beside either
          trigger: it renders nothing while closed, and hanging it off one of
          the two buttons would unmount the open dialog the moment creating a
          section emptied — or filled — the scope it was launched from. */}
      {canCreate && cfg.newMode === 'section-dialog' && (
        <CreateSectionModal
          open={showCreateSection}
          onOpenChange={setShowCreateSection}
          defaultInstructorName={profile.fullName}
        />
      )}
    </div>
  )
}
