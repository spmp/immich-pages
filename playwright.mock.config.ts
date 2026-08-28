import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
   testMatch: /.*\.mock\.spec\.ts/,
  timeout: 30_000,
  use: {
    ...devices['Desktop Chrome'],
    browserName: 'chromium',
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4173'
  },
  reporter: 'list'
});
