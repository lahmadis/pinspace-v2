import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('PinSpace public source contracts', () => {
  it('keeps the critique presenter banner below mobile and desktop safe areas', async () => {
    const source = await readFile('app/crit/[token]/page.tsx', 'utf8')

    expect(source).toContain('top-[calc(env(safe-area-inset-top)+7.5rem)]')
    expect(source).toContain('sm:top-[calc(env(safe-area-inset-top)+5rem)]')
  })
})
