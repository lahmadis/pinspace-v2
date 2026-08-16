import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

test.describe('workspace management boundary', () => {
  for (const width of [360, 768, 1024, 1440]) {
    for (const path of ['/workspace/new', '/workspace/example', '/workspace/example/settings']) {
      test(`${path} has no horizontal overflow before authentication at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 })
        await page.goto(path, { waitUntil: 'domcontentloaded' })
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      })
    }
  }

  test('no-env workspace creation has no serious or critical axe findings', async ({ page }) => {
    await page.goto('/workspace/new', { waitUntil: 'domcontentloaded' })
    const results = await new AxeBuilder({ page }).analyze()
    const serious = results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact || ''))
    expect(serious).toEqual([])
  })

  test('protected workspace routes do not overflow at 200% zoom', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 })
    await page.goto('/workspace/example', { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => {
      document.documentElement.style.zoom = '2'
    })

    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })

  test('protected workspace routes preserve their authentication boundary', async ({ page }) => {
    await page.goto('/workspace/example', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(/\/sign-in(?:\?|$)/)
    await page.goto('/workspace/example/settings', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(/\/sign-in(?:\?|$)/)
  })
})
