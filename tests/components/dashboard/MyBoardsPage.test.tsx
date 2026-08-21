import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import MyBoardsPage from '@/app/my-boards/page'

const { push, router } = vi.hoisted(() => {
  const pushMock = vi.fn()
  return { push: pushMock, router: { push: pushMock } }
})
vi.mock('next/navigation', () => ({ useRouter: () => router }))
vi.mock('@/hooks/useAuthSession', () => ({
  useAuthSession: () => ({ status: 'authenticated' }),
}))
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: (_target, tag) => tag }),
}))

describe('MyBoardsPage', () => {
  beforeEach(() => {
    push.mockReset()
  })

  it('renders accessible board links without changing board destinations', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        boards: [{
          id: 'board-1',
          title: 'Material Study',
          studentName: 'Ada',
          thumbnailUrl: '/board.png',
          uploadedAt: '2026-08-01T00:00:00Z',
          tags: ['wood'],
        }],
      }),
    }))
    render(<MyBoardsPage />)

    expect(await screen.findByRole('heading', { level: 1, name: 'My boards' })).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /Material Study/ })[0]).toHaveAttribute('href', '/board/board-1')
    expect(screen.getByRole('link', { name: 'Upload new board' })).toHaveAttribute('href', '/upload')
  })

  it('shows a recoverable error state and retries the existing request', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ boards: [] }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<MyBoardsPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your boards')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('heading', { name: 'No boards yet' })).toBeInTheDocument()
  })
})
