'use client'

import Link from 'next/link'
import { LogOut, Menu, Network, PanelsTopLeft, Settings, User, Users } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'

import { Sheet } from '@/components/ui'
import { useProfile } from '@/lib/ProfileContext'
import { supabase } from '@/lib/supabase/client'
import { resetAccountModeCache } from '@/lib/useAccountMode'

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

interface SidebarContentProps {
  currentScope: Scope
  onScopeChange: (scope: Scope) => void
  hasOrganization: boolean
  orgLabel: string
  displayName: string
  avatarUrl?: string | null
  isAdmin?: boolean
  pathname: string
  onNavigate: () => void
  onSignOut: () => void
  includeOrgSwitcher: boolean
}

function SidebarContent({
  currentScope,
  onScopeChange,
  hasOrganization,
  orgLabel,
  displayName,
  avatarUrl,
  isAdmin,
  pathname,
  onNavigate,
  onSignOut,
  includeOrgSwitcher,
}: SidebarContentProps) {
  const initials = displayName.slice(0, 2).toUpperCase()

  const scopeButton = (scope: Scope, label: string, icon: React.ReactNode) => {
    const active = currentScope === scope

    return (
      <button
        key={scope}
        type="button"
        onClick={() => {
          onScopeChange(scope)
          onNavigate()
        }}
        aria-current={active ? 'page' : undefined}
        className={`flex min-h-11 w-full items-center gap-3 rounded-pinspace border px-3 py-2.5 text-left text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
          active
            ? 'border-border bg-primary text-text-primary shadow-[var(--shadow-soft)]'
            : 'border-transparent text-text-secondary hover:border-border-light hover:bg-background-lighter hover:text-text-primary'
        }`}
      >
        <span className="shrink-0 text-current" aria-hidden="true">{icon}</span>
        <span className="truncate">{label}</span>
      </button>
    )
  }

  const linkClass = (active: boolean) => `flex min-h-11 items-center gap-3 rounded-pinspace border px-3 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
    active
      ? 'border-border bg-primary text-text-primary shadow-[var(--shadow-soft)]'
      : 'border-transparent text-text-secondary hover:border-border-light hover:bg-background-lighter hover:text-text-primary'
  }`
  const adminActive = pathname === '/admin' || pathname.startsWith('/admin/')
  const settingsActive = pathname === '/settings' || pathname.startsWith('/settings/')
  const myBoardsActive = pathname === '/my-boards' || pathname.startsWith('/my-boards/')

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav aria-label="Project scopes" className="flex-1 space-y-0.5 overflow-y-auto px-1 py-2">
        {hasOrganization && scopeButton('wentworth', orgLabel, <Network className="h-4 w-4" />)}
        {scopeButton('shared', 'Shared', <Users className="h-4 w-4" />)}
        {scopeButton('personal', 'Personal', <User className="h-4 w-4" />)}
        <Link
          href="/my-boards"
          aria-current={myBoardsActive ? 'page' : undefined}
          onClick={onNavigate}
          className={linkClass(myBoardsActive)}
        >
          <PanelsTopLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">My boards</span>
        </Link>

        {/* The switcher remains server-gated by its own endpoint. Only one copy
            is mounted while the mobile Sheet is open to avoid duplicate reads. */}
        {includeOrgSwitcher && <SuperadminOrgSwitcher />}
      </nav>

      <div className="shrink-0 space-y-0.5 border-t border-border pt-3">
        {isAdmin && (
          <Link
            href="/admin"
            aria-current={adminActive ? 'page' : undefined}
            onClick={onNavigate}
            className={linkClass(adminActive)}
          >
            <Settings className="h-4 w-4 shrink-0" aria-hidden="true" />
            Admin
          </Link>
        )}
        <Link
          href="/settings"
          aria-current={settingsActive ? 'page' : undefined}
          onClick={onNavigate}
          className={linkClass(settingsActive)}
        >
          <Settings className="h-4 w-4 shrink-0" aria-hidden="true" />
          Settings
        </Link>

        <div className="mt-1 flex items-center gap-3 px-3 py-2">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrl}
              alt={`${displayName}'s avatar`}
              className="h-8 w-8 shrink-0 rounded-full border border-border object-cover"
            />
          ) : (
            <div
              className="flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-full bg-accent text-xs font-bold text-background-light"
              aria-hidden="true"
            >
              {initials}
            </div>
          )}
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">
            {displayName}
          </span>
          <button
            type="button"
            onClick={onSignOut}
            title="Sign out"
            aria-label="Sign out"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-pinspace text-text-secondary transition-colors hover:bg-background-lighter hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  )
}

export function DashboardSidebar({
  currentScope,
  onScopeChange,
  hasOrganization,
  orgName,
  firstName,
  userEmail,
  isAdmin,
  isOpen,
  onToggle,
}: DashboardSidebarProps) {
  const router = useRouter()
  const pathname = usePathname()
  const { profile } = useProfile()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const desktopBrandRef = useRef<HTMLAnchorElement>(null)
  const wasOpenRef = useRef(false)
  const desktopDismissalRef = useRef(false)
  const displayName =
    (profile.fullName ? profile.fullName.trim().split(/\s+/)[0] : null) ||
    firstName ||
    userEmail?.split('@')[0] ||
    'You'
  const avatarUrl = profile.avatarUrl
  // Real data (the org's own first word) is unchanged. Only the fallback noun
  // from the old account-mode copy branch is collapsed.
  const orgLabel = orgName?.split(' ')[0] || 'Network'

  useEffect(() => {
    let restoreTimer: number | undefined
    if (wasOpenRef.current && !isOpen) {
      const restoreTarget = desktopDismissalRef.current
        ? desktopBrandRef.current
        : triggerRef.current
      desktopDismissalRef.current = false
      restoreTimer = window.setTimeout(() => restoreTarget?.focus(), 0)
    }
    wasOpenRef.current = isOpen
    return () => {
      if (restoreTimer !== undefined) window.clearTimeout(restoreTimer)
    }
  }, [isOpen])

  useEffect(() => {
    const desktopQuery = window.matchMedia('(min-width: 768px)')
    const closeAtDesktop = (event: MediaQueryListEvent | MediaQueryList) => {
      desktopDismissalRef.current = event.matches
      if (event.matches && isOpen) onToggle()
    }

    closeAtDesktop(desktopQuery)
    desktopQuery.addEventListener('change', closeAtDesktop)
    return () => desktopQuery.removeEventListener('change', closeAtDesktop)
  }, [isOpen, onToggle])

  const handleSignOut = async () => {
    resetAccountModeCache()
    await supabase.auth.signOut()
    router.push('/sign-in')
  }

  const closeMobileNavigation = () => {
    if (isOpen) onToggle()
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen !== isOpen) onToggle()
  }

  const contentProps = {
    currentScope,
    onScopeChange,
    hasOrganization,
    orgLabel,
    displayName,
    avatarUrl,
    isAdmin,
    pathname,
    onSignOut: handleSignOut,
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={onToggle}
        className={`fixed left-4 top-4 z-50 inline-flex h-11 min-w-11 items-center justify-center rounded-pinspace border border-border bg-background-light text-text-primary shadow-[var(--shadow-soft)] transition-opacity hover:bg-background-lighter focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent md:hidden ${
          isOpen ? 'pointer-events-none opacity-0' : 'opacity-100'
        }`}
        aria-label="Open navigation"
        aria-expanded={isOpen}
        aria-controls={isOpen ? 'dashboard-mobile-navigation' : undefined}
        aria-hidden={isOpen || undefined}
        tabIndex={isOpen ? -1 : undefined}
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
      </button>

      <aside
        aria-label="Dashboard navigation"
        className="hidden h-dvh w-60 shrink-0 flex-col border-r border-border bg-background-light md:flex"
      >
        <div className="flex h-16 shrink-0 items-center px-5">
          <Link
            ref={desktopBrandRef}
            href="/"
            className="rounded-pinspace font-mono text-xl font-bold tracking-tight text-text-primary transition-opacity hover:opacity-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            pinspace
          </Link>
        </div>
        <div className="flex min-h-0 flex-1 flex-col px-3 pb-3">
          <SidebarContent
            {...contentProps}
            onNavigate={() => undefined}
            includeOrgSwitcher={!isOpen}
          />
        </div>
      </aside>

      <Sheet
        id="dashboard-mobile-navigation"
        open={isOpen}
        onOpenChange={handleOpenChange}
        side="left"
        title="Dashboard navigation"
        description="Choose a project scope or manage your account."
        className="max-w-[min(20rem,calc(100vw-2rem))]"
      >
        <div className="flex min-h-[calc(100dvh-10rem)] flex-col">
          <Link
            href="/"
            aria-label="pinspace home"
            onClick={closeMobileNavigation}
            className="mb-2 w-fit rounded-pinspace font-mono text-lg font-bold tracking-tight text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            pinspace
          </Link>
          <SidebarContent
            {...contentProps}
            onNavigate={closeMobileNavigation}
            includeOrgSwitcher
          />
        </div>
      </Sheet>
    </>
  )
}
