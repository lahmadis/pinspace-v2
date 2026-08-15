import { expect, test } from '@playwright/test'

test.describe('dashboard project management boundary', () => {
  for (const width of [360, 768, 1024, 1440]) {
    test(`does not overflow before the authenticated dashboard loads at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })

      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    })
  }

  test('keeps the protected dashboard behind authentication', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(/\/sign-in(?:\?|$)/)
  })
})
