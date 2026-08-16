import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import WorkspaceSettingsPage from '@/app/workspace/[id]/settings/page'

const push = vi.fn()
const router = { push }
let userId = 'owner-1'

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'workspace-1' }),
  useRouter: () => router,
}))
vi.mock('@/hooks/useAuthSession', () => ({
  useAuthSession: () => ({ status: 'authenticated', user: { id: userId } }),
}))
vi.mock('next/dynamic', () => ({ default: () => () => <svg aria-label="Invite QR code" /> }))
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

function workspace(overrides: Record<string, unknown> = {}) {
  return {
    id: 'workspace-1',
    name: 'Community Housing Systems Studio With A Long Responsive Title',
    slug: 'community-housing',
    type: 'class',
    createdBy: 'owner-1',
    studioId: 'studio-1',
    inviteCode: 'ABC123',
    createdAt: new Date('2026-08-01'),
    isPublic: false,
    isArchived: false,
    archivedAt: null,
    members: [{ userId: 'owner-1', name: 'Owner', role: 'instructor', joinedAt: new Date('2026-08-01') }],
    rooms: [{ id: 'room-1', name: 'Review room', displayOrder: 0, isPublished: false, publishedAt: null, createdAt: null, wallColor: 'grey' }],
    ...overrides,
  }
}

describe('WorkspaceSettingsPage', () => {
  beforeEach(() => {
    userId = 'owner-1'
    push.mockReset()
    Object.defineProperty(window, 'location', { configurable: true, value: { origin: 'https://pinspace.test' } })
  })

  it('renders loading and recoverable errors without redirecting away', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Access denied' }) }))
    render(<WorkspaceSettingsPage />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading workspace settings')
    expect(await screen.findByRole('alert')).toHaveTextContent('Access denied')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(push).not.toHaveBeenCalledWith('/dashboard')
  })

  it('keeps invitation capability private from ordinary members', async () => {
    userId = 'member-1'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ workspace: workspace({ members: [
      { userId: 'owner-1', name: 'Owner', role: 'instructor', joinedAt: new Date('2026-08-01') },
      { userId: 'member-1', name: 'Member', role: 'student', joinedAt: new Date('2026-08-02') },
    ] }) }) }))
    render(<WorkspaceSettingsPage />)

    expect(await screen.findByRole('heading', { name: 'Members' })).toBeInTheDocument()
    expect(screen.queryByText('ABC123')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy invite link' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Room settings' })).not.toBeInTheDocument()
  })

  it('does not expose owner-only settings to a non-owner instructor member', async () => {
    userId = 'instructor-2'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ workspace: workspace({ members: [
      { userId: 'owner-1', name: 'Owner', role: 'instructor', joinedAt: new Date('2026-08-01') },
      { userId: 'instructor-2', name: 'Co-instructor', role: 'instructor', joinedAt: new Date('2026-08-02') },
    ] }) }) }))
    render(<WorkspaceSettingsPage />)

    expect(await screen.findByRole('heading', { name: 'Members' })).toBeInTheDocument()
    expect(screen.queryByText('ABC123')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Room settings' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Archive project' })).not.toBeInTheDocument()
  })

  it('shows a clear room settings empty state to the owner', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ workspace: workspace({ rooms: [] }) }) }))
    render(<WorkspaceSettingsPage />)

    expect(await screen.findByRole('heading', { name: 'No rooms yet' })).toBeInTheDocument()
  })

  it('labels room settings and saves wall color through the existing API contract', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ workspace: workspace() }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ workspace: workspace({ rooms: [{ ...workspace().rooms[0], wallColor: 'white' }] }) }) })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<WorkspaceSettingsPage />)

    await user.click(await screen.findByRole('radio', { name: 'White walls' }))
    expect(fetchMock).toHaveBeenCalledWith('/api/rooms/room-1', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ wallColor: 'white' }),
    }))
  })

  it('requires explicit archive confirmation and guards pending dismissal', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ workspace: workspace() }) })
      .mockImplementationOnce(() => new Promise(() => {}))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<WorkspaceSettingsPage />)

    await user.click(await screen.findByRole('button', { name: 'Archive project' }))
    const dialog = screen.getByRole('dialog', { name: 'Archive project?' })
    expect(dialog).toHaveTextContent('read-only')
    await user.click(within(dialog).getByRole('button', { name: 'Archive project' }))
    expect(within(dialog).getByRole('button', { name: 'Archiving…' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled()
  })

  it('uses an explicit delete-room dialog that names cascading board deletion', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ workspace: workspace() }) }))
    const user = userEvent.setup()
    render(<WorkspaceSettingsPage />)

    await user.click(await screen.findByRole('button', { name: 'Delete Review room' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete room?' })
    expect(dialog).toHaveTextContent('Every board in this room')
  })
})
