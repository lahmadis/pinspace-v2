import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const legacyBrand = String.fromCharCode(107, 111, 118, 97)
const legacyBinaryHashes = new Set([
  '37780742250ed65b7abdc5c8d091e9aa5adcd22d931212504a79d7a45db0fab5',
  'c7445b8e3a0e9824df0da46489e08c0b5ea8e917050a1db81a0f43b12718b768',
  'f8658c7509733b1432e93c41fae9d77dddf0516e621275d58a263603e50a2e72',
])
const textExtensions = new Set([
  '',
  '.css',
  '.env',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.sql',
  '.svg',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
])

describe('PinSpace brand consistency', () => {
  it('contains no legacy brand references in repository-owned paths or text', () => {
    const root = resolve(__dirname, '../..')
    const files = execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard'],
      { cwd: root, encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean)
      .filter((file) => existsSync(resolve(root, file)))

    const pathMatches = files.filter((file) =>
      file.toLowerCase().includes(legacyBrand),
    )
    const contentMatches = files.filter((file) => {
      if (!textExtensions.has(extname(file).toLowerCase())) return false
      return readFileSync(resolve(root, file), 'utf8')
        .toLowerCase()
        .includes(legacyBrand)
    })
    const binaryMatches = files.filter((file) => {
      if (textExtensions.has(extname(file).toLowerCase())) return false
      const digest = createHash('sha256')
        .update(readFileSync(resolve(root, file)))
        .digest('hex')
      return legacyBinaryHashes.has(digest)
    })

    expect({ pathMatches, contentMatches, binaryMatches }).toEqual({
      pathMatches: [],
      contentMatches: [],
      binaryMatches: [],
    })
  })
})
