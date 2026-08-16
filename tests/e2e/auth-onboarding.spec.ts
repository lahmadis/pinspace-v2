import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

const publicEntryRoutes = [
  { path: '/', heading: 'pinspace.' },
  { path: '/sign-in', heading: 'Sign in' },
  { path: '/sign-up', heading: 'Create account' },
  { path: '/forgot-password', heading: 'Forgot password?' },
  { path: '/reset-password', heading: 'Link expired or invalid' },
]

test('landing matches the approved identity and keeps its keyboard flows working', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')

  const heading = page.getByRole('heading', { level: 1, name: 'pinspace.' })
  const dashboard = page.getByRole('link', { name: 'Dashboard' })
  const network = page.getByRole('button', { name: 'Enter the network' })
  const account = page.getByRole('link', { name: 'Sign in to PinSpace' })

  await expect(heading).toBeVisible()
  await expect(heading).toHaveCSS('font-family', /Figtree/)
  await expect(heading).toHaveCSS('font-weight', '900')
  await expect(page.getByRole('main')).toHaveCSS('background-color', 'rgb(255, 200, 0)')
  await expect(dashboard).toHaveAttribute('href', '/sign-in?redirect=%2Fdashboard')
  await expect(account).toHaveAttribute('href', '/sign-in')

  await page.keyboard.press('Tab')
  await expect(account).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(dashboard).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(network).toBeFocused()

  await network.click()
  const dialog = page.getByRole('dialog', { name: 'Create your gallery avatar' })
  await expect(dialog).toBeVisible()
  await expect(page.getByLabel('Department')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(network).toBeFocused()

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
  expect(hasHorizontalOverflow).toBe(false)
})

test('landing stays centered and contained from mobile through wide desktop', async ({ page }) => {
  const viewports = [
    { width: 360, height: 800 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ]

  for (const viewport of viewports) {
    await page.setViewportSize(viewport)
    await page.goto('/')

    const heading = page.getByRole('heading', { level: 1, name: 'pinspace.' })
    await expect(heading).toBeVisible()
    const layout = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      headingWidth: document.querySelector('h1')?.getBoundingClientRect().width ?? 0,
    }))

    expect(layout.scrollWidth).toBe(layout.clientWidth)
    expect(layout.headingWidth).toBeLessThanOrEqual(layout.clientWidth - 32)
  }
})

test('landing actions remain reachable at 200% zoom', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto('/')
  await page.evaluate(() => { document.documentElement.style.zoom = '2' })

  const network = page.getByRole('button', { name: 'Enter the network' })
  await network.scrollIntoViewIfNeeded()
  await expect(network).toBeInViewport()
})

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
