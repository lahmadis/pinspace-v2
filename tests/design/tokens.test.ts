import { describe, expect, it } from 'vitest'
import { kovaColors, kovaRadii } from '@/lib/design/tokens'

describe('Kova design tokens', () => {
  it('exposes the approved signature palette', () => {
    expect(kovaColors).toMatchObject({
      yellow: '#FFC800',
      cream: '#FFF3CC',
      paper: '#FFFCF0',
      green: '#14705C',
      forest: '#0A2F28',
      ink: '#0B0B0B',
    })
  })

  it('uses a consistent rounded geometry scale', () => {
    expect(kovaRadii).toEqual({ sm: '10px', md: '14px', lg: '20px', pill: '999px' })
  })
})
