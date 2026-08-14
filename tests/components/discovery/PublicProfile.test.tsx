/* eslint-disable @next/next/no-img-element, jsx-a11y/alt-text -- lightweight Next Image mock for DOM interaction tests. */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import PortfolioPage from '@/app/u/[userId]/page'

vi.mock('next/navigation', () => ({ useParams: () => ({ userId: 'user-1' }) }))
vi.mock('next/image', () => ({ default: ({ unoptimized: _unoptimized, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { unoptimized?: boolean }) => <img {...props} /> }))

describe('public profile', () => {
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => undefined) })
  afterEach(() => vi.restoreAllMocks())
  it('opens board lightboxes from native keyboard-operable cards', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ownerName: 'Ada Lovelace',
        profile: { major: 'Architecture', year: 'Year 4' },
        boards: [{
          id: 'board-1', title: 'Material Study', thumbnailUrl: '/thumb.png', fullImageUrl: '/full.png',
          uploadedAt: '2026-08-01', tags: [], studioId: 'studio-1', studioName: 'Material Systems',
        }],
      }),
    }))
    const user = userEvent.setup()
    render(<PortfolioPage />)

    const card = await screen.findByRole('button', { name: /Open Material Study/i })
    card.focus()
    await user.keyboard(' ')
    expect(screen.getByRole('dialog', { name: 'Material Study' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /View studio/i })).toHaveAttribute('href', '/studio/studio-1/view')
  })

  it('distinguishes fetch errors from an empty public profile', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    render(<PortfolioPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load this portfolio')
  })
})
