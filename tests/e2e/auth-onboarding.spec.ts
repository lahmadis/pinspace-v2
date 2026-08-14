import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

const publicEntryRoutes = [
  { path: '/', heading: /studio work gets stronger/i },
  { path: '/sign-in', heading: 'Sign in' },
  { path: '/sign-up', heading: 'Create account' },
  { path: '/forgot-password', heading: 'Forgot password?' },
  { path: '/reset-password', heading: 'Link expired or invalid' },
]

for (const route of publicEntryRoutes) {
  test(`${route.path} is accessible and does not overflow at 360px`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(route.path)

    await expect(page.getByRole('main')).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: route.heading })).toBeVisible()

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(hasHorizontalOverflow).toBe(false)

    const results = await new AxeBuilder({ page }).analyze()
    const blocking = results.violations.filter(({ impact }) =>
      impact === 'serious' || impact === 'critical',
    )
    expect(blocking).toEqual([])
  })
}

test('sign-in validation is announced and keyboard reachable', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto('/sign-in')

  await page.getByLabel('Email').fill('maker@example.edu')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.locator('#sign-in-error')).toContainText('Please enter your password')
  const password = page.locator('input#password')
  await expect(password).toHaveAttribute('aria-invalid', 'true')

  await page.getByLabel('Email').focus()
  await page.keyboard.press('Tab')
  await expect(password).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Show password' })).toBeFocused()
})

test('recovery validation guides the user without calling the server', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto('/forgot-password')
  await page.getByLabel('Email').fill('not-an-email')
  await page.getByRole('button', { name: 'Send reset link' }).click()
  await expect(page.locator('#forgot-password-error')).toContainText('Please enter a valid email address')
  await expect(page.getByLabel('Email')).toHaveAttribute('aria-invalid', 'true')
})

test('onboarding remains protected without a live session', async ({ page }) => {
  await page.goto('/onboarding')
  await expect(page).toHaveURL(/\/sign-in(?:\?|$)/)
})
