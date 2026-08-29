import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test.use({ extraHTTPHeaders: { authorization: 'Bearer fixture' }, locale: 'en-GB' });
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
  for (const kind of ['key', 'slug']) {
    await page.goto(`/share/${kind}/opaque-ref`);
    await expect(page.locator('#asset-550e8400-e29b-41d4-a716-446655440002 a')).toHaveAttribute('href', /thumbnail$/);
    expect((await page.request.get(`/share/${kind}/opaque-ref/media/550e8400-e29b-41d4-a716-446655440004/video/playback`)).status()).toBe(404);
    const media = await page.request.get(`/share/${kind}/opaque-ref/media/550e8400-e29b-41d4-a716-446655440005/video/playback`, { headers: { range: 'bytes=0-3' } });
    expect(media.status()).toBe(206);
    expect(media.headers()['content-type']).toContain('video/mp4');
  }
});

test('formats dates for the browser locale without hydration warnings and serves a valid favicon', async ({ page }) => {
  const consoleMessages: string[] = [];
  page.on('console', (message) => consoleMessages.push(message.text()));
  await page.goto('/share/key/opaque-ref');
  const expected = new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date('2026-01-01T00:00:00.000Z'));
  await expect(page.locator('[data-date-iso="2026-01-01T00:00:00.000Z"] .date-value')).toHaveText(expected);
  await expect(page.locator('[data-date-iso="2026-01-01T00:00:00.000Z"]')).toHaveAttribute('data-date-iso', '2026-01-01T00:00:00.000Z');
  expect(consoleMessages.filter((message) => /hydration|mismatch/i.test(message))).toEqual([]);

  const favicon = await page.request.get('/favicon.ico');
  const expectedBytes = readFileSync(new URL('../../static/favicon.ico', import.meta.url));
  expect(Buffer.from(await favicon.body())).toEqual(expectedBytes);
  expect(favicon.headers()['content-type']).toBe('image/x-icon');
  expect([...expectedBytes.subarray(0, 4)]).toEqual([0, 0, 1, 0]);
});
