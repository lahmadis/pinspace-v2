import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import NewStudioPage from '@/app/studio/new/page'

const push = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/hooks/useAuthSession', () => ({
  useAuthSession: () => ({ status: 'authenticated', user: { id: 'user-1', email: 'ada@example.edu', user_metadata: {} } }),
}))

describe('NewStudioPage', () => {
  beforeEach(() => {
    push.mockReset()
  })

  it('renders top-left back button without primary sidebar navigation', async () => {
    render(<NewStudioPage />)

    const backLink = await screen.findByRole('link', { name: 'Back to projects' })
    expect(backLink).toHaveAttribute('href', '/dashboard')
    expect(screen.queryByRole('navigation', { name: 'Primary navigation' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Create a personal space' })).toBeInTheDocument()
  })

  it('validates required space name before submitting', async () => {
    const user = userEvent.setup()
    render(<NewStudioPage />)

    const input = await screen.findByLabelText('Space name')
    await user.click(screen.getByRole('button', { name: 'Create space' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Enter a space name')
    expect(input).toHaveAttribute('aria-invalid', 'true')
  })

  it('creates workspace space and redirects to workspace page', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ workspace: { id: 'ws-personal-1' } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<NewStudioPage />)

    await user.type(await screen.findByLabelText('Space name'), 'My Studio')
    await user.click(screen.getByRole('button', { name: 'Create space' }))

    await waitFor(() => expect(push).toHaveBeenCalledWith('/workspace/ws-personal-1'))
    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ name: 'My Studio', description: null, type: 'personal' }),
    }))
  })
})
