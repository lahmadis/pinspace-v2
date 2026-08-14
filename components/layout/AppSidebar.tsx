import Link from 'next/link'
import type { ReactNode } from 'react'

import { cn } from '@/components/ui/utils'

export interface AppNavigationItem {
  href: string
  label: string
  icon?: ReactNode
  exact?: boolean
}

export interface AppSidebarProps {
  navigation: AppNavigationItem[]
  currentPath: string
  footerNavigation?: AppNavigationItem[]
  brandLabel?: string
  brandHref?: string
  userControls?: ReactNode
  className?: string
}

export function isNavigationItemActive(item: AppNavigationItem, currentPath: string) {
  const current = currentPath.split(/[?#]/, 1)[0].replace(/\/$/, '') || '/'
  const target = item.href.split(/[?#]/, 1)[0].replace(/\/$/, '') || '/'

  if (item.exact || target === '/') return current === target
  return current === target || current.startsWith(`${target}/`)
}

export function AppNavigationLinks({
  navigation,
  currentPath,
  onNavigate,
}: {
  navigation: AppNavigationItem[]
  currentPath: string
  onNavigate?: () => void
}) {
  return navigation.map((item) => {
    const active = isNavigationItemActive(item, currentPath)

    return (
      <Link
        key={`${item.href}-${item.label}`}
        href={item.href}
        aria-current={active ? 'page' : undefined}
        onClick={onNavigate}
        className={cn(
          'flex min-h-11 items-center gap-3 rounded-kova border px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background-light',
          active
            ? 'border-border bg-primary text-text-primary shadow-[var(--shadow-soft)]'
            : 'border-transparent text-text-secondary hover:border-border-light hover:bg-background-lighter hover:text-text-primary'
        )}
      >
        {item.icon && <span className="flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden="true">{item.icon}</span>}
        <span className="min-w-0 truncate">{item.label}</span>
      </Link>
    )
  })
}

export function AppSidebar({
  navigation,
  currentPath,
  footerNavigation = [],
  brandLabel = 'Kova',
  brandHref = '/',
  userControls,
  className,
}: AppSidebarProps) {
  return (
    <aside
      aria-label="Application sidebar"
      className={cn(
        'hidden h-dvh w-64 shrink-0 flex-col border-r border-border bg-background-light lg:flex',
        className
      )}
    >
      <div className="flex min-h-16 items-center border-b border-border-light px-5">
        <Link
          href={brandHref}
          data-desktop-navigation-focus
          className="rounded-kova font-mono text-lg font-bold tracking-tight text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {brandLabel}
        </Link>
      </div>

      <nav aria-label="Primary navigation" className="flex-1 space-y-1 overflow-y-auto p-3">
        <AppNavigationLinks navigation={navigation} currentPath={currentPath} />
      </nav>

      {(footerNavigation.length > 0 || userControls) && (
        <div className="border-t border-border-light p-3">
          {footerNavigation.length > 0 && (
            <nav aria-label="Secondary navigation" className="space-y-1">
              <AppNavigationLinks navigation={footerNavigation} currentPath={currentPath} />
            </nav>
          )}
          {userControls && <div className="mt-3 border-t border-border-light pt-3">{userControls}</div>}
        </div>
      )}
    </aside>
  )
}
