import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { back } = vi.hoisted(() => ({ back: vi.fn() }))
let routeParams = { token: 'PRIVATE-TOKEN' }

vi.mock('next/navigation', () => ({
  useParams: () => routeParams,
  useRouter: () => ({ back }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) => <a href={href} {...props}>{children}</a>,
}))
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ 'aria-label': ariaLabel }: { 'aria-label'?: string }) => <div role="application" aria-label={ariaLabel || '3D studio'} />,
  useFrame: () => undefined,
  useThree: () => ({ camera: { position: { copy: vi.fn() } } }),
}))
vi.mock('@react-three/drei', () => ({ OrbitControls: () => null, PerspectiveCamera: () => null }))
vi.mock('@/components/3d/WallSystem', () => ({ default: () => null }))
vi.mock('@/components/3d/TableWithModel', () => ({ default: () => null }))
vi.mock('@/components/3d/ModelViewer', () => ({ default: () => <div>Model viewer</div> }))
vi.mock('@/components/3d/SceneErrorBoundary', () => ({ SceneErrorBoundary: ({ children }: { children: ReactNode }) => <>{children}</> }))
vi.mock('@/components/LightboxModal', () => ({ default: () => null }))
vi.mock('@/components/3d/PresenceBar', () => ({
  default: () => null,
  friendlyName: (name: string) => name,
  colorFor: () => '#22d3ee',
}))
vi.mock('@/components/3d/LaserPointer', () => ({ LaserPointer: () => null }))
vi.mock('@/lib/supabase/client', () => ({
  isSupabaseConfigured: false,
  supabase: { channel: vi.fn(), removeChannel: vi.fn() },
}))

import CritPage from '@/app/crit/[token]/page'
import CritViewError from '@/app/crit/[token]/error'
import SharePage from '@/app/share/[token]/page'
import ShareViewError from '@/app/share/[token]/error'

describe('PinSpace public studio routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    routeParams = { token: 'PRIVATE-TOKEN' }
  })

  it('announces share loading then shows a generic unavailable state without echoing the token', async () => {
    let resolveFetch!: (value: unknown) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { resolveFetch = resolve })))
    render(<SharePage />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading shared studio')
    expect(screen.queryByText('PRIVATE-TOKEN')).not.toBeInTheDocument()

    await act(async () => resolveFetch({ status: 404, ok: false }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Link unavailable')
    expect(alert).not.toHaveTextContent('PRIVATE-TOKEN')
  })

  it('renders the immersive share shell and a clear empty state', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ boards: [], room: { id: 'room-1', name: 'Open studio', workspaceId: null } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<SharePage />)

    expect(await screen.findByRole('link', { name: 'pinspace home' })).toHaveAttribute('href', '/')
    expect(screen.getByText('Open studio')).toBeInTheDocument()
    expect(screen.getByText('View only')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('No boards in this studio yet')
    expect(screen.getByRole('application', { name: 'Shared 3D studio' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/share/PRIVATE-TOKEN/boards', { cache: 'no-store' })
  })

  it('provides keyboard-reachable board and model alternatives to the 3D scene', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).startsWith('/api/share/')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            boards: [{ id: 'board-1', title: 'Material study', studioId: 'room-1', studentName: 'Ada', thumbnailUrl: '/board.jpg', fullImageUrl: '/board.jpg', uploadedAt: new Date() }],
            room: { id: 'room-1', name: 'Open studio', workspaceId: 'workspace-1' },
          }),
        }
      }
      return {
        ok: true,
        json: async () => ({ config: { walls: [{ id: 'wall-1', width: 8, height: 8 }], tables: [{ id: 'table-1', x: 0, z: 0, width: 24, depth: 18, modelUrl: '/model.glb' }] } }),
      }
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<SharePage />)

    const browse = await screen.findByText('Browse studio content')
    await user.click(browse)
    const boardButton = screen.getByRole('button', { name: 'Open board Material study' })
    const modelButton = screen.getByRole('button', { name: 'Open 3D model 1' })
    boardButton.focus()
    expect(boardButton).toHaveFocus()
    modelButton.focus()
    expect(modelButton).toHaveFocus()

    await user.click(modelButton)
    expect(await screen.findByRole('dialog', { name: '3D model' })).toHaveTextContent('Use pointer or touch to rotate and zoom')
    expect(screen.getByRole('link', { name: 'Open model file' })).toHaveAttribute('href', '/model.glb')
    expect(screen.queryByText(/keyboard controls provided by the model viewer/i)).not.toBeInTheDocument()

    const navigator = browse.closest('details')
    expect(navigator).toHaveClass('bottom-[max(7rem,calc(env(safe-area-inset-bottom)+7rem))]')
    expect(navigator).not.toHaveClass('top-1/2', 'top-28')
    expect(navigator?.querySelector('[data-public-studio-navigator-scroll]')).toHaveClass('max-h-[min(25dvh,20rem)]')
  })

  it('covers invalid critique links and a bounded labelled guest-name gate', async () => {
    const { unmount } = render(<CritPage />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading guest critique')
    unmount()

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 404, ok: false }))
    render(<CritPage />)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Link unavailable')
    expect(alert).not.toHaveTextContent('PRIVATE-TOKEN')
  })

  it('enters an empty critique studio without changing the guest-token contract', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        boards: [],
        room: { id: 'room-1', name: 'Review room', workspaceId: null },
        guest: { tokenId: 'guest-token-row-1', label: '', canComment: true, canTrace: false },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<CritPage />)

    const name = await screen.findByLabelText('Your name')
    expect(name).toHaveAttribute('maxlength', '80')
    await user.type(name, 'Maya Critic')
    await user.click(screen.getByRole('button', { name: 'Enter studio' }))
    expect(await screen.findByText('Guest critic · Maya Critic')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('No boards to critique yet')
    expect(sessionStorage.getItem('crit-guest-name-PRIVATE-TOKEN')).toBe('Maya Critic')
    expect(fetchMock).toHaveBeenCalledWith('/api/crit/PRIVATE-TOKEN/boards', { cache: 'no-store' })
  })

  it('contains an unbroken maximum-length guest label on narrow screens', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ boards: [], room: { id: 'room-1', workspaceId: null }, guest: { tokenId: 'guest-row', label: '', canComment: true, canTrace: false } }),
    }))
    const user = userEvent.setup()
    render(<CritPage />)
    const guestName = 'A'.repeat(80)
    await user.type(await screen.findByLabelText('Your name'), guestName)
    await user.click(screen.getByRole('button', { name: 'Enter studio' }))
    const modeLabel = await screen.findByText(`Guest critic · ${guestName}`)
    expect(modeLabel).toHaveClass('truncate')
    expect(modeLabel.parentElement).toHaveClass('[overflow-wrap:anywhere]')
  })

  it('uses protected, actionable route error boundaries', async () => {
    const user = userEvent.setup()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const resetShare = vi.fn()
    const { unmount } = render(<ShareViewError error={new Error('PRIVATE-TOKEN')} reset={resetShare} />)
    expect(screen.getByRole('alert')).not.toHaveTextContent('PRIVATE-TOKEN')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(resetShare).toHaveBeenCalledOnce()
    unmount()

    const resetCrit = vi.fn()
    render(<CritViewError error={new Error('PRIVATE-TOKEN')} reset={resetCrit} />)
    expect(screen.getByRole('alert')).not.toHaveTextContent('PRIVATE-TOKEN')
    await user.click(screen.getByRole('button', { name: 'Go back' }))
    await waitFor(() => expect(back).toHaveBeenCalled())
    consoleError.mockRestore()
  })
})
