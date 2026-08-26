import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createElement, type ElementType, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { back, toast } = vi.hoisted(() => ({
  back: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'board-1' }),
  useRouter: () => ({ back }),
}))
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: (_target, element) => ({ children, ...props }: { children?: ReactNode }) => {
    const Component = element as ElementType
    const { initial: _initial, animate: _animate, transition: _transition, ...domProps } = props as Record<string, unknown>
    return createElement(Component, domProps, children)
  } }),
}))
vi.mock('@/lib/toast', () => ({ toast }))

import BoardDetailPage from '@/app/board/[id]/page'

const board = {
  id: 'board-1',
  studioId: 'room-1',
  studentName: 'Ada Maker',
  studentEmail: 'ada@example.edu',
  title: 'Material study',
  description: 'A long-running material investigation.',
  thumbnailUrl: '/uploads/thumb.jpg',
  fullImageUrl: '/uploads/board.jpg',
  tags: ['timber', 'assembly'],
  uploadedAt: '2026-08-14T00:00:00.000Z',
}

function initialFetch(overrides?: { boardResponse?: unknown; comments?: unknown[] }) {
  return vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === '/api/boards/board-1') {
      return overrides?.boardResponse ?? { ok: true, json: async () => ({ board }) }
    }
    return { ok: true, json: async () => ({ comments: overrides?.comments ?? [] }) }
  })
}

describe('PinSpace public board view', () => {
  beforeEach(() => vi.clearAllMocks())

  it('announces loading and an unavailable board without exposing an identifier', async () => {
    let resolveBoard!: (value: unknown) => void
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes('/comments')) return Promise.resolve({ ok: true, json: async () => ({ comments: [] }) })
      return new Promise((resolve) => { resolveBoard = resolve })
    }))
    render(<BoardDetailPage />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading board')
    expect(screen.queryByText('board-1')).not.toBeInTheDocument()

    await act(async () => resolveBoard({ ok: false, status: 403, json: async () => ({}) }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Board unavailable')
    expect(alert).not.toHaveTextContent('board-1')
  })

  it('renders board content, an empty comment state, and touch-safe labelled controls', async () => {
    vi.stubGlobal('fetch', initialFetch())
    render(<BoardDetailPage />)

    expect(await screen.findByRole('heading', { level: 1, name: 'Material study' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Material study' })).toBeInTheDocument()
    expect(screen.getByText('No comments yet')).toBeInTheDocument()
    for (const name of ['Back', 'Download board', 'Copy board link', 'Add comment']) {
      expect(screen.getByRole('button', { name })).toHaveClass('min-h-11')
    }
  })

  it('keeps comments in a loading state until their request settles', async () => {
    let resolveComments!: (value: unknown) => void
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      if (String(input) === '/api/boards/board-1') return Promise.resolve({ ok: true, json: async () => ({ board }) })
      return new Promise((resolve) => { resolveComments = resolve })
    }))
    render(<BoardDetailPage />)

    expect(await screen.findByRole('heading', { level: 1, name: 'Material study' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Loading comments')
    expect(screen.queryByText('No comments yet')).not.toBeInTheDocument()

    await act(async () => resolveComments({ ok: true, json: async () => ({ comments: [] }) }))
    expect(await screen.findByText('No comments yet')).toBeInTheDocument()
  })

  it('uses associated bounded fields and guards duplicate comment submission', async () => {
    let resolvePost!: (value: unknown) => void
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/boards/board-1') return Promise.resolve({ ok: true, json: async () => ({ board }) })
      if (String(input) === '/api/comments' && init?.method === 'POST') {
        return new Promise((resolve) => { resolvePost = resolve })
      }
      return Promise.resolve({ ok: true, json: async () => ({ comments: [] }) })
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<BoardDetailPage />)

    await user.click(await screen.findByRole('button', { name: 'Add comment' }))
    expect(screen.getByLabelText('Your name')).toHaveAttribute('maxlength', '80')
    expect(screen.getByLabelText('Your email')).toHaveAttribute('maxlength', '254')
    expect(screen.getByLabelText('Comment')).toHaveAttribute('maxlength', '2000')
    await user.type(screen.getByLabelText('Your name'), 'Maya')
    await user.type(screen.getByLabelText('Comment'), 'Strong material hierarchy.')
    const form = screen.getByRole('form', { name: 'Add a comment' })
    fireEvent.submit(form)
    fireEvent.submit(form)
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)

    await act(async () => resolvePost({
      ok: true,
      json: async () => ({ comment: { id: 'comment-1', authorName: 'Maya', content: 'Strong material hierarchy.', createdAt: '2026-08-14T00:00:00.000Z' } }),
    }))
    expect(await screen.findByText('Strong material hierarchy.')).toBeInTheDocument()
  })

  it('announces a recoverable comment mutation error', async () => {
    const fetchMock = initialFetch()
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/comments' && init?.method === 'POST') {
        return { ok: false, json: async () => ({ error: 'Board board-1 write policy failed' }) }
      }
      if (String(input) === '/api/boards/board-1') return { ok: true, json: async () => ({ board }) }
      return { ok: true, json: async () => ({ comments: [] }) }
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<BoardDetailPage />)

    await user.click(await screen.findByRole('button', { name: 'Add comment' }))
    await user.type(screen.getByLabelText('Your name'), 'Maya')
    await user.type(screen.getByLabelText('Comment'), 'Strong material hierarchy.')
    await user.click(within(screen.getByRole('form', { name: 'Add a comment' })).getByRole('button', { name: 'Post comment' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Comment could not be posted'))
    expect(screen.getByRole('alert')).not.toHaveTextContent(/board-1|policy/i)
  })
})
