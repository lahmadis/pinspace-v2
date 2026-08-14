import { describe, expect, it } from 'vitest'
import { safeRedirectPath } from '@/lib/security/safeRedirect'

describe('safeRedirectPath', () => {
  it('keeps normal same-origin application paths', () => {
    expect(safeRedirectPath('/dashboard')).toBe('/dashboard')
    expect(safeRedirectPath('/join/ABC123?from=sign-in#details')).toBe('/join/ABC123?from=sign-in#details')
  })

  it.each([
    'https://evil.example',
    '//evil.example/path',
    '/\\evil.example',
    'javascript:alert(1)',
    'dashboard',
    '/safe\nLocation: https://evil.example',
  ])('rejects unsafe redirect %s', (value) => {
    expect(safeRedirectPath(value)).toBe('/dashboard')
  })

  it('uses the caller fallback for missing values', () => {
    expect(safeRedirectPath(null, '/')).toBe('/')
    expect(safeRedirectPath(undefined, '/explore')).toBe('/explore')
  })
})
