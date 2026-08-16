import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import PersonalNetworkPage from '@/app/network/page'

const push = vi.fn()

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/hooks/useAuthSession', () => ({
  useAuthSession: () => ({ status: 'authenticated' }),
}))
vi.mock('@/components/network/BubbleNetwork', () => ({
  default: ({ nodes, onNodeClick }: { nodes: Array<{ id: string; name: string }>; onNodeClick: (node: { id: string; name: string }) => void }) => (
    <section aria-label="Network directory">
      {nodes.map((node) => <button key={node.id} onClick={() => onNodeClick(node)}>{node.name}</button>)}
    </section>
  ),
}))

describe('PersonalNetworkPage', () => {
  beforeEach(() => {
    push.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  })
  afterEach(() => vi.restoreAllMocks())

  it('announces loading, then renders populated data and preserves node navigation', async () => {
    let resolveFetch!: (value: unknown) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { resolveFetch = resolve })))
    const user = userEvent.setup()
    render(<PersonalNetworkPage />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading your network')

    await waitFor(() => expect(resolveFetch).toBeTypeOf('function'))
    await act(async () => { resolveFetch({ ok: true, json: async () => ({ workspaces: [{ id: 'workspace-1', name: 'Long Material Systems Workspace', subRoomCount: 3 }] }) }) })
    await user.click(await screen.findByRole('button', { name: 'Long Material Systems Workspace' }))
    expect(push).toHaveBeenCalledWith('/network/workspace-1')
  })

  it('renders explicit empty and recoverable error states', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ workspaces: [] }) })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<PersonalNetworkPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your network')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('heading', { name: 'No rooms yet' })).toBeInTheDocument()
  })
})
