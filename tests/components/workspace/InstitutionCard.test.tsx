import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import InstitutionCard from '@/components/InstitutionCard'

vi.mock('framer-motion', () => ({ motion: { div: 'div' } }))

describe('InstitutionCard', () => {
  it('keeps long names readable and makes the complete card destination clear', () => {
    render(<InstitutionCard institution={{
      id: 'institution-1',
      name: 'College of Architecture, Design, and Interdisciplinary Research',
      slug: 'design-school',
      type: 'university',
      logo_url: null,
      studio_count: 12,
      student_count: 480,
    }} />)

    const link = screen.getByRole('link', { name: /College of Architecture/ })
    expect(link).toHaveAttribute('href', '/explore?institution_slug=design-school')
    expect(link).toHaveClass('focus-visible:ring-2')
    expect(screen.getByRole('heading', { name: /College of Architecture/ })).toHaveClass('break-words')
  })
})
