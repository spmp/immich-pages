import { expect, test } from '@playwright/test';

test.use({
  extraHTTPHeaders: { authorization: 'Bearer fixture' }
});

test.beforeEach(async ({ context }) => {
  await context.addCookies([{ name: 'immich_shared_link_token', value: 'fixture', domain: '127.0.0.1', path: '/' }]);
});

test('renders a key share with safe projected media and preserves query state', async ({ page }) => {
  const response = await page.goto('/share/key/opaque-ref?view=gallery');
  expect(response?.status()).toBe(200);
  expect(response?.headers()['set-cookie']).toBeUndefined();
  await expect(page.getByRole('heading', { name: 'Mock Journey' })).toBeVisible();
  await expect(page.getByText('Mock browser proof')).toBeVisible();
   await expect(page.locator('img').first()).toHaveAttribute('src', '/share/key/opaque-ref/media/550e8400-e29b-41d4-a716-446655440002/thumbnail?key=opaque-ref');
  const media = await page.request.get('/share/key/opaque-ref/media/550e8400-e29b-41d4-a716-446655440002/thumbnail');
  expect(media.status()).toBe(200);
  expect(media.headers()['content-type']).toContain('image/svg+xml');
  expect(await media.body()).toBeTruthy();
  expect(page.url()).toContain('/share/key/opaque-ref?view=gallery');
});

test('does not expose a direct Immich media source or permit an unshared asset', async ({ page }) => {
  const html = await page.content();
  expect(html).not.toContain('127.0.0.1:');
  const response = await page.request.get('/share/key/opaque-ref/media/550e8400-e29b-41d4-a716-446655440004/thumbnail');
  expect(response.status()).toBe(404);
});

test('renders the explicit slug form and preserves its query', async ({ page }) => {
  const response = await page.goto('/share/slug/opaque-ref?chapter=1');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Mock Journey' })).toBeVisible();
  expect(page.url()).toContain('/share/slug/opaque-ref?chapter=1');
});

test('returns non-page and upstream errors without exposing upstream bodies', async ({ page }) => {
  expect((await page.goto('/share/key/non-page'))?.status()).toBe(404);
  expect((await page.goto('/share/key/error'))?.status()).toBe(502);
  await expect(page.getByText('temporary failure')).toHaveCount(0);
});

test('rejects a request without the disposable visitor context', async ({ browser }) => {
  const context = await browser.newContext();
  const response = await context.request.get('/share/key/opaque-ref');
  expect(response.status()).toBe(403);
  await context.close();
});
