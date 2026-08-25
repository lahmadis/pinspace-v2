import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import playwrightConfig from '../../playwright.config'

function listSuite(script: 'test:e2e' | 'test:a11y' | 'test:visual') {
  return execFileSync('npm', ['run', script, '--', '--list'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
}

describe('Playwright suite discovery', () => {
  it('does not skip public routes for generic HTTP 500 responses', () => {
    const source = readFileSync('tests/e2e/public-sharing.spec.ts', 'utf8')
    expect(source).not.toContain('skipIfR3fCannotLoad')
    expect(source).not.toContain('trackKnownR3fHydrationFailure')
    expect(source).not.toContain('test.skip(')
    expect(source).toContain('expect(response?.status()).toBeLessThan(500)')
  })

  it.each(['mobile', 'tablet', 'desktop'])(
    '%s E2E project uses Chromium',
    (projectName) => {
      const project = playwrightConfig.projects?.find((candidate) => candidate.name === projectName)
      const use = project?.use as { browserName?: string; defaultBrowserType?: string } | undefined
      expect(use?.browserName ?? use?.defaultBrowserType).toBe('chromium')
    },
  )

  it.each(['test:e2e', 'test:a11y', 'test:visual'] as const)(
    '%s discovers at least one intended test',
    (script) => {
      expect(listSuite(script)).toMatch(/Total: [1-9]\d* tests? in [1-9]\d* files?/)
    },
  )
})
