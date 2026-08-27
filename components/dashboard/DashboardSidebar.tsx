'use client'

import Link from 'next/link'
import { useState } from 'react'
import {
  Network, Users, User, Settings, LogOut, Menu, X, PencilRuler, ChevronDown,
} from 'lucide-react'
import { useRouter, usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import { resetAccountModeCache } from '@/lib/useAccountMode'
import { useProfile } from '@/lib/ProfileContext'
import { SuperadminOrgSwitcher } from './SuperadminOrgSwitcher'
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
  workspace, href, dimmed,
}: { workspace: DashboardWorkspace; href: string; dimmed?: boolean }) {
  const boards = workspace.board_count ?? 0
  const rooms = workspace.room_count ?? 0
  const sub = [
    rooms > 0 ? `${rooms} room${rooms === 1 ? '' : 's'}` : null,
    boards > 0 ? `${boards} board${boards === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(' · ') || 'Empty'

  return (
    <Link
      href={href}
      className={`group flex items-center gap-2.5 rounded-xl px-2.5 py-2 transition-colors hover:bg-white ${
        dimmed ? 'opacity-70' : ''
      }`}
    >
      {/* Stand-in for the studio's own preview, which we don't render yet.
          A tinted tile still gives the row an anchor for the eye to run down. */}
      <span
        aria-hidden="true"
        className="h-7 w-7 shrink-0 rounded-lg border border-[#16181D]/[0.08]"
        style={{ background: 'linear-gradient(140deg, #E8EEF9, #D8E2F2)' }}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-[#16181D] group-hover:text-[#3B6EF6]">
          {workspace.name || 'Unnamed'}
        </span>
        <span className="block truncate text-[11px] text-[#8A8FA0]">{sub}</span>
      </span>
    </Link>
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
  label, items, open, onToggle, institutionSlug, dimmed,
}: {
  label: string
  items: DashboardWorkspace[]
  open: boolean
  onToggle: () => void
  institutionSlug: string | null
  dimmed?: boolean
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
  firstName, userEmail, isAdmin, isOpen, onToggle,
  workspaces, scopeCfg, institutionSlug,
}: DashboardSidebarProps) {
  const router = useRouter()
  const pathname = usePathname()
  const { profile } = useProfile()
  const [showTerm, setShowTerm] = useState(true)
  const [showPast, setShowPast] = useState(false)

  const displayName = (profile.fullName ? profile.fullName.trim().split(/\s+/)[0] : null) || firstName || userEmail?.split('@')[0] || 'You'
  const initials = displayName.slice(0, 2).toUpperCase()
  const avatarUrl = profile.avatarUrl
  // Real data (the org's own first word) is unchanged — both arms of the old
  // accountMode ternary computed it identically. Only the FALLBACK noun
  // branched ('Firm' vs 'Network'), which is the copy branch being collapsed.
  const orgLabel = orgName?.split(' ')[0] || 'Network'

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

  const navBtn = (scope: Scope, label: string, icon: React.ReactNode) => (
    <button
      key={scope}
      type="button"
      onClick={() => handleScopeClick(scope)}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors text-left ${
        currentScope === scope
          ? 'bg-[#3B6EF6]/10 text-[#16181D]'
          : 'text-[#5A5E6B] hover:bg-white/70'
      }`}
    >
      <span className={`shrink-0 ${currentScope === scope ? 'text-[#3B6EF6]' : 'text-[#8A8FA0]'}`}>{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  )

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
          <button
            type="button"
            onClick={onToggle}
            className="md:hidden p-1.5 rounded-lg hover:bg-[#16181D]/[0.08] transition-colors"
            aria-label="Close menu"
          >
            <X className="w-4 h-4 text-[#8A8FA0]" />
          </button>
        </div>

        {/* Scrollable middle: scopes, then this scope's studios */}
        <nav className="flex-1 px-3 pt-2 pb-4 overflow-y-auto">
          <div className="space-y-0.5">
            {hasOrganization && navBtn('wentworth', orgLabel, <Network className="w-4 h-4" />)}
            {navBtn('shared', 'Shared', <Users className="w-4 h-4" />)}
            {navBtn('personal', 'Personal', <User className="w-4 h-4" />)}

            {/* Superadmin-only: read-only org network switcher. Self-gates — renders
                nothing for non-superadmins (server-verified via its endpoint). */}
            <SuperadminOrgSwitcher />

            {/* The standalone Archive nav item is gone — archived studios are
                reachable from the Past studios group below, in the scope you're
                already looking at, rather than from a separate page. */}
            <div className="pt-2 mt-2 border-t border-[#16181D]/[0.08] space-y-0.5">
              {navLink('/desk-crits', 'Desk crits', <PencilRuler className="w-4 h-4" />)}
            </div>
          </div>

          {hasList && live.length > 0 && (
            <StudioGroup
              label={scopeCfg?.listLabel ?? 'Studios'}
              items={live}
              open={showTerm}
              onToggle={() => setShowTerm((v) => !v)}
              institutionSlug={institutionSlug ?? null}
            />
          )}

          {hasList && past.length > 0 && (
            <StudioGroup
              label="Past studios"
              items={past}
              open={showPast}
              onToggle={() => setShowPast((v) => !v)}
              institutionSlug={institutionSlug ?? null}
              dimmed
            />
          )}
        </nav>

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
