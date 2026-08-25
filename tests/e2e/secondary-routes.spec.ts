import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

const isolatedBaseUrl = process.env.SECONDARY_BASE_URL
const routeUrl = (route: string) => isolatedBaseUrl ? `${isolatedBaseUrl}${route}` : route

test.describe('PinSpace secondary routes', () => {
  for (const route of ['/terms', '/privacy']) {
    test(`${route} has readable legal landmarks without serious accessibility issues`, async ({ page }) => {
      await page.goto(routeUrl(route))
      await expect(page.getByRole('navigation', { name: 'Legal pages' })).toBeVisible()
      await expect(page.getByRole('main').getByRole('article')).toBeVisible()
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
      expect(results.violations.filter((item) => ['serious', 'critical'].includes(item.impact ?? ''))).toEqual([])
    })
  }

  test('model utility fits narrow screens and protected debug keeps its auth boundary', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 })
    await page.goto(routeUrl('/model'))
    await expect(page.getByRole('heading', { name: '3D model viewer' })).toBeVisible()
    await expect(page.getByLabel('Model URL')).toBeVisible()
    expect(await page.locator('body').evaluate((body) => body.scrollWidth <= window.innerWidth)).toBe(true)

    await page.goto(routeUrl('/debug/boards'))
    await expect(page).toHaveURL(/\/sign-in\?redirect=%2Fdebug%2Fboards/)
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    expect(await page.locator('body').evaluate((body) => body.scrollWidth <= window.innerWidth)).toBe(true)
  })

  test('demo route always announces demo identity', async ({ page }) => {
    await page.goto(routeUrl('/demo'))
    await expect(page.getByRole('main', { name: 'PinSpace demo network' }).getByRole('status')).toContainText('Demo Mode')
    await expect(page.getByRole('button', { name: 'Exit demo mode' })).toBeVisible()
  })

})
