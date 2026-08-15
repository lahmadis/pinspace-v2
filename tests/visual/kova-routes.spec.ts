import { expect, test } from '@playwright/test'

const routes = [
  { name: 'landing', path: '/' },
  { name: 'sign-in', path: '/sign-in' },
  { name: 'terms', path: '/terms' },
]

for (const route of routes) {
  test(`${route.name} visual baseline`, async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-08-15T12:00:00Z'))
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(route.path, { waitUntil: 'networkidle' })
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
    await page.evaluate(async () => {
      await document.fonts.ready
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    })
    // Give client hydration and responsive layout one frame to settle after
    // fonts load; the dev toolbar is excluded because it is not product UI.
    await page.waitForTimeout(100)
    await expect(page).toHaveScreenshot(`${route.name}.png`, {
      animations: 'disabled',
      fullPage: true,
      maxDiffPixelRatio: 0.01,
    })
  })
}
