import { expect, test } from '@playwright/test';

test.beforeEach(async () => {
  await fetch(`${process.env.MOCK_IMMICH_URL}/__fixture/reset`, { method: 'POST' });
});

test('opening a share registers it and anonymous library lists only opened shares', async ({ page, context }) => {
  const response = await page.goto('/share/key/opaque-ref');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Mock Journey' })).toBeVisible();
  const registry = (await context.cookies()).find((cookie) => cookie.name === 'pages_visited_shares');
  expect(registry).toBeTruthy();
  expect(registry?.httpOnly).toBe(true);

  await page.goto('/library');
  await expect(page.getByRole('heading', { name: 'Published journeys' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Mock Journey/ })).toHaveCount(1);
  await expect(page.getByRole('link', { name: /Second Journey/ })).toHaveCount(0);
  expect(await page.content()).not.toMatch(/Immich user|authenticated session|550e8400/);
});

test('multiple opened shares navigate through direct-share routes with fresh requests', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('/share/key/opaque-ref');
  await page.goto('/share/slug/second-ref');
  await page.goto('/library');
  await expect(page.getByRole('link', { name: /Mock Journey/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Second Journey/ })).toBeVisible();
  await page.getByRole('link', { name: /Mock Journey/ }).click();
  await expect(page).toHaveURL(/\/share\/key\/opaque-ref$/);
  await expect(page.getByRole('heading', { name: 'Mock Journey' })).toBeVisible();
  expect(requests.some((url) => url.endsWith('/share/key/opaque-ref'))).toBe(true);
});

test('direct shares expose desktop collapse and mobile drawer focus behavior', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/share/key/opaque-ref');
  const sidebar = page.getByRole('complementary', { name: 'Published journeys' });
  await expect(sidebar).toBeVisible();
  const collapse = sidebar.getByRole('button', { name: 'Collapse journeys' });
  await collapse.click();
  await expect(sidebar.getByRole('button', { name: 'Expand journeys' })).toBeVisible();
  await sidebar.getByRole('button', { name: 'Expand journeys' }).click();
  await expect(sidebar.getByRole('link', { name: /Mock Journey/ })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const opener = page.getByRole('button', { name: 'Open journeys' });
  await opener.focus();
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Journeys' });
  await expect(dialog).toBeVisible();
  const close = dialog.getByRole('button', { name: 'Close journey navigation' });
  const entries = dialog.getByRole('link');
  await expect(close).toBeFocused();
  await close.press('Shift+Tab');
  await expect(entries.last()).toBeFocused();
  await entries.last().press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});
