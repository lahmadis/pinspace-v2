import { describe, expect, it } from 'vitest'
import { pinspaceColors, pinspaceRadii } from '@/lib/design/tokens'

describe('PinSpace design tokens', () => {
  it('exposes the approved signature palette', () => {
    expect(pinspaceColors).toMatchObject({
      yellow: '#FFC800',
      cream: '#FFF3CC',
      paper: '#FFFCF0',
      green: '#14705C',
      forest: '#0A2F28',
      ink: '#0B0B0B',
    })
  })

  it('uses a consistent rounded geometry scale', () => {
    expect(pinspaceRadii).toEqual({ sm: '10px', md: '14px', lg: '20px', pill: '999px' })
  })
})
