import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LayoutDashboard, Settings } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'

import { AppShell } from '@/components/layout/AppShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { StudioShell } from '@/components/layout/StudioShell'

const navigation = [
  { href: '/dashboard', label: 'Dashboard', icon: <LayoutDashboard aria-hidden="true" /> },
  { href: '/settings', label: 'Settings', icon: <Settings aria-hidden="true" /> },
]

describe('AppShell', () => {
  it('exposes the complete desktop navigation and marks the active route', () => {
    render(
      <AppShell navigation={navigation} currentPath="/dashboard/project/42">
        <p>Project content</p>
      </AppShell>
    )

    const desktopNavigation = screen.getByRole('navigation', { name: 'Primary navigation' })
    expect(within(desktopNavigation).getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(within(desktopNavigation).getByRole('link', { name: 'Settings' })).not.toHaveAttribute(
      'aria-current'
    )
    expect(screen.getByRole('main')).toHaveTextContent('Project content')
  })

  it('shows the same destinations in the mobile sheet and closes after navigation', async () => {
    const user = userEvent.setup()
    render(
      <AppShell navigation={navigation} currentPath="/settings">
        Content
      </AppShell>
    )

    const trigger = screen.getByRole('button', { name: 'Open navigation' })
    await user.click(trigger)
    const sheet = screen.getByRole('dialog', { name: 'Navigation' })
    const mobileNavigation = within(sheet).getByRole('navigation', { name: 'Mobile navigation' })
    expect(within(mobileNavigation).getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(within(mobileNavigation).getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Dashboard',
      'Settings',
    ])

    const dashboardLink = within(mobileNavigation).getByRole('link', { name: 'Dashboard' })
    dashboardLink.addEventListener('click', (event) => event.preventDefault())
    await user.click(dashboardLink)
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument()
  })

  it('contains focus, closes with Escape, and restores focus to the mobile trigger', async () => {
    const user = userEvent.setup()
    render(
      <AppShell navigation={navigation} currentPath="/dashboard">
        Content
      </AppShell>
    )

    const trigger = screen.getByRole('button', { name: 'Open navigation' })
    await user.click(trigger)
    const sheet = screen.getByRole('dialog', { name: 'Navigation' })
    const dashboardLink = within(sheet).getByRole('link', { name: 'Dashboard' })
    const closeButton = within(sheet).getByRole('button', { name: 'Close sheet' })
    expect(dashboardLink).toHaveFocus()

    closeButton.focus()
    await user.tab()
    expect(dashboardLink).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('closes on an outside press and restores focus', async () => {
    const user = userEvent.setup()
    render(
      <AppShell navigation={navigation} currentPath="/dashboard">
        Content
      </AppShell>
    )

    const trigger = screen.getByRole('button', { name: 'Open navigation' })
    await user.click(trigger)
    await user.click(screen.getByTestId('sheet-backdrop'))
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('renders authenticated user controls in both navigation modes', async () => {
    const user = userEvent.setup()
    render(
      <AppShell
        navigation={navigation}
        currentPath="/dashboard"
        userControls={<button type="button">Account for ada@example.com</button>}
      >
        Content
      </AppShell>
    )

    expect(screen.getByRole('button', { name: 'Account for ada@example.com' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Open navigation' }))
    expect(
      within(screen.getByRole('dialog', { name: 'Navigation' })).getByRole('button', {
        name: 'Account for ada@example.com',
      })
    ).toBeInTheDocument()
  })

  it('closes the mobile sheet when the viewport crosses into desktop navigation', async () => {
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

    try {
      render(
        <AppShell navigation={navigation} currentPath="/dashboard">
          Content
        </AppShell>
      )
      await user.click(screen.getByRole('button', { name: 'Open navigation' }))
      expect(screen.getByRole('dialog', { name: 'Navigation' })).toBeInTheDocument()
      expect(document.body.style.overflow).toBe('hidden')

      act(() => notifyDesktop({ matches: true } as MediaQueryListEvent))
      expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument()
      expect(document.body.style.overflow).toBe('')
      const desktopNavigation = screen.getByLabelText('Application sidebar')
      await waitFor(() =>
        expect(within(desktopNavigation).getByRole('link', { name: 'PinSpace' })).toHaveFocus()
      )
    } finally {
      window.matchMedia = originalMatchMedia
    }
  })
})

describe('layout surfaces', () => {
  it('gives page headers a single labelled title and action region', () => {
    render(
      <PageHeader
        eyebrow="Workspace"
        title="Material studies"
        description="Review the active rooms."
        actions={<button type="button">Create room</button>}
      />
    )

    expect(screen.getByRole('heading', { level: 1, name: 'Material studies' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Page actions' })).toContainElement(
      screen.getByRole('button', { name: 'Create room' })
    )
  })

  it('provides an immersive studio landmark without constraining its canvas', () => {
    render(
      <StudioShell controls={<button type="button">Share</button>}>
        <div data-testid="canvas">3D canvas</div>
      </StudioShell>
    )

    expect(screen.getByRole('main', { name: 'Studio' })).toContainElement(screen.getByTestId('canvas'))
    expect(screen.getByRole('group', { name: 'Studio controls' })).toContainElement(
      screen.getByRole('button', { name: 'Share' })
    )
  })
})
