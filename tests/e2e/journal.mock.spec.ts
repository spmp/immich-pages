import { expect, test } from '@playwright/test';

test.use({ extraHTTPHeaders: { authorization: 'Bearer fixture' } });
test.beforeEach(async ({ context }) => { await context.addCookies([{ name: 'immich_shared_link_token', value: 'fixture', domain: '127.0.0.1', path: '/' }]); });

test('renders ordered responsive gallery and safe native video path', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/share/key/opaque-ref');
  await expect(page.getByRole('heading', { name: 'Mock Journey' })).toBeVisible();
  const assets = page.locator('[id^="asset-"]');
  await expect(assets).toHaveCount(3);
  await expect(assets.nth(0)).toHaveAttribute('id', 'asset-550e8400-e29b-41d4-a716-446655440002');
  await expect(assets.nth(1).locator('video')).toHaveAttribute('src', /\/video\/playback$/);
  await expect(page.locator('.gallery-grid img').nth(0)).toHaveAttribute('loading', 'lazy');
  expect(await page.content()).not.toMatch(/original|download|127\.0\.0\.1:\d+/);
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.locator('.gallery-grid')).toBeVisible();
});

test('preserves ordinary image anchor fallback and rejects unshared media', async ({ page }) => {
  await page.goto('/share/key/opaque-ref');
  await expect(page.locator('#asset-550e8400-e29b-41d4-a716-446655440002 a')).toHaveAttribute('href', /thumbnail$/);
  expect((await page.request.get('/share/key/opaque-ref/media/550e8400-e29b-41d4-a716-446655440004/video/playback')).status()).toBe(404);
  const media = await page.request.get('/share/key/opaque-ref/media/550e8400-e29b-41d4-a716-446655440005/video/playback', { headers: { range: 'bytes=0-3' } });
  expect(media.status()).toBe(206);
  expect(media.headers()['content-type']).toContain('video/mp4');
});
