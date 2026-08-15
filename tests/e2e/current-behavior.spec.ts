import { expect, test } from '@playwright/test'

const publicRoutes = [
  { path: '/', landmark: 'main' },
  { path: '/sign-in', landmark: 'main' },
  { path: '/forgot-password', landmark: 'main' },
  { path: '/terms', landmark: 'main' },
  { path: '/privacy', landmark: 'main' },
]

for (const route of publicRoutes) {
  test(`${route.path} renders without horizontal overflow`, async ({ page }) => {
    await page.goto(route.path)
    await expect(page.locator(route.landmark)).toBeVisible()
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(overflows).toBe(false)
  })
}

test('authenticated routes do not expose protected content to a signed-out visitor', async ({ page }) => {
  await page.goto('/dashboard')
  await expect(page).not.toHaveURL(/\/dashboard$/)
})
