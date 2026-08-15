import { expect, test } from '@playwright/test'

const appUrl = (path: string) => `${process.env.PINSPACE_E2E_BASE_URL ?? ''}${path}`

test.describe('PinSpace exceptional states', () => {
  test('announces a delayed loading state and generic request failure', async ({ page }) => {
    await page.route('**/api/workspaces/by-invite/pinspace-state-test', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 300))
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'private upstream detail' }),
      })
    })

    await page.goto(appUrl('/join/pinspace-state-test'))
    await expect(page.getByRole('status').filter({ hasText: 'Loading invitation' })).toContainText(
      'Loading invitation'
    )
    const unavailable = page.getByRole('alert').filter({ hasText: 'Invitation unavailable' })
    await expect(unavailable).toContainText('Invitation unavailable')
    await expect(unavailable).not.toContainText('private upstream detail')
  })

  test('announces offline and restored-online transitions without hiding the page', async ({
    context,
    page,
  }) => {
    await page.goto(appUrl('/privacy'))
    const pageHeading = page.getByRole('heading', { name: 'Privacy Policy', exact: true })
    await expect(pageHeading).toBeVisible()

    await context.setOffline(true)
    const networkStatus = page.getByRole('status', { name: 'Network status updates' })
    await expect(networkStatus).toContainText("You're offline")
    await expect(page.getByRole('button', { name: 'Retry connection' })).toHaveCount(0)
    await expect(pageHeading).toBeVisible()

    await context.setOffline(false)
    await expect(networkStatus).toContainText('Back online')
  })
})
