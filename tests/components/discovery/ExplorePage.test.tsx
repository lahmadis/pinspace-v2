import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ExplorePage from '@/app/explore/page'

const router = { push: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/components/DemoBanner', () => ({ default: () => null }))
vi.mock('@/lib/studioViewCache', () => ({ prefetchStudioView: vi.fn() }))
vi.mock('@/components/network/BubbleNetwork', () => ({
  default: ({ nodes }: { nodes: Array<{ id: string; name: string }> }) => (
    <section aria-label="Network directory">{nodes.map((node) => <button key={node.id}>{node.name}</button>)}</section>
  ),
}))

describe('ExplorePage', () => {
  beforeEach(() => {
    router.push.mockReset()
    router.prefetch.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  })
  afterEach(() => vi.restoreAllMocks())

  it('announces loading and a recoverable API error', async () => {
    let resolveStudios!: (value: unknown) => void
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.includes('academic-years')) return Promise.resolve({ ok: true, json: async () => ({ academicYears: [] }) })
      return new Promise((resolve) => { resolveStudios = resolve })
    }))
    render(<ExplorePage />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading studio network')

    await waitFor(() => expect(resolveStudios).toBeTypeOf('function'))
    await act(async () => { resolveStudios({ ok: false, status: 500 }) })
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the studio network')
  })

  it('filters long studio labels and explains an empty result in text', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(url.includes('academic-years')
      ? { ok: true, json: async () => ({ academicYears: [] }) }
      : { ok: true, json: async () => ({ studios: [{ id: 'studio-1', name: 'An exceptionally long cross-disciplinary material futures research studio', label: 'An exceptionally long cross-disciplinary material futures research studio', instructor: 'Ada Lovelace', url: '/studio/room-1/view' }], totals: { studios: 1, students: 12 } }) })))
    const user = userEvent.setup()
    render(<ExplorePage />)

    expect(await screen.findByRole('button', { name: /exceptionally long cross-disciplinary/i })).toBeInTheDocument()
    await user.type(screen.getByRole('searchbox', { name: /Search studios/i }), 'not present')
    expect(await screen.findByRole('heading', { name: 'No studios match your filters' })).toBeInTheDocument()
  })
})
