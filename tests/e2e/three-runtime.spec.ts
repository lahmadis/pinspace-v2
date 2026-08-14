import { expect, test } from '@playwright/test'

const routes = [
  { name: 'model utility', path: '/model?url=/runtime-smoke.gltf' },
  { name: 'public gallery', path: '/gallery' },
  { name: 'demo studio', path: '/demo/studio/demo-studio-fall-2023-Architecture-Masters-0' },
]

for (const route of routes) {
  test(`${route.name} evaluates its 3D modules`, async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    if (route.name === 'model utility') {
      await page.route('**/*', (request) => {
        if (new URL(request.request().url()).pathname !== '/runtime-smoke.gltf') {
          return request.continue()
        }
        return request.fulfill({
          contentType: 'model/gltf+json',
          body: JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{}] }),
        })
      })
    }

    const response = await page.goto(route.path, { waitUntil: 'domcontentloaded' })

    expect(response?.status(), `${route.path} should not fail during module evaluation`).toBeLessThan(500)
    await expect(page.locator('canvas').first(), `${route.path} should render its R3F canvas`).toBeVisible()
    await expect(page.locator('body')).not.toContainText('ReactCurrentOwner')
    expect(pageErrors.join('\n')).not.toContain('ReactCurrentOwner')
  })
}
