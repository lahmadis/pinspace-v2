import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import GalleryPage from '@/app/gallery/page'

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }))
vi.mock('@/components/DemoBanner', () => ({ default: () => null }))
vi.mock('@/components/Gallery3D', () => ({ default: () => <div role="application" aria-label="Interactive 3D gallery" /> }))

describe('GalleryPage', () => {
  it('keeps navigation and an accessible 3D surface available', () => {
    render(<GalleryPage />)
    expect(screen.getByRole('heading', { level: 1, name: '3D Gallery' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Back home/i })).toHaveAttribute('href', '/')
    expect(screen.getByRole('application', { name: 'Interactive 3D gallery' })).toBeInTheDocument()
  })
})
