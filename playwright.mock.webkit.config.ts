import { devices } from '@playwright/test';
import config from './playwright.mock.config';

export default {
  ...config,
  use: {
    ...devices['Desktop Safari'],
    browserName: 'webkit',
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4173',
    colorScheme: 'dark',
    launchOptions: { env: { WEBKIT_DISABLE_COMPOSITING_MODE: '1' } }
  }
};
