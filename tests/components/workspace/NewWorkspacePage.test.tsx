import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import NewWorkspacePage from '@/app/workspace/new/page'

const push = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/hooks/useAuthSession', () => ({
  useAuthSession: () => ({ status: 'authenticated', user: { id: 'user-1', email: 'ada@example.edu', user_metadata: {} } }),
}))
vi.mock('@/lib/useAccountMode', () => ({
  useAccountMode: () => ({ mode: 'organization', resolved: true, loading: false }),
}))
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

describe('NewWorkspacePage', () => {
  beforeEach(() => {
    push.mockReset()
  })

  it('shows labelled inputs and an inline validation error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }))
    const user = userEvent.setup()
    render(<NewWorkspacePage />)

    const name = await screen.findByLabelText('Project name')
    expect(name).toHaveAttribute('maxlength', '100')
    await user.click(screen.getByRole('button', { name: 'Create project' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Enter a project name')
    expect(name).toHaveAttribute('aria-invalid', 'true')
  })

  it('preserves the workspace API payload and redirects to settings', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [{ id: 'inst-1', slug: 'wit', name: 'Wentworth' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ full_name: 'Ada Lovelace' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'workspace-1' }) })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<NewWorkspacePage />)

    await user.type(await screen.findByLabelText('Project name'), '  Material Futures  ')
    await user.click(screen.getByRole('button', { name: 'Create project' }))

    await waitFor(() => expect(push).toHaveBeenCalledWith('/workspace/workspace-1/settings'))
    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ name: 'Material Futures', creatorName: 'Ada Lovelace', institution_slug: 'wit' }),
    }))
  })

  it('announces API failures and re-enables retry', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Project creation is temporarily unavailable' }) })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<NewWorkspacePage />)

    await user.type(await screen.findByLabelText('Project name'), 'Retry project')
    await user.click(screen.getByRole('button', { name: 'Create project' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Project creation is temporarily unavailable')
    expect(screen.getByRole('button', { name: 'Create project' })).toBeEnabled()
  })
})
