import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

const routes = ['/', '/sign-in', '/forgot-password', '/terms', '/privacy']

for (const route of routes) {
  test(`${route} has no serious or critical accessibility violations`, async ({ page }) => {
    await page.goto(route)
    const results = await new AxeBuilder({ page })
      .disableRules(['color-contrast'])
      .analyze()

    const blocking = results.violations.filter(({ impact }) =>
      impact === 'serious' || impact === 'critical',
    )
    expect(blocking).toEqual([])
  })
}
