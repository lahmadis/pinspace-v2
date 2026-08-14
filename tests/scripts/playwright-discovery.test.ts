import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

function listSuite(script: 'test:e2e' | 'test:a11y' | 'test:visual') {
  return execFileSync('npm', ['run', script, '--', '--list'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
}

describe('Playwright suite discovery', () => {
  it.each(['test:e2e', 'test:a11y', 'test:visual'] as const)(
    '%s discovers at least one intended test',
    (script) => {
      expect(listSuite(script)).toMatch(/Total: [1-9]\d* tests? in [1-9]\d* files?/)
    },
  )
})
