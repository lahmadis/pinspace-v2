import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AvatarMenu from '@/components/AvatarMenu'

const push = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

describe('AvatarMenu', () => {
  beforeEach(() => {
    push.mockReset()
  })

  it('opens from the keyboard and exposes dashboard, settings, and sign-out controls', async () => {
    const user = userEvent.setup()
    const onSignOut = vi.fn()
    render(<AvatarMenu email="ada@example.com" onSignOut={onSignOut} />)

    const trigger = screen.getByRole('button', { name: 'Open account menu for ada@example.com' })
    trigger.focus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Dashboard' })).toHaveFocus()
    expect(screen.getByRole('menuitem', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument()

    await user.keyboard('{ArrowDown}{Enter}')
    expect(push).toHaveBeenCalledWith('/settings')
    expect(trigger).toHaveFocus()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('preserves dashboard navigation and sign-out behavior', async () => {
    const user = userEvent.setup()
    const onSignOut = vi.fn()
    render(<AvatarMenu email="ada@example.com" onSignOut={onSignOut} />)

    await user.click(screen.getByRole('button', { name: 'Open account menu for ada@example.com' }))
    await user.click(screen.getByRole('menuitem', { name: 'Dashboard' }))
    expect(push).toHaveBeenCalledWith('/dashboard')

    await user.click(screen.getByRole('button', { name: 'Open account menu for ada@example.com' }))
    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }))
    expect(onSignOut).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('dismisses on Escape and outside pointer press with focus restoration', async () => {
    const user = userEvent.setup()
    render(<AvatarMenu email={null} onSignOut={vi.fn()} />)

    const trigger = screen.getByRole('button', { name: 'Open account menu for Signed in' })
    await user.click(trigger)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()

    await user.click(trigger)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
