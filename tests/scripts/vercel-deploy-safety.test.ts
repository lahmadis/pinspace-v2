import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Vercel deployment safety', () => {
  it('excludes local environment files from deployment uploads', () => {
    const ignoreFile = readFileSync(
      resolve(__dirname, '../../.vercelignore'),
      'utf8',
    )
    const patterns = ignoreFile
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

    expect(patterns).toContain('.env*')
  })
})
