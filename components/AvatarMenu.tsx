'use client'

import { LayoutDashboard, LogOut, Settings } from 'lucide-react'
import { useRouter } from 'next/navigation'

import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui'

interface AvatarMenuProps {
  email: string | null | undefined
  onSignOut: () => void
}

export default function AvatarMenu({ email, onSignOut }: AvatarMenuProps) {
  const router = useRouter()

  const initial = email?.charAt(0).toUpperCase() || 'U'
  const displayEmail = email || 'Signed in'

  return (
    <Menu>
      <MenuTrigger
        aria-label={`Open account menu for ${displayEmail}`}
        title={displayEmail}
        className="h-11 w-11 rounded-full border-border bg-accent p-0 font-bold text-background-light shadow-[var(--shadow-soft)] hover:bg-accent-light"
      >
        <span aria-hidden="true">{initial}</span>
      </MenuTrigger>

      <MenuContent aria-label="Account menu" className="w-64">
        <div className="mb-1 border-b border-border-light px-3 py-2.5">
          <p className="text-xs text-text-muted">Signed in as</p>
          <p className="truncate text-sm font-semibold text-text-primary" title={displayEmail}>
              {displayEmail}
          </p>
        </div>
        <MenuItem onSelect={() => router.push('/dashboard')}>
          <LayoutDashboard className="mr-2 h-4 w-4 text-text-muted" aria-hidden="true" />
          Dashboard
        </MenuItem>
        <MenuItem onSelect={() => router.push('/settings')}>
          <Settings className="mr-2 h-4 w-4 text-text-muted" aria-hidden="true" />
          Settings
        </MenuItem>
        <div className="my-1 border-t border-border-light" role="separator" />
        <MenuItem onSelect={onSignOut}>
          <LogOut className="mr-2 h-4 w-4 text-text-muted" aria-hidden="true" />
          Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}
