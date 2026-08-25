import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

const isolatedBaseUrl = process.env.PUBLIC_SHARING_E2E_BASE_URL ?? ''
const publicUrl = (path: string) => `${isolatedBaseUrl}${path}`

async function expectNoSeriousAxeFindings(page: Page) {
  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact || ''))).toEqual([])
}

async function mockEmptyShare(page: Page) {
  await page.route('**/api/share/public-example/boards', (route) => route.fulfill({
    json: {
      boards: [],
      room: { id: 'room-public', workspaceId: null, name: 'Material futures review', wallColor: 'grey' },
    },
  }))
}

test.describe('PinSpace public sharing', () => {
  for (const width of [360, 390, 768, 1024, 1440, 1920]) {
    test(`empty share remains usable at ${width}px`, async ({ page }) => {
      await mockEmptyShare(page)
      await page.setViewportSize({ width, height: 900 })
      const response = await page.goto(publicUrl('/share/public-example'), { waitUntil: 'domcontentloaded' })
      expect(response?.status()).toBeLessThan(500)

      await expect(page.getByText('No boards in this studio yet')).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText('0 boards', { exact: true })).toBeVisible()
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    })
  }

  test('invalid share and critique links are generic, token-safe, and accessible', async ({ page }) => {
    await page.route('**/api/share/private-token-value/boards', (route) => route.fulfill({
      status: 404,
      json: { error: 'Internal lookup referenced room-123 and can_comment=true' },
    }))
    const shareResponse = await page.goto(publicUrl('/share/private-token-value'))
    expect(shareResponse?.status()).toBeLessThan(500)
    const shareAlert = page.getByRole('alert').filter({ hasText: 'Link unavailable' })
    await expect(shareAlert).toContainText('Link unavailable')
    await expect(shareAlert).not.toContainText(/private-token-value|room-123|can_comment/i)
    await expectNoSeriousAxeFindings(page)

    await page.route('**/api/crit/private-crit-value/boards', (route) => route.fulfill({
      status: 404,
      json: { error: 'Expired capability token guest-token-123' },
    }))
    const critResponse = await page.goto(publicUrl('/crit/private-crit-value'))
    expect(critResponse?.status()).toBeLessThan(500)
    const critAlert = page.getByRole('alert').filter({ hasText: 'Link unavailable' })
    await expect(critAlert).toContainText('Link unavailable')
    await expect(critAlert).not.toContainText(/private-crit-value|guest-token-123|capability/i)
    await expectNoSeriousAxeFindings(page)
  })

  test('guest critique name gate supports an unauthenticated keyboard flow', async ({ page }) => {
    await page.route('**/api/crit/crit-example/boards', (route) => route.fulfill({
      json: {
        boards: [],
        room: { id: 'room-crit', workspaceId: null, name: 'Final review', wallColor: 'grey' },
        guest: { tokenId: 'guest-record', label: '', canComment: true, canTrace: true },
      },
    }))
    const response = await page.goto(publicUrl('/crit/crit-example'))
    expect(response?.status()).toBeLessThan(500)

    const name = page.getByLabel('Your name')
    await expect(name).toHaveAttribute('maxlength', '80')
    await name.fill('Ada Reviewer')
    await page.keyboard.press('Enter')
    await expect(page.getByText('0 boards', { exact: true })).toBeVisible()
    await expect(page.getByText('Guest critic · Ada Reviewer')).toBeVisible()
  })

  test('invalid join hides invite details and the valid signed-out handoff is preserved', async ({ page }) => {
    await page.route('**/api/workspaces/by-invite/JOIN-SECRET', (route) => route.fulfill({
      status: 404,
      json: { error: 'Invite JOIN-SECRET belongs to workspace-internal-id' },
    }))
    const response = await page.goto(publicUrl('/join/JOIN-SECRET'))
    expect(response?.status()).toBeLessThan(500)
    const alert = page.getByRole('alert').filter({ hasText: 'Invitation unavailable' })
    await expect(alert).toBeVisible()
    await expect(alert).toContainText('Invitation unavailable')
    await expect(alert).not.toContainText(/JOIN-SECRET|workspace-internal-id/)
    await expectNoSeriousAxeFindings(page)

    await page.unroute('**/api/workspaces/by-invite/JOIN-SECRET')
    await page.route('**/api/workspaces/by-invite/JOIN-SECRET', (route) => route.fulfill({
      json: { workspace: { id: 'workspace-1', name: 'Material Systems', inviteCode: 'JOIN-SECRET', memberCount: 12, institutionSlug: 'wentworth' } },
    }))
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Join Material Systems' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Sign in to join' })).toHaveAttribute(
      'href',
      '/sign-in?institution=wentworth&redirect=/join/JOIN-SECRET',
    )
  })

  test('public error state remains usable at 200% zoom', async ({ page }) => {
    await page.route('**/api/share/zoom-check/boards', (route) => route.fulfill({ status: 404, json: {} }))
    await page.setViewportSize({ width: 768, height: 900 })
    const response = await page.goto(publicUrl('/share/zoom-check'))
    expect(response?.status()).toBeLessThan(500)
    await page.evaluate(() => { document.documentElement.style.zoom = '2' })
    await expect(page.getByRole('alert').filter({ hasText: 'Link unavailable' })).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
})
