import type { ReactNode } from 'react'

import { cn } from '@/components/ui/utils'

import { AppSidebar, type AppNavigationItem } from './AppSidebar'
import { MobileNav } from './MobileNav'

export interface AppShellProps {
  children: ReactNode
  navigation: AppNavigationItem[]
  currentPath: string
  footerNavigation?: AppNavigationItem[]
  brandLabel?: string
  brandHref?: string
  userControls?: ReactNode
  className?: string
  contentClassName?: string
}

export function AppShell({
  children,
  navigation,
  currentPath,
  footerNavigation = [],
  brandLabel = 'PinSpace',
  brandHref = '/',
  userControls,
  className,
  contentClassName,
}: AppShellProps) {
  const navigationProps = {
    navigation,
    currentPath,
    footerNavigation,
    brandLabel,
    brandHref,
    userControls,
  }

  return (
    <div className={cn('flex min-h-dvh w-full max-w-full overflow-x-clip bg-background text-text-primary', className)}>
      <AppSidebar {...navigationProps} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileNav {...navigationProps} />
        <main className={cn('min-w-0 flex-1 overflow-x-clip', contentClassName)}>{children}</main>
      </div>
    </div>
  )
}
