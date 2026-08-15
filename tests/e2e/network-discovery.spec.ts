import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

const discoveryRoutes = [
  '/network',
  '/network/shared',
  '/network/wentworth',
  '/explore',
  '/explore/architecture',
  '/explore/architecture/year-1',
  '/gallery',
  '/u/example',
]

const configuredSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const authenticatedSession = process.env.PLAYWRIGHT_SUPABASE_SESSION
const browserBaseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000'

test.describe('Kova discovery routes', () => {
  test('authenticated network UI preserves responsive navigation and destinations', async ({ page, context }) => {
    test.skip(!configuredSupabaseUrl || !authenticatedSession, 'Requires the external Playwright authentication fixture.')
    const projectRef = new URL(configuredSupabaseUrl!).hostname.split('.')[0]
    await context.addCookies([{
      name: `sb-${projectRef}-auth-token`,
      value: authenticatedSession!,
      url: browserBaseUrl,
    }])
    await page.route('**/api/network/personal', (route) => route.fulfill({ json: { workspaces: [{ id: 'workspace-1', name: 'Material Systems', subRoomCount: 3, createdAt: '2026-08-01' }] } }))
    await page.route('**/api/network/personal/workspace-1', (route) => route.fulfill({ json: { workspace: { id: 'workspace-1', name: 'Material Systems' }, rooms: [{ id: 'room-1', name: 'Material Lab', boardCount: 5 }] } }))

    for (const width of [360, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/network')
      await expect(page.getByRole('heading', { name: 'Your network' })).toBeVisible()
      await expect(page.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/dashboard')
      await page.getByRole('button', { name: 'Open Material Systems' }).click()
      await expect(page).toHaveURL(/\/network\/workspace-1$/)
      await expect(page.getByRole('heading', { name: 'Material Systems' })).toBeVisible()
      await expect(page.getByRole('link', { name: 'Your network' })).toHaveAttribute('href', '/network')
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    }
  })

  for (const width of [360, 768, 1024, 1440]) {
    for (const path of discoveryRoutes) {
      test(`${path} has no page overflow at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 })
        await page.goto(path, { waitUntil: 'domcontentloaded' })
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      })
    }
  }

  test('mocked network information is available without relying on graph position or colour', async ({ page }) => {
    await page.route('**/api/explore/academic-years**', (route) => route.fulfill({ json: { academicYears: [] } }))
    await page.route('**/api/explore/studios**', (route) => route.fulfill({ json: {
      studios: [{ id: 'workspace-1', name: 'A very long interdisciplinary material futures studio', label: 'A very long interdisciplinary material futures studio', department: 'Architecture', year: 4, instructor: 'Ada Lovelace', memberCount: 24, url: '/studio/room-1/view' }],
      totals: { studios: 1, students: 24 }, hasOrg: true,
    } }))
    await page.goto('/explore')

    const directoryItem = page.getByRole('button', { name: /Open A very long interdisciplinary/i })
    await expect(directoryItem).toBeVisible()
    await directoryItem.focus()
    await expect(directoryItem).toBeFocused()
    await expect(page.getByRole('region', { name: 'Network directory' })).toContainText('Architecture · Year 4 · Ada Lovelace · 24 members')
  })

  test('mocked public portfolio cards open through the keyboard', async ({ page }) => {
    await page.route('**/api/users/example/boards**', (route) => route.fulfill({ json: {
      ownerName: 'Ada Lovelace', profile: { major: 'Architecture', year: 'Year 4' },
      boards: [{ id: 'board-1', title: 'Material Study', thumbnailUrl: '/demo/board1.svg', fullImageUrl: '/demo/board1.svg', uploadedAt: '2026-08-01', tags: [], studioId: 'studio-1', studioName: 'Material Systems' }],
    } }))
    await page.goto('/u/example')
    const board = page.getByRole('button', { name: 'Open Material Study' })
    await board.focus()
    await page.keyboard.press('Space')
    await expect(page.getByRole('dialog', { name: 'Material Study' })).toBeVisible()
  })

  test('mocked/no-env discovery states have no serious or critical axe findings', async ({ page }) => {
    await page.route('**/api/explore/academic-years**', (route) => route.fulfill({ json: { academicYears: [] } }))
    await page.route('**/api/explore/studios**', (route) => route.fulfill({ status: 500, json: { error: 'Unavailable' } }))
    await page.goto('/explore')
    await expect(page.getByRole('region', { name: 'Studio network results' }).getByRole('alert')).toBeVisible()
    const results = await new AxeBuilder({ page }).analyze()
    expect(results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact || ''))).toEqual([])
  })

  test('department discovery preserves access to personal boards', async ({ page }) => {
    await page.goto('/explore/architecture/year-1')
    await expect(page.getByRole('link', { name: 'My boards' })).toHaveAttribute('href', '/my-boards')
  })

  test('discovery surfaces do not overflow at 200% zoom', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 })
    await page.goto('/explore', { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => { document.documentElement.style.zoom = '2' })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
})
