import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const privilegedRoutes = [
  'app/api/admin/overview/route.ts',
  'app/api/admin/stats/route.ts',
  'app/api/admin/institutions/[slug]/route.ts',
  'app/api/admin/institutions/[slug]/stats/route.ts',
  'app/api/admin/institutions/[slug]/domains/route.ts',
  'app/api/admin/institutions/[slug]/domains/[domain]/route.ts',
  'app/api/institutions/route.ts',
  'app/api/debug/boards/route.ts',
  'app/api/debug/check-types/route.ts',
]

const storageCriticalRoutes = [
  'app/api/boards/route.ts',
  'app/api/boards/duplicate/route.ts',
  'app/api/rooms/[id]/route.ts',
]

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? routeFiles(path) : entry.name === 'route.ts' ? [path] : []
  })
}

describe('privileged route identity verification', () => {
  for (const route of privilegedRoutes) {
    it(`${route} uses the verified admin boundary`, () => {
      const source = readFileSync(route, 'utf8')
      expect(source).not.toContain('auth.getSession()')
      expect(source).toContain('requireAdmin')
    })
  }

  for (const route of storageCriticalRoutes) {
    it(`${route} verifies the user before service-role storage or data writes`, () => {
      const source = readFileSync(route, 'utf8')
      expect(source).not.toContain('auth.getSession()')
      expect(source).toContain('auth.getUser()')
    })
  }

  it('never combines an unverified session with a service-role API client', () => {
    const offenders = routeFiles('app/api').filter((route) => {
      const source = readFileSync(route, 'utf8')
      return source.includes('supabaseServiceRole') && source.includes('auth.getSession()')
    })
    expect(offenders).toEqual([])
  })
})
