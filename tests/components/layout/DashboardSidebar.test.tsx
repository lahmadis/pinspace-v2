import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DashboardSidebar } from '@/components/dashboard/DashboardSidebar'

const { push, signOut } = vi.hoisted(() => ({
  push: vi.fn(),
  signOut: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/settings',
}))

vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { signOut } },
}))

vi.mock('@/lib/useAccountMode', () => ({
  resetAccountModeCache: vi.fn(),
}))

vi.mock('@/lib/ProfileContext', () => ({
  useProfile: () => ({ profile: { fullName: 'Ada Lovelace', avatarUrl: null } }),
}))

vi.mock('@/components/dashboard/SuperadminOrgSwitcher', () => ({
  SuperadminOrgSwitcher: () => <span role="link">Organization network</span>,
}))

describe('DashboardSidebar', () => {
  beforeEach(() => {
    push.mockReset()
    signOut.mockReset()
    signOut.mockResolvedValue(undefined)
  })

  it('preserves organization, shared, personal, settings, admin, and gated network destinations', () => {
    render(
      <DashboardSidebar
        currentScope="personal"
        onScopeChange={vi.fn()}
        hasOrganization
        orgName="Wentworth Institute"
        userEmail="ada@example.com"
        isAdmin
        isOpen={false}
        onToggle={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: 'Wentworth' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Shared' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Personal' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Organization network' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin')
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('Ada')).toBeInTheDocument()
  })

  it('hides authorization-controlled destinations when access is absent', () => {
    render(
      <DashboardSidebar
        currentScope="shared"
        onScopeChange={vi.fn()}
        hasOrganization={false}
        userEmail="ada@example.com"
        isAdmin={false}
        isOpen={false}
        onToggle={vi.fn()}
      />
    )

    expect(screen.queryByRole('button', { name: 'Network' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Shared' })).toHaveAttribute('aria-current', 'page')
  })

  it('closes mobile navigation after a scope change and preserves sign out', async () => {
    const user = userEvent.setup()
    const onScopeChange = vi.fn()
    const onToggle = vi.fn()
    render(
      <DashboardSidebar
        currentScope="personal"
        onScopeChange={onScopeChange}
        hasOrganization
        userEmail="ada@example.com"
        isOpen
        onToggle={onToggle}
      />
    )

    const sheet = screen.getByRole('dialog', { name: 'Dashboard navigation' })
    await user.click(within(sheet).getByRole('button', { name: 'Shared' }))
    expect(onScopeChange).toHaveBeenCalledWith('shared')
    expect(onToggle).toHaveBeenCalledOnce()

    await user.click(within(sheet).getByRole('button', { name: 'Sign out' }))
    expect(signOut).toHaveBeenCalledOnce()
    expect(push).toHaveBeenCalledWith('/sign-in')
  })

  it('uses the shared mobile sheet with contained focus, Escape/outside close, and restoration', async () => {
    const user = userEvent.setup()

    function MobileSidebarExample() {
      const [open, setOpen] = useState(false)
      return (
        <DashboardSidebar
          currentScope="personal"
          onScopeChange={vi.fn()}
          hasOrganization
          orgName="Wentworth Institute"
          userEmail="ada@example.com"
          isAdmin
          isOpen={open}
          onToggle={() => setOpen((value) => !value)}
        />
      )
    }

    render(<MobileSidebarExample />)
    const trigger = screen.getByRole('button', { name: 'Open navigation' })
    await user.click(trigger)
    let sheet = screen.getByRole('dialog', { name: 'Dashboard navigation' })
    const homeLink = within(sheet).getByRole('link', { name: 'PinSpace home' })
    const closeButton = within(sheet).getByRole('button', { name: 'Close sheet' })
    expect(homeLink).toHaveFocus()

    closeButton.focus()
    await user.tab()
    expect(homeLink).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Dashboard navigation' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()

    await user.click(trigger)
    sheet = screen.getByRole('dialog', { name: 'Dashboard navigation' })
    expect(within(sheet).getByRole('button', { name: 'Wentworth' })).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Shared' })).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Personal' })).toBeInTheDocument()
    expect(within(sheet).getByRole('link', { name: 'Organization network' })).toBeInTheDocument()
    expect(within(sheet).getByRole('link', { name: 'Admin' })).toBeInTheDocument()
    expect(within(sheet).getByRole('link', { name: 'Settings' })).toBeInTheDocument()

    await user.click(screen.getByTestId('sheet-backdrop'))
    expect(screen.queryByRole('dialog', { name: 'Dashboard navigation' })).not.toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('closes the mobile sheet when the persistent desktop sidebar becomes active', async () => {
    const user = userEvent.setup()
    const originalMatchMedia = window.matchMedia
    let notifyDesktop: (event: MediaQueryListEvent) => void = () => undefined
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        notifyDesktop = listener
      },
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }))

    function ResponsiveSidebar() {
      const [open, setOpen] = useState(false)
      return (
        <DashboardSidebar
          currentScope="personal"
          onScopeChange={vi.fn()}
          hasOrganization
          userEmail="ada@example.com"
          isOpen={open}
          onToggle={() => setOpen((value) => !value)}
        />
      )
    }

    try {
      render(<ResponsiveSidebar />)
      await user.click(screen.getByRole('button', { name: 'Open navigation' }))
      expect(screen.getByRole('dialog', { name: 'Dashboard navigation' })).toBeInTheDocument()
      expect(document.body.style.overflow).toBe('hidden')

      act(() => notifyDesktop({ matches: true } as MediaQueryListEvent))
      expect(screen.queryByRole('dialog', { name: 'Dashboard navigation' })).not.toBeInTheDocument()
      expect(document.body.style.overflow).toBe('')
      const desktopNavigation = screen.getByRole('complementary', {
        name: 'Dashboard navigation',
      })
      await waitFor(() =>
        expect(within(desktopNavigation).getByRole('link', { name: 'PinSpace' })).toHaveFocus()
      )
    } finally {
      window.matchMedia = originalMatchMedia
    }
  })
})
