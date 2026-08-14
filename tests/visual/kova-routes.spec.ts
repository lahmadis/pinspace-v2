import { expect, test } from '@playwright/test'

const routes = [
  { name: 'landing', path: '/' },
  { name: 'sign-in', path: '/sign-in' },
  { name: 'terms', path: '/terms' },
]

for (const route of routes) {
  test(`${route.name} visual baseline`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(route.path)
    await expect(page).toHaveScreenshot(`${route.name}.png`, {
      animations: 'disabled',
      fullPage: true,
    })
  })
}
