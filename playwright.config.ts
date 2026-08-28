import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  use: {
    ...devices['Desktop Chrome'],
    browserName: 'chromium',
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://pages.example.xyz:18080',
    launchOptions: process.env.PLAYWRIGHT_BASE_URL
      ? undefined
      : { args: ['--host-resolver-rules=MAP pages.example.xyz 127.0.0.1'] }
  },
  reporter: 'list'
});
