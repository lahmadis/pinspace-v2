'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import {
  Network, User, Settings, LogOut, Menu, X, PencilRuler, ChevronDown,
  MoreVertical, Pencil, Trash2, Plus, UserPlus,
} from 'lucide-react'
import { useRouter, usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import { resetAccountModeCache } from '@/lib/useAccountMode'
import { useProfile } from '@/lib/ProfileContext'
import { SuperadminOrgSwitcher } from './SuperadminOrgSwitcher'
import { getOrgBrand, type OrgBrand } from '@/lib/constants/orgBranding'
import { withInstitution } from './dashboardScope'
import type { DashboardWorkspace, ScopeCfg, Scope } from './dashboardScope'

// Re-exported so /dashboard, /archive and /settings keep importing Scope from
// here, unchanged by the move into dashboardScope.
export type { Scope } from './dashboardScope'

interface DashboardSidebarProps {
  currentScope: Scope
  onScopeChange: (scope: Scope) => void
  hasOrganization: boolean
  orgName?: string | null
  /** organizations.slug — keys the org's branding. See lib/constants/orgBranding. */
  orgSlug?: string | null
  firstName?: string | null
  userEmail?: string | null
  isAdmin?: boolean
  isOpen: boolean
  onToggle: () => void

  /**
   * Everything below is optional on purpose. /archive and /settings render this
   * same sidebar for its nav alone and have no workspace list to give it — the
   * studio sections simply don't render there, rather than those two pages
   * having to invent props to stay compiling.
   */
  workspaces?: DashboardWorkspace[]
  scopeCfg?: ScopeCfg
  institutionSlug?: string | null

  /**
   * The studio list's own actions, and the two buttons under it.
   *
   * These were the dashboard's header and card menus. The card grid is gone —
   * the sidebar IS the list of your spaces now — so creating, joining, renaming,
   * deleting and leaving all moved here with it, rather than being left behind
   * on a surface that no longer draws them. Optional for the same reason
   * `workspaces` is: /archive and /settings render this sidebar for its nav
   * alone.
   */
  userId?: string | null
  /** The studio the dashboard's Current studio card is showing. */
  currentWorkspaceId?: string | null
  canCreate?: boolean
  onCreate?: () => void
  onShowJoinModal?: () => void
  onRename?: (id: string, name: string) => void
  onDelete?: (id: string, name: string) => void
  onLeave?: (id: string, name: string) => void
}

/** What a row's ⋯ menu can do, passed down as one object rather than five props. */
interface StudioRowActions {
  openMenuId: string | null
  setOpenMenuId: (id: string | null) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string, name: string) => void
  onLeave: (id: string, name: string) => void
}

/**
 * One studio in the sidebar list.
 *
 * The sub-line is whatever the row can actually support. Board and room counts
 * are computed by GET /api/workspaces for every workspace, so unlike department
 * or academic_year they are never blank — which is what makes them the right
 * thing to put here.
 */
function StudioRow({
  workspace, href, dimmed, isCurrent, isOwner, actions,
}: {
  workspace: DashboardWorkspace
  href: string
  dimmed?: boolean
  /** The one the dashboard's Current studio card is showing. */
  isCurrent?: boolean
  isOwner?: boolean
  /** Omitted on /archive and /settings, which render this list read-only. */
  actions?: StudioRowActions
}) {
  const boards = workspace.board_count ?? 0
  const rooms = workspace.room_count ?? 0
  const sub = [
    rooms > 0 ? `${rooms} room${rooms === 1 ? '' : 's'}` : null,
    boards > 0 ? `${boards} board${boards === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(' · ') || 'Empty'

  const menuRef = useRef<HTMLDivElement>(null)
  const isMenuOpen = actions?.openMenuId === workspace.id

  useEffect(() => {
    if (!isMenuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        actions?.setOpenMenuId(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [isMenuOpen, actions])

  return (
    <div className={`group relative flex items-center rounded-xl pr-1 transition-colors hover:bg-white ${
      dimmed ? 'opacity-70' : ''
    }`}>
      <Link href={href} className="flex min-w-0 flex-1 items-start gap-2.5 py-2 pl-2.5">
        {/* A dot, where a tinted tile used to stand in for a preview that was
            never going to arrive. The tile claimed to depict the studio and was
            identical on every row; the dot claims only what it knows — filled
            for the section the dashboard is currently showing, hollow for the
            rest. */}
        <span
          aria-hidden="true"
          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
            isCurrent ? 'bg-[#2FA96B]' : 'border border-[#16181D]/25'
          }`}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-[#16181D] group-hover:text-[#3B6EF6]">
            {workspace.name || 'Unnamed'}
          </span>
          <span className="block truncate text-[11px] text-[#8A8FA0]">{sub}</span>
        </span>
      </Link>

      {/* Rename, delete and leave used to live on the dashboard's studio cards.
          Those cards are gone — the list is only here now — so the actions came
          with it rather than becoming unreachable.

          Faintly visible at rest rather than opacity-0: hover never fires on a
          touch screen, and the same mistake here would put all three
          permanently out of reach on a phone. */}
      {actions && (
        <div className="relative shrink-0" ref={menuRef}>
          <button
            type="button"
            aria-label={`Actions for ${workspace.name || 'this studio'}`}
            aria-expanded={isMenuOpen}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              actions.setOpenMenuId(isMenuOpen ? null : workspace.id)
            }}
            className="rounded-full p-1.5 text-[#8A8FA0] opacity-50 transition-all hover:bg-[#16181D]/[0.08] hover:text-[#16181D] group-hover:opacity-100"
          >
            <MoreVertical className="h-3.5 w-3.5" />
          </button>
          {isMenuOpen && (
            <div className="absolute right-0 top-8 z-30 w-44 rounded-2xl border border-[#16181D]/[0.08] bg-white py-1.5 shadow-[0_20px_50px_rgba(22,24,29,0.18)]">
              <button
                type="button"
                onClick={() => {
                  actions.onRename(workspace.id, workspace.name || '')
                  actions.setOpenMenuId(null)
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-[#16181D] hover:bg-[#3B6EF6]/5"
              >
                <Pencil className="h-4 w-4" /> Rename
              </button>
              {/* Every non-owned row is a membership, so !isOwner ⟹ member:
                  owners get Delete, members get Leave. */}
              {isOwner ? (
                <button
                  type="button"
                  onClick={() => {
                    actions.onDelete(workspace.id, workspace.name || '')
                    actions.setOpenMenuId(null)
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-[#C2452D] hover:bg-[#C2452D]/[0.08]"
                >
                  <Trash2 className="h-4 w-4" /> Delete
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    actions.onLeave(workspace.id, workspace.name || '')
                    actions.setOpenMenuId(null)
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-[#C2452D] hover:bg-[#C2452D]/[0.08]"
                >
                  <LogOut className="h-4 w-4" /> Leave studio
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * A titled, collapsible list of studios.
 *
 * Both groups use it so the two behave identically — the current term opens by
 * default because it is what you came to the dashboard for, past studios stay
 * shut because they are a place you go looking.
 */
function StudioGroup({
  label, items, open, onToggle, institutionSlug, dimmed, currentId, userId, actions,
}: {
  label: string
  items: DashboardWorkspace[]
  open: boolean
  onToggle: () => void
  institutionSlug: string | null
  dimmed?: boolean
  currentId?: string | null
  userId?: string | null
  actions?: StudioRowActions
}) {
  return (
    <div className="pt-4">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#A8ADBA] transition-colors hover:bg-white/70 hover:text-[#5A5E6B]"
      >
        <span className="flex-1 truncate text-left">{label}</span>
        <span className="rounded-full bg-[#16181D]/[0.08] px-1.5 text-[10px] font-bold tracking-normal text-[#5A5E6B]">
          {items.length}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="space-y-0.5 pt-1">
          {items.map((w) => (
            <StudioRow
              key={w.id}
              workspace={w}
              dimmed={dimmed}
              isCurrent={w.id === currentId}
              isOwner={Boolean(userId) && w.owner_id === userId}
              actions={actions}
              href={withInstitution(`/workspace/${w.id}`, institutionSlug)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function DashboardSidebar({
  currentScope, onScopeChange, hasOrganization, orgName,
  firstName, userEmail, isAdmin, isOpen, onToggle, orgSlug,
  workspaces, scopeCfg, institutionSlug,
  userId, currentWorkspaceId, canCreate, onCreate, onShowJoinModal,
  onRename, onDelete, onLeave,
}: DashboardSidebarProps) {
  const router = useRouter()
  const pathname = usePathname()
  const { profile } = useProfile()
  const [showTerm, setShowTerm] = useState(true)
  const [showPast, setShowPast] = useState(false)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)

  // All three or none: a row menu with only two live handlers would render
  // Rename over a no-op. /archive and /settings pass nothing and get a
  // read-only list, which is what they want anyway.
  const rowActions: StudioRowActions | undefined =
    onRename && onDelete && onLeave
      ? { openMenuId, setOpenMenuId, onRename, onDelete, onLeave }
      : undefined

  const displayName = (profile.fullName ? profile.fullName.trim().split(/\s+/)[0] : null) || firstName || userEmail?.split('@')[0] || 'You'
  const initials = displayName.slice(0, 2).toUpperCase()
  const avatarUrl = profile.avatarUrl
  // Real data (the org's own first word) is unchanged — both arms of the old
  // accountMode ternary computed it identically. Only the FALLBACK noun
  // branched ('Firm' vs 'Network'), which is the copy branch being collapsed.
  const orgLabel = orgName?.split(' ')[0] || 'Network'
  // Null for an org with no artwork, which keeps the other two orgs on the
  // neutral blue treatment. See lib/constants/orgBranding.
  const brand = getOrgBrand(orgSlug)

  const live = (workspaces ?? []).filter((w) => !w.is_archived)
  const past = (workspaces ?? []).filter((w) => w.is_archived)
  const hasList = workspaces !== undefined

  const handleSignOut = async () => {
    resetAccountModeCache()
    await supabase.auth.signOut()
    router.push('/sign-in')
  }

  const handleScopeClick = (scope: Scope) => {
    onScopeChange(scope)
    if (isOpen) onToggle()
  }

  /**
   * `accent` is passed only for the org's own tab, and only when that org has
   * branding. Its active state is then styled inline rather than by class,
   * because the colour is per-org data and Tailwind scans source text — it
   * cannot resolve a class name built from a variable.
   */
  const navBtn = (scope: Scope, label: string, icon: React.ReactNode, accent?: OrgBrand | null) => {
    const active = currentScope === scope
    return (
      <button
        key={scope}
        type="button"
        onClick={() => handleScopeClick(scope)}
        className={`relative w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors text-left ${
          active
            ? accent ? 'text-[#16181D]' : 'bg-[#3B6EF6]/10 text-[#16181D]'
            : 'text-[#5A5E6B] hover:bg-white/70'
        }`}
        style={active && accent ? { background: accent.accentSoft } : undefined}
      >
        {active && accent && (
          <span
            aria-hidden="true"
            className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full"
            style={{ background: accent.accent }}
          />
        )}
        <span className={`shrink-0 ${active && !accent ? 'text-[#3B6EF6]' : active ? '' : 'text-[#8A8FA0]'}`}>{icon}</span>
        <span className="truncate">{label}</span>
      </button>
    )
  }

  const navLink = (href: string, label: string, icon: React.ReactNode) => {
    const active = pathname === href
    return (
      <Link
        href={href}
        onClick={() => { if (isOpen) onToggle() }}
        className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
          active
            ? 'bg-[#3B6EF6]/10 text-[#16181D]'
            : 'text-[#5A5E6B] hover:bg-white/70'
        }`}
      >
        <span className={`shrink-0 ${active ? 'text-[#3B6EF6]' : 'text-[#8A8FA0]'}`}>{icon}</span>
        {label}
      </Link>
    )
  }

  return (
    <>
      {/* Mobile hamburger — only visible when sidebar is closed */}
      {!isOpen && (
        <button
          type="button"
          onClick={onToggle}
          className="fixed top-4 left-4 z-50 md:hidden p-2 rounded-xl bg-white border border-[#16181D]/10 shadow-sm text-[#5A5E6B] hover:bg-[#3B6EF6]/5"
          aria-label="Open navigation"
        >
          <Menu className="w-5 h-5" />
        </button>
      )}

      {/* Mobile backdrop */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/40 z-30 md:hidden" onClick={onToggle} />
      )}

      {/* Sidebar */}
      <aside
        className={[
          'fixed inset-y-0 left-0 z-40 w-64 flex flex-col border-r border-[#16181D]/[0.08] bg-[#F7F8FC]',
          'transform transition-transform duration-200 ease-in-out',
          isOpen ? 'translate-x-0' : '-translate-x-full',
          'md:relative md:translate-x-0 md:z-auto md:shrink-0',
        ].join(' ')}
      >
        {/* Logo row */}
        <div className="shrink-0 h-16 flex items-center justify-between px-5">
          <Link href="/" className="hover:opacity-80 transition-opacity">
            <span className="text-lg font-extrabold text-[#16181D] tracking-[-0.04em]">
              pinspace
              <span
                aria-hidden="true"
                className="inline-block align-baseline rounded-full bg-[#3B6EF6] w-[0.2em] h-[0.2em] ml-[0.06em]"
              />
            </span>
          </Link>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onToggle}
              className="md:hidden p-1.5 rounded-lg hover:bg-[#16181D]/[0.08] transition-colors"
              aria-label="Close menu"
            >
              <X className="w-4 h-4 text-[#8A8FA0]" />
            </button>
          </div>
        </div>

        {/* Scrollable middle: scopes, then this scope's studios */}
        <nav className="flex-1 px-3 pt-2 pb-4 overflow-y-auto">
          <div className="space-y-0.5">
            {hasOrganization && navBtn(
              'wentworth',
              orgLabel,
              brand
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={brand.mark} alt="" aria-hidden="true" className="h-5 w-5" />
                : <Network className="w-4 h-4" />,
              brand,
            )}
            {navBtn('personal', 'Personal', <User className="w-4 h-4" />)}

            {/* Superadmin-only: read-only org network switcher. Self-gates — renders
                nothing for non-superadmins (server-verified via its endpoint). */}
            <SuperadminOrgSwitcher />

            {/* The standalone Archive nav item is gone — archived studios are
                reachable from the Past studios group below, in the scope you're
                already looking at, rather than from a separate page. */}
            <div className="pt-2 mt-2 border-t border-[#16181D]/[0.08] space-y-0.5">
              {navLink('/desk-crits', 'Desk Crits', <PencilRuler className="w-4 h-4" />)}
            </div>
          </div>

          {hasList && live.length > 0 && (
            <StudioGroup
              label={scopeCfg?.listLabel ?? 'Studios'}
              items={live}
              open={showTerm}
              onToggle={() => setShowTerm((v) => !v)}
              institutionSlug={institutionSlug ?? null}
              currentId={currentWorkspaceId}
              userId={userId}
              actions={rowActions}
            />
          )}

          {hasList && past.length > 0 && (
            <StudioGroup
              label="Past studios"
              items={past}
              open={showPast}
              onToggle={() => setShowPast((v) => !v)}
              institutionSlug={institutionSlug ?? null}
              currentId={currentWorkspaceId}
              userId={userId}
              actions={rowActions}
              dimmed
            />
          )}
        </nav>

        {/* Make and join, directly under the list they add to.
            They were in the main pane's header, a full screen-width away from
            the only place their result appears. Above Admin and Settings
            rather than below: those two are about the account, these are about
            the work, and the divider is the line between them. */}
        {hasList && (onCreate || onShowJoinModal) && (
          <div className="shrink-0 space-y-2 px-3 pb-3">
            {canCreate && onCreate && (
              <button
                type="button"
                onClick={onCreate}
                className="flex w-full items-center justify-center gap-1.5 rounded-full bg-[#16181D] px-4 py-2.5 text-[13px] font-bold text-white transition-colors hover:bg-[#3B6EF6]"
              >
                <Plus className="h-4 w-4" />
                {scopeCfg?.newLabel ?? 'New'}
              </button>
            )}
            {scopeCfg?.showJoin && onShowJoinModal && (
              <button
                type="button"
                onClick={onShowJoinModal}
                className="flex w-full items-center justify-center gap-1.5 rounded-full border border-[#16181D]/[0.14] px-4 py-2.5 text-[13px] font-semibold text-[#5A5E6B] transition-colors hover:bg-white"
              >
                <UserPlus className="h-4 w-4" />
                Join with code
              </button>
            )}
          </div>
        )}

        {/* Bottom section */}
        <div className="shrink-0 border-t border-[#16181D]/[0.08] px-3 py-3 space-y-0.5">
          {isAdmin && (
            <Link
              href="/admin"
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-[#5A5E6B] hover:bg-white/70 transition-colors"
            >
              <Settings className="w-4 h-4 text-[#8A8FA0] shrink-0" />
              Admin
            </Link>
          )}
          {navLink('/settings', 'Settings', <Settings className="w-4 h-4" />)}

          {/* Profile row */}
          <div className="flex items-center gap-3 px-3 py-2 mt-1">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarUrl}
                alt="Avatar"
                className="w-8 h-8 rounded-full object-cover shrink-0 border border-[#16181D]/10"
              />
            ) : (
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-extrabold shrink-0 select-none"
                style={{ background: 'linear-gradient(140deg, #FFB08A, #E86A92)' }}
              >
                {initials}
              </div>
            )}
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-bold text-[#16181D] truncate">{displayName}</span>
              {orgName && (
                <span className="block text-[11px] text-[#8A8FA0] truncate">{orgName}</span>
              )}
            </span>
            <button
              type="button"
              onClick={handleSignOut}
              title="Sign out"
              className="p-1.5 rounded-full hover:bg-[#16181D]/[0.08] transition-colors shrink-0"
            >
              <LogOut className="w-3.5 h-3.5 text-[#8A8FA0]" />
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}
