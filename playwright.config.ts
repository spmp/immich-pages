import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  baseURL: 'http://pages.example.xyz:18080',
  timeout: 30_000,
  use: {
    ...devices['Desktop Chrome'],
    browserName: 'chromium',
    launchOptions: {
      args: ['--host-resolver-rules=MAP pages.example.xyz 127.0.0.1']
    }
  },
  reporter: 'list'
});
