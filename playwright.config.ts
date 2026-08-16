import { defineConfig, devices } from '@playwright/test'

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3000)
const baseURL = `http://127.0.0.1:${port}`
const e2eMatch = 'e2e/**/*.spec.ts'

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  // Keep reviewed visual baselines portable across the pinned Chromium project;
  // small rasterisation differences are handled by the suite's pixel ratio.
  snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{arg}{ext}',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `node_modules/.bin/next dev -H 127.0.0.1 -p ${port}`,
    url: baseURL,
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER
      ? process.env.PLAYWRIGHT_REUSE_SERVER === '1'
      : !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    { name: 'mobile', testMatch: e2eMatch, use: { ...devices['iPhone 13'], browserName: 'chromium' } },
    { name: 'tablet', testMatch: e2eMatch, use: { ...devices['iPad Mini'], browserName: 'chromium' } },
    { name: 'desktop', testMatch: e2eMatch, use: { ...devices['Desktop Chrome'] } },
    { name: 'a11y', testMatch: 'a11y/**/*.spec.ts', use: { ...devices['Desktop Chrome'] } },
    { name: 'visual', testMatch: 'visual/**/*.spec.ts', use: { ...devices['Desktop Chrome'] } },
  ],
})
