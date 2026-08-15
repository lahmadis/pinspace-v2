import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import WorkspaceRoomsPage from '@/app/workspace/[id]/page'

const push = vi.fn()
const router = { push }
let accountRole = 'instructor'
let userId = 'owner-1'

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'workspace-1' }),
  useRouter: () => router,
}))
vi.mock('@/hooks/useAuthSession', () => ({
  useAuthSession: () => ({ status: 'authenticated', user: { id: userId, email: 'owner@example.edu' } }),
}))
vi.mock('@/lib/useAccountMode', () => ({
  useAccountMode: () => ({ mode: 'organization', resolved: true }),
}))
vi.mock('@/lib/ProfileContext', () => ({
  useProfile: () => ({ profile: { accountRole } }),
}))
vi.mock('@/components/PublishConfirmModal', () => ({ default: () => <div role="dialog">Publish metadata</div> }))
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

function workspace(overrides: Record<string, unknown> = {}) {
  return {
    id: 'workspace-1',
    name: 'A very long collaborative material systems studio title for responsive testing',
    slug: 'material-systems',
    type: 'class',
    createdBy: 'owner-1',
    studioId: 'studio-1',
    inviteCode: 'ABC123',
    createdAt: new Date('2026-08-01'),
    isPublic: false,
    isArchived: false,
    archivedAt: null,
    members: [{ userId: 'owner-1', name: 'Owner', role: 'instructor', joinedAt: new Date('2026-08-01') }],
    rooms: [{ id: 'room-1', name: 'A room name long enough to wrap without hiding controls', displayOrder: 0, isPublished: false, publishedAt: null, createdAt: null, boardCount: 4 }],
    networkMetadata: { department: 'Architecture', year: 'Year 4' },
    ...overrides,
  }
}

describe('WorkspaceRoomsPage', () => {
  beforeEach(() => {
    push.mockReset()
    userId = 'owner-1'
    accountRole = 'instructor'
  })

  it('shows loading and recoverable denied/not-found errors', async () => {
    let resolveFetch!: (value: unknown) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { resolveFetch = resolve })))
    render(<WorkspaceRoomsPage />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading workspace')

    await waitFor(() => expect(resolveFetch).toBeTypeOf('function'))
    resolveFetch({ ok: false, json: async () => ({ error: 'Workspace not found or access denied' }) })
    expect(await screen.findByRole('alert')).toHaveTextContent('Workspace not found or access denied')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('keeps room entry and every owner action visible through a touch-safe menu', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ workspace: workspace() }) }))
    const user = userEvent.setup()
    render(<WorkspaceRoomsPage />)

    expect(await screen.findByRole('link', { name: /Enter A room name long enough/ })).toHaveAttribute('href', '/studio/room-1')
    expect(screen.getByRole('link', { name: 'Invite and settings' })).toHaveAttribute('href', '/workspace/workspace-1/settings')
    const actions = screen.getByRole('button', { name: /Actions for A room name/ })
    expect(actions).toHaveClass('min-h-11')
    expect(actions).not.toHaveClass('opacity-0')
    await user.click(actions)
    const menu = screen.getByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Share room' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Publish to network' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Delete room' })).toBeInTheDocument()
  })

  it('gates owner-only controls while keeping member room entry and rename', async () => {
    userId = 'member-1'
    accountRole = 'student'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ workspace: workspace({
      type: 'shared',
      members: [
        { userId: 'owner-1', name: 'Owner', role: 'instructor', joinedAt: new Date('2026-08-01') },
        { userId: 'member-1', name: 'Member', role: 'student', joinedAt: new Date('2026-08-02') },
      ],
    }) }) }))
    const user = userEvent.setup()
    render(<WorkspaceRoomsPage />)

    expect(await screen.findByRole('link', { name: /Enter A room name/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Invite and settings' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Actions for A room name/ }))
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Publish to network' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Delete room' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add room' })).toBeInTheDocument()
  })

  it('creates and copies a room share link through the existing owner-only contract', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ workspace: workspace() }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ shareUrl: 'https://pinspace.test/share/token-1' }) })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<WorkspaceRoomsPage />)

    await user.click(await screen.findByRole('button', { name: /Actions for A room name/ }))
    await user.click(screen.getByRole('menuitem', { name: 'Share room' }))
    const dialog = await screen.findByRole('dialog', { name: 'Share room' })
    expect(fetchMock).toHaveBeenCalledWith('/api/rooms/room-1/share', { method: 'POST' })
    await user.click(within(dialog).getByRole('button', { name: 'Copy share link' }))
    expect(writeText).toHaveBeenCalledWith('https://pinspace.test/share/token-1')
  })

  it('does not expose network settings without the instructor account capability', async () => {
    accountRole = 'student'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ workspace: workspace() }) }))
    render(<WorkspaceRoomsPage />)

    expect(await screen.findByRole('link', { name: 'Invite and settings' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Network settings' })).not.toBeInTheDocument()
  })

  it('renders an empty state and validates room creation inline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ workspace: workspace({ rooms: [] }) }) }))
    const user = userEvent.setup()
    render(<WorkspaceRoomsPage />)

    expect(await screen.findByRole('heading', { name: 'No rooms yet' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add room' }))
    await user.click(screen.getByRole('button', { name: 'Create room' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a room name')
  })

  it('uses an explicit destructive dialog with guarded confirmation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ workspace: workspace() }) }))
    const user = userEvent.setup()
    render(<WorkspaceRoomsPage />)

    await user.click(await screen.findByRole('button', { name: /Actions for A room name/ }))
    await user.click(screen.getByRole('menuitem', { name: 'Delete room' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete room?' })
    expect(dialog).toHaveTextContent('Every board in this room')
    expect(within(dialog).getByRole('button', { name: 'Delete room' })).toBeEnabled()
  })
})
