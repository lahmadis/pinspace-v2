import axe from 'axe-core'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { DashboardMain } from '@/components/dashboard/DashboardMain'
import MyBoardsPage from '@/app/my-boards/page'

const { router } = vi.hoisted(() => ({ router: { push: vi.fn() } }))

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

vi.mock('next/navigation', () => ({ useRouter: () => router }))

vi.mock('@/hooks/useAuthSession', () => ({
  useAuthSession: () => ({ status: 'authenticated' }),
}))

vi.mock('@/lib/ProfileContext', () => ({
  useProfile: () => ({ profile: { accountRole: 'instructor' } }),
}))

describe('dashboard accessibility', () => {
  it('has no serious or critical automated accessibility violations in the mocked empty state', async () => {
    const { container } = render(
      <DashboardMain
        scope="shared"
        rooms={[]}
        userId="user-1"
        institutionHome={null}
        loading={false}
        organization={null}
        onDelete={vi.fn()}
        onRename={vi.fn()}
        onLeave={vi.fn()}
        onShowJoinModal={vi.fn()}
      />
    )

    const result = await axe.run(container, {
      rules: {
        // JSDOM has no layout engine, so contrast needs browser-level evidence.
        'color-contrast': { enabled: false },
      },
    })
    const blocking = result.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')
    expect(blocking).toEqual([])
  })

  it('has no serious or critical automated violations in the mocked board empty state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ boards: [] }),
    }))
    const { container } = render(<MyBoardsPage />)
    await screen.findByRole('heading', { name: 'No boards yet' })

    const result = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false } },
    })
    const blocking = result.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')
    expect(blocking).toEqual([])
  })
})
