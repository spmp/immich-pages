import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /journey-map\.route\.mock\.spec\.ts/,
  timeout: 30_000,
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], browserName: 'chromium', baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4173' }
    },
    {
      name: 'iphone-13-mini-webkit',
      use: { ...devices['iPhone 13 Mini'], browserName: 'webkit', baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4173' }
    }
  ],
  reporter: 'list'
});
