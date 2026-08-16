import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

const emptyStudioPath = '/studio/studio-empty/view?demo=true'
const isolatedBaseUrl = process.env.STUDIO_E2E_BASE_URL ?? ''
const studioUrl = (path: string) => `${isolatedBaseUrl}${path}`

async function mockEmptyStudio(page: Page) {
  await page.route('**/api/boards?**', (route) => route.fulfill({
    json: {
      boards: [],
      room: {
        id: 'studio-empty',
        workspaceId: 'demo-workspace',
        name: 'A very long interdisciplinary materials studio room name',
        wallColor: 'grey',
      },
    },
  }))
  await page.route('**/api/studios/**/wall-config?**', (route) => route.fulfill({
    json: {
      config: {
        walls: [{ height: 10, width: 8 }],
        layoutType: 'linear',
      },
    },
  }))
}

test.describe('studio controls', () => {
  test('protected editor and creation routes preserve their authentication boundary', async ({ page }) => {
    await page.goto(studioUrl('/studio/new'), { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(/\/sign-in(?:\?|$)/)
    await page.goto(studioUrl('/studio/example'), { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(/\/sign-in(?:\?|$)/)
  })

  for (const width of [360, 390, 768, 1024, 1440, 1920]) {
    test(`empty public viewer remains usable at ${width}px`, async ({ page }) => {
      await mockEmptyStudio(page)
      await page.setViewportSize({ width, height: 900 })
      await page.goto(studioUrl(emptyStudioPath), { waitUntil: 'domcontentloaded' })

      const emptyState = page.getByText('This room has no boards yet')
      const webglFallback = page.getByRole('heading', { name: 'Studio failed to load' })
      await expect(emptyState.or(webglFallback)).toBeVisible({ timeout: 15_000 })
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

      if (await emptyState.isVisible()) {
        await expect(page.getByRole('status').filter({ hasText: '0 boards' })).toBeVisible()
        await expect(page.getByText('A very long interdisciplinary materials studio room name')).toBeVisible()
        const controls = page.getByText('Room controls and board list')
        await controls.focus()
        await expect(controls).toBeFocused()
        await page.keyboard.press('Enter')
        await expect(page.getByText(/Keyboard users can open any board/)).toBeVisible()
      } else {
        await page.getByRole('button', { name: 'Try again' }).focus()
        await expect(page.getByRole('button', { name: 'Try again' })).toBeFocused()
      }
    })
  }

  test('public viewer remains usable at 200% zoom', async ({ page }) => {
    await mockEmptyStudio(page)
    await page.setViewportSize({ width: 768, height: 900 })
    await page.goto(studioUrl(emptyStudioPath), { waitUntil: 'domcontentloaded' })
    await expect(page.getByText('This room has no boards yet').or(page.getByRole('heading', { name: 'Studio failed to load' }))).toBeVisible({ timeout: 15_000 })
    await page.evaluate(() => { document.documentElement.style.zoom = '2' })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })

  test('mocked viewer error has no serious or critical axe findings', async ({ page }) => {
    await page.route('**/api/boards?**', (route) => route.fulfill({ status: 500, json: { error: 'Unavailable' } }))
    await page.route('**/api/studios/**/wall-config?**', (route) => route.fulfill({ status: 500, json: { error: 'Unavailable' } }))
    await page.goto(studioUrl('/studio/studio-error/view?demo=true'))
    await expect(page.getByText('Studio unavailable').or(page.getByRole('heading', { name: 'Studio failed to load' }))).toBeVisible()

    const results = await new AxeBuilder({ page }).analyze()
    expect(results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact || ''))).toEqual([])
  })
})
