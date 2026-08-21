'use client'

import Link from 'next/link'
import { Network, Users, User, Settings, LogOut, Menu, X, Archive as ArchiveIcon, Contact } from 'lucide-react'
import { useRouter, usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import { resetAccountModeCache } from '@/lib/useAccountMode'
import { useProfile } from '@/lib/ProfileContext'
import { SuperadminOrgSwitcher } from './SuperadminOrgSwitcher'

export type Scope = 'wentworth' | 'shared' | 'personal'

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
}

export function DashboardSidebar({
  currentScope, onScopeChange, hasOrganization, orgName,
  firstName, userEmail, isAdmin, isOpen, onToggle,
}: DashboardSidebarProps) {
  const router = useRouter()
  const pathname = usePathname()
  const { profile } = useProfile()
  const displayName = (profile.fullName ? profile.fullName.trim().split(/\s+/)[0] : null) || firstName || userEmail?.split('@')[0] || 'You'
  const initials = displayName.slice(0, 2).toUpperCase()
  const avatarUrl = profile.avatarUrl
  // Real data (the org's own first word) is unchanged — both arms of the old
  // accountMode ternary computed it identically. Only the FALLBACK noun
  // branched ('Firm' vs 'Network'), which is the copy branch being collapsed.
  const orgLabel = orgName?.split(' ')[0] || 'Network'

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
          ? 'bg-white text-[#16181D] shadow-[0_2px_10px_rgba(22,24,29,0.07)]'
          : 'text-[#5A5E6B] hover:bg-white/60'
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
            ? 'bg-white text-[#16181D] shadow-[0_2px_10px_rgba(22,24,29,0.07)]'
            : 'text-[#5A5E6B] hover:bg-white/60'
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
          'fixed inset-y-0 left-0 z-40 w-60 flex flex-col border-r border-[#16181D]/8',
          'transform transition-transform duration-200 ease-in-out',
          isOpen ? 'translate-x-0' : '-translate-x-full',
          'md:relative md:translate-x-0 md:z-auto md:shrink-0',
        ].join(' ')}
        style={{ background: 'linear-gradient(180deg, #F2F5FB 0%, #EDF1F9 100%)' }}
      >
        {/* Logo row */}
        <div className="shrink-0 h-16 flex items-center justify-between px-5">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <span className="w-[22px] h-[22px] rounded-[7px] bg-[#3B6EF6] text-white flex items-center justify-center text-[11px] shrink-0">◉</span>
            <span className="text-lg font-extrabold text-[#16181D] tracking-tight">pinspace</span>
          </Link>
          <button
            type="button"
            onClick={onToggle}
            className="md:hidden p-1.5 rounded-lg hover:bg-[#16181D]/8 transition-colors"
            aria-label="Close menu"
          >
            <X className="w-4 h-4 text-[#8A8FA0]" />
          </button>
        </div>

        {/* Scope nav */}
        <nav className="flex-1 px-3 pt-2 pb-4 space-y-0.5 overflow-y-auto">
          {hasOrganization && navBtn('wentworth', orgLabel, <Network className="w-4 h-4" />)}
          {navBtn('shared', 'Shared', <Users className="w-4 h-4" />)}
          {navBtn('personal', 'Personal', <User className="w-4 h-4" />)}

          {/* Superadmin-only: read-only org network switcher. Self-gates — renders
              nothing for non-superadmins (server-verified via its endpoint). */}
          <SuperadminOrgSwitcher />

          <div className="pt-2 mt-2 border-t border-[#16181D]/8 space-y-0.5">
            {navLink('/archive', 'Archive', <ArchiveIcon className="w-4 h-4" />)}
            {navLink('/people', 'People', <Contact className="w-4 h-4" />)}
          </div>
        </nav>

        {/* Bottom section */}
        <div className="shrink-0 border-t border-[#16181D]/8 px-3 py-3 space-y-0.5">
          {isAdmin && (
            <Link
              href="/admin"
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-[#5A5E6B] hover:bg-white/60 transition-colors"
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
            <span className="flex-1 min-w-0 text-sm font-bold text-[#16181D] truncate">{displayName}</span>
            <button
              type="button"
              onClick={handleSignOut}
              title="Sign out"
              className="p-1.5 rounded-full hover:bg-[#16181D]/8 transition-colors shrink-0"
            >
              <LogOut className="w-3.5 h-3.5 text-[#8A8FA0]" />
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}
