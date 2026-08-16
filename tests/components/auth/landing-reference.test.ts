import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const landingSource = readFileSync(resolve(process.cwd(), 'app/page.tsx'), 'utf8')

describe('approved PinSpace landing reference', () => {
  it('uses the exact reference identity and full-viewport composition', () => {
    expect(landingSource).toContain('pinspace')
    expect(landingSource).toContain('Explore studios in immersive 3D')
    expect(landingSource).toContain('bg-primary')
    expect(landingSource).toContain('font-sans')
    expect(landingSource).toContain('font-black')
    expect(landingSource).toContain('tracking-[-0.055em]')
    expect(landingSource).toContain('text-[clamp(4rem,11.95vw,10.75rem)]')
    expect(landingSource).toContain('bg-background-light')
    expect(landingSource).toContain('bg-accent')
    expect(landingSource).toContain('selection:bg-accent selection:text-primary')
  })

  it('contains only the two approved primary landing actions', () => {
    expect(landingSource).toContain('Dashboard')
    expect(landingSource).toContain('Enter the network')
    expect(landingSource).not.toContain('Start your space')
    expect(landingSource).not.toContain('From first pin to final review.')
    expect(landingSource).not.toContain('Terms of Service')
  })
})
