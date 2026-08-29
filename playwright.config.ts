import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: 'line',
  use: { trace: 'retain-on-failure' }
})
