import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { DashboardMain, type DashboardWorkspace } from '@/components/dashboard/DashboardMain'

vi.mock('@/lib/ProfileContext', () => ({
  useProfile: () => ({ profile: { accountRole: 'instructor' } }),
}))

function workspace(overrides: Partial<DashboardWorkspace> = {}): DashboardWorkspace {
  return {
    id: 'workspace-1',
    name: 'North Studio',
    slug: 'north-studio',
    type: 'personal',
    createdBy: 'owner-1',
    studioId: 'studio-1',
    members: [],
    inviteCode: 'ABC123',
    createdAt: new Date('2026-08-01T00:00:00Z'),
    isPublic: false,
    isArchived: false,
    archivedAt: null,
    owner_id: 'owner-1',
    board_count: 3,
    ...overrides,
  }
}

const baseProps = {
  scope: 'personal' as const,
  userId: 'owner-1',
  institutionHome: null,
  loading: false,
  organization: null,
  onDelete: vi.fn(),
  onRename: vi.fn(),
  onLeave: vi.fn(),
  onShowJoinModal: vi.fn(),
}

describe('DashboardMain', () => {
  it('renders the project hierarchy, responsive actions, and touch-safe keyboard menu', async () => {
    const user = userEvent.setup()
    const onRename = vi.fn()
    const onDelete = vi.fn()
    render(
      <DashboardMain
        {...baseProps}
        rooms={[workspace()]}
        onRename={onRename}
        onDelete={onDelete}
      />
    )

    expect(screen.getByRole('heading', { level: 1, name: 'Personal Projects' })).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'New Personal Project' })[0]).toHaveAttribute('href', '/studio/new')
    expect(screen.getByRole('link', { name: /North Studio/ })).toHaveAttribute('href', '/workspace/workspace-1')

    const menuButton = screen.getByRole('button', { name: 'Actions for North Studio' })
    expect(menuButton).toHaveClass('min-h-11')
    expect(menuButton).not.toHaveClass('opacity-0')
    menuButton.focus()
    await user.keyboard('{ArrowDown}')

    const menu = screen.getByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: 'Settings' })).toHaveAttribute(
      'href',
      '/workspace/workspace-1/settings'
    )
    await user.click(within(menu).getByRole('menuitem', { name: 'Rename' }))
    expect(onRename).toHaveBeenCalledWith('workspace-1', 'North Studio')

    await user.click(menuButton)
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
    expect(onDelete).toHaveBeenCalledWith('workspace-1', 'North Studio')
  })

  it('preserves member leave and archive visibility behavior', async () => {
    const user = userEvent.setup()
    const onLeave = vi.fn()
    render(
      <DashboardMain
        {...baseProps}
        scope="shared"
        rooms={[
          workspace({ id: 'member-project', name: 'Shared Lab', type: 'shared', owner_id: 'someone-else' }),
          workspace({ id: 'archived-project', name: 'Archive', type: 'shared', is_archived: true }),
        ]}
        onLeave={onLeave}
      />
    )

    expect(screen.queryByRole('link', { name: /Archive/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show archived' }))
    expect(screen.getByRole('link', { name: /Archive/ })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Actions for Shared Lab' }))
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: 'Leave project' }))
    expect(onLeave).toHaveBeenCalledWith('member-project', 'Shared Lab')
  })

  it('announces loading and provides useful empty-state actions', async () => {
    const { rerender } = render(<DashboardMain {...baseProps} rooms={[]} loading />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading projects')

    rerender(
      <DashboardMain
        {...baseProps}
        scope="shared"
        rooms={[]}
      />
    )
    expect(screen.getByRole('heading', { name: 'No shared projects yet' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Join with code' }).length).toBeGreaterThan(0)
  })
})
