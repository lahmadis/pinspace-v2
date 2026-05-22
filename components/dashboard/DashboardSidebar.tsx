'use client'

import Link from 'next/link'
import { Network, Users, User, Settings, LogOut, Menu, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import { resetAccountModeCache } from '@/lib/useAccountMode'
import { useProfile } from '@/lib/ProfileContext'

export type Scope = 'wentworth' | 'shared' | 'personal'

interface DashboardSidebarProps {
  currentScope: Scope
  onScopeChange: (scope: Scope) => void
  hasOrganization: boolean
  orgName?: string | null
  accountMode?: string
  firstName?: string | null
  userEmail?: string | null
  isAdmin?: boolean
  isOpen: boolean
  onToggle: () => void
}

export function DashboardSidebar({
  currentScope, onScopeChange, hasOrganization, orgName, accountMode,
  firstName, userEmail, isAdmin, isOpen, onToggle,
}: DashboardSidebarProps) {
  const router = useRouter()
  const { profile } = useProfile()
  const displayName = (profile.fullName ? profile.fullName.trim().split(/\s+/)[0] : null) || firstName || userEmail?.split('@')[0] || 'You'
  const initials = displayName.slice(0, 2).toUpperCase()
  const avatarUrl = profile.avatarUrl
  const orgLabel = accountMode === 'firm' ? (orgName?.split(' ')[0] || 'Firm') : (orgName?.split(' ')[0] || 'Network')

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
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left ${
        currentScope === scope
          ? 'bg-indigo-600 text-white shadow-sm'
          : 'text-gray-700 hover:bg-white hover:shadow-sm'
      }`}
    >
      <span className={`shrink-0 ${currentScope === scope ? 'text-white' : 'text-gray-400'}`}>{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  )

  return (
    <>
      {/* Mobile hamburger — only visible when sidebar is closed */}
      {!isOpen && (
        <button
          type="button"
          onClick={onToggle}
          className="fixed top-4 left-4 z-50 md:hidden p-2 rounded-lg bg-white border border-gray-200 shadow-sm text-gray-600 hover:bg-gray-50"
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
          'fixed inset-y-0 left-0 z-40 w-60 flex flex-col bg-[#f3f4f6] border-r border-gray-200',
          'transform transition-transform duration-200 ease-in-out',
          isOpen ? 'translate-x-0' : '-translate-x-full',
          'md:relative md:translate-x-0 md:z-auto md:shrink-0',
        ].join(' ')}
      >
        {/* Logo row */}
        <div className="shrink-0 h-16 flex items-center justify-between px-5">
          <Link href="/" className="hover:opacity-80 transition-opacity">
            <span className="text-xl font-bold text-gray-900 tracking-tight">PinSpace</span>
          </Link>
          <button
            type="button"
            onClick={onToggle}
            className="md:hidden p-1.5 rounded-lg hover:bg-gray-200 transition-colors"
            aria-label="Close menu"
          >
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        {/* Scope nav */}
        <nav className="flex-1 px-3 pt-2 pb-4 space-y-0.5 overflow-y-auto">
          {hasOrganization && navBtn('wentworth', orgLabel, <Network className="w-4 h-4" />)}
          {navBtn('shared', 'Shared', <Users className="w-4 h-4" />)}
          {navBtn('personal', 'Personal', <User className="w-4 h-4" />)}
        </nav>

        {/* Bottom section */}
        <div className="shrink-0 border-t border-gray-200 px-3 py-3 space-y-0.5">
          {isAdmin && (
            <Link
              href="/admin"
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-600 hover:bg-white hover:shadow-sm transition-colors"
            >
              <Settings className="w-4 h-4 text-gray-400 shrink-0" />
              Admin
            </Link>
          )}
          <Link
            href="/settings"
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-600 hover:bg-white hover:shadow-sm transition-colors"
          >
            <Settings className="w-4 h-4 text-gray-400 shrink-0" />
            Settings
          </Link>

          {/* Profile row */}
          <div className="flex items-center gap-3 px-3 py-2 mt-1">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarUrl}
                alt="Avatar"
                className="w-7 h-7 rounded-full object-cover shrink-0 border border-gray-200"
              />
            ) : (
              <div className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center text-white text-xs font-bold shrink-0 select-none">
                {initials}
              </div>
            )}
            <span className="flex-1 min-w-0 text-sm font-medium text-gray-800 truncate">{displayName}</span>
            <button
              type="button"
              onClick={handleSignOut}
              title="Sign out"
              className="p-1 rounded hover:bg-gray-200 transition-colors shrink-0"
            >
              <LogOut className="w-3.5 h-3.5 text-gray-500" />
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}
