import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { auth, push, replace } = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  auth: {
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(),
  },
}))

let routeParams: Record<string, string | undefined> = { code: 'SECRET-CODE' }

vi.mock('next/navigation', () => ({
  useParams: () => routeParams,
  useRouter: () => ({ push, replace }),
}))

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

vi.mock('@/lib/supabase/client', () => ({ supabase: { auth } }))
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import FirmHandoffPage from '@/app/f/[slug]/page'
import InstitutionHandoffPage from '@/app/i/[slug]/page'
import JoinWorkspacePage from '@/app/join/[code]/page'

function subscription() {
  return { data: { subscription: { unsubscribe: vi.fn() } } }
}

function workspace() {
  return {
    id: 'workspace-1',
    name: 'Material Futures',
    inviteCode: 'SECRET-CODE',
    memberCount: 14,
    institutionSlug: 'north-school',
  }
}

describe('Kova join and institution handoffs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    routeParams = { code: 'SECRET-CODE' }
    auth.getSession.mockResolvedValue({ data: { session: null } })
    auth.onAuthStateChange.mockReturnValue(subscription())
  })

  it('announces invite loading without exposing the invite capability', async () => {
    let resolveSession!: (value: unknown) => void
    auth.getSession.mockReturnValue(new Promise((resolve) => { resolveSession = resolve }))
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)))
    const { unmount } = render(<JoinWorkspacePage />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading invitation')
    expect(screen.queryByText('SECRET-CODE')).not.toBeInTheDocument()

    unmount()
    expect(resolveSession).toBeTypeOf('function')
  })

  it('loads public invitation details even when session lookup never settles', async () => {
    auth.getSession.mockReturnValue(new Promise(() => undefined))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ workspace: workspace() }) }))
    render(<JoinWorkspacePage />)

    expect(await screen.findByRole('heading', { name: 'Join Material Futures' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign in to join' })).toBeInTheDocument()
  })

  it('shows a generic invalid or expired state without echoing the code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }))
    render(<JoinWorkspacePage />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Invitation unavailable')
    expect(alert).toHaveTextContent('invalid, expired, or no longer available')
    expect(screen.queryByText('SECRET-CODE')).not.toBeInTheDocument()
  })

  it('renders a populated signed-out invite without revealing its code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ workspace: workspace() }) }))
    render(<JoinWorkspacePage />)

    expect(await screen.findByRole('heading', { name: 'Join Material Futures' })).toBeInTheDocument()
    expect(screen.getByText('14 members')).toBeInTheDocument()
    expect(screen.queryByText('SECRET-CODE')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign in to join' })).toHaveAttribute(
      'href',
      '/sign-in?institution=north-school&redirect=/join/SECRET-CODE',
    )
  })

  it('guards the membership POST and announces a recoverable join failure', async () => {
    auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'user-1', email: 'maker@example.edu', user_metadata: {} } } },
    })
    let resolveJoin!: (value: unknown) => void
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/workspaces/by-invite/SECRET-CODE') {
        return { ok: true, json: async () => ({ workspace: workspace() }) }
      }
      if (String(input) === '/api/user-profile') {
        return { ok: true, json: async () => ({ full_name: 'Ada Maker' }) }
      }
      return new Promise((resolve) => { resolveJoin = resolve })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<JoinWorkspacePage />)

    const join = await screen.findByRole('button', { name: 'Join workspace' })
    fireEvent.click(join)
    fireEvent.click(join)
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === '/api/workspaces/workspace-1/join')).toHaveLength(1)

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await act(async () => resolveJoin({ ok: false, json: async () => ({ error: 'Invite SECRET-CODE failed for workspace-internal-id' }) }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not join workspace')
    expect(screen.getByRole('alert')).not.toHaveTextContent(/SECRET-CODE|workspace-internal-id/)
    expect(join).toBeEnabled()
    consoleError.mockRestore()
  })

  it('preserves firm and institution redirect contracts behind announced progress', async () => {
    routeParams = { slug: 'north school' }
    const { unmount } = render(<FirmHandoffPage />)
    expect(screen.getByRole('status')).toHaveTextContent('Opening sign in')
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/sign-in?institution=north%20school'))
    unmount()

    replace.mockClear()
    auth.getSession.mockResolvedValue({ data: { session: null } })
    render(<InstitutionHandoffPage />)
    expect(screen.getByRole('status')).toHaveTextContent('Opening your institution')
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/sign-in?institution=north%20school'))
  })

  it('recovers from session lookup failures instead of leaving public handoffs loading', async () => {
    auth.getSession.mockRejectedValue(new Error('session unavailable'))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ workspace: workspace() }) }))
    const { unmount } = render(<JoinWorkspacePage />)
    expect(await screen.findByRole('heading', { name: 'Join Material Futures' })).toBeInTheDocument()
    unmount()

    routeParams = { slug: 'north school' }
    render(<InstitutionHandoffPage />)
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/sign-in?institution=north%20school'))
  })
})
