'use client'

import Link from 'next/link'
import { Menu as MenuIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'

import { IconButton, Sheet } from '@/components/ui'

import { AppNavigationLinks, type AppNavigationItem } from './AppSidebar'

export interface MobileNavProps {
  navigation: AppNavigationItem[]
  currentPath: string
  footerNavigation?: AppNavigationItem[]
  brandLabel?: string
  brandHref?: string
  userControls?: ReactNode
}

export function MobileNav({
  navigation,
  currentPath,
  footerNavigation = [],
  brandLabel = 'Kova',
  brandHref = '/',
  userControls,
}: MobileNavProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const wasOpenRef = useRef(false)
  const desktopDismissalRef = useRef(false)
  const close = () => setOpen(false)

  useEffect(() => {
    let restoreTimer: number | undefined
    if (wasOpenRef.current && !open) {
      // Outside-pointer dismissal finishes its click sequence after the Sheet
      // unmounts, so restore on the next task to avoid focus falling to <body>.
      const restoreTarget = desktopDismissalRef.current
        ? document.querySelector<HTMLElement>('[data-desktop-navigation-focus]')
        : triggerRef.current
      desktopDismissalRef.current = false
      restoreTimer = window.setTimeout(() => restoreTarget?.focus(), 0)
    }
    wasOpenRef.current = open
    return () => {
      if (restoreTimer !== undefined) window.clearTimeout(restoreTimer)
    }
  }, [open])

  useEffect(() => {
    const desktopQuery = window.matchMedia('(min-width: 1024px)')
    const closeAtDesktop = (event: MediaQueryListEvent | MediaQueryList) => {
      desktopDismissalRef.current = event.matches
      if (event.matches) setOpen(false)
    }

    closeAtDesktop(desktopQuery)
    desktopQuery.addEventListener('change', closeAtDesktop)
    return () => desktopQuery.removeEventListener('change', closeAtDesktop)
  }, [])

  return (
    <>
      <div className="flex min-h-16 items-center justify-between gap-3 border-b border-border bg-background-light px-4 lg:hidden">
        <Link
          href={brandHref}
          className="min-w-0 truncate rounded-kova font-mono text-lg font-bold tracking-tight text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {brandLabel}
        </Link>
        <IconButton
          ref={triggerRef}
          label="Open navigation"
          aria-expanded={open}
          aria-controls={open ? 'mobile-navigation' : undefined}
          onClick={() => setOpen(true)}
        >
          <MenuIcon className="h-5 w-5" aria-hidden="true" />
        </IconButton>
      </div>

      <Sheet
        id="mobile-navigation"
        open={open}
        onOpenChange={setOpen}
        side="left"
        title="Navigation"
        description="Move between Kova workspaces and account areas."
        className="max-w-[min(20rem,calc(100vw-2rem))]"
      >
        <nav aria-label="Mobile navigation" className="space-y-1">
          <AppNavigationLinks navigation={navigation} currentPath={currentPath} onNavigate={close} />
          {footerNavigation.length > 0 && (
            <div className="mt-4 space-y-1 border-t border-border-light pt-4">
              <AppNavigationLinks
                navigation={footerNavigation}
                currentPath={currentPath}
                onNavigate={close}
              />
            </div>
          )}
        </nav>
        {userControls && <div className="mt-5 border-t border-border-light pt-4">{userControls}</div>}
      </Sheet>
    </>
  )
}
