import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@react-three/fiber', () => ({
  Canvas: () => <div data-testid="minimap-canvas" />,
  useFrame: vi.fn(),
  useThree: () => ({ camera: {} }),
}))
vi.mock('@react-three/drei', () => ({
  Text: () => null,
  Html: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

import { Minimap } from '@/components/Gallery3D'

describe('Gallery minimap dialog', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  it('traps focus, closes on Escape, and restores the stable expand trigger', async () => {
    const user = userEvent.setup()
    render(<Minimap studios={[]} avatarPos={{ x: 0, y: 0, z: 0 }} />)

    const expand = screen.getByRole('button', { name: 'Expand gallery map' })
    await user.click(expand)

    const dialog = screen.getByRole('dialog', { name: 'Gallery Map' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
    const close = screen.getByRole('button', { name: 'Close minimap' })
    expect(close).toHaveFocus()

    await user.tab()
    expect(close).toHaveFocus()
    await user.tab({ shift: true })
    expect(close).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Gallery Map' })).not.toBeInTheDocument()
    expect(expand).toHaveFocus()
  })
})
