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
  await expect(assets.nth(1).locator('video')).toHaveAttribute('src', /\/video\/playback\?(key|slug)=opaque-ref$/);
  const video = assets.nth(1).locator('video');
  await video.evaluate((element) => new Promise<void>((resolve, reject) => {
    const media = element as HTMLVideoElement;
    if (media.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) { resolve(); return; }
    const done = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error('native video media failure')); };
    const cleanup = () => { media.removeEventListener('loadeddata', done); media.removeEventListener('canplay', done); media.removeEventListener('error', fail); };
    media.addEventListener('loadeddata', done, { once: true });
    media.addEventListener('canplay', done, { once: true });
    media.addEventListener('error', fail, { once: true });
  }), { timeout: 15_000 });
  const metadata = await video.evaluate((element) => ({ readyState: (element as HTMLVideoElement).readyState, duration: (element as HTMLVideoElement).duration }));
  expect(metadata.readyState).toBeGreaterThanOrEqual(2);
  expect(metadata.duration).toBeGreaterThan(1.9);
  expect(metadata.duration).toBeLessThan(2.1);
  await expect(page.locator('.gallery-grid img').nth(0)).toHaveAttribute('loading', 'lazy');
  expect(await page.content()).not.toMatch(/original|download|127\.0\.0\.1:\d+/);
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.locator('.gallery-grid')).toBeVisible();
});

test('keeps gallery frames bounded and landscape media useful at every responsive band', async ({ page }) => {
  const viewports = [
    { width: 390, height: 844, frameRatio: [0.95, 1.05] },
    { width: 768, height: 1024, frameRatio: [0.70, 0.80] },
    { width: 1024, height: 768, frameRatio: [0.70, 0.80] },
    { width: 1440, height: 900, frameRatio: [0.70, 0.80] },
    { width: 844, height: 390, frameRatio: [0.95, 1.05] }
  ];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto('/share/key/opaque-ref');
    const geometry = await page.locator('.gallery-grid').evaluate((grid, expectedRatio) => {
      const rect = (element: Element) => {
        const box = element.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
      };
      const gridRect = rect(grid);
      const frames = [...grid.querySelectorAll<HTMLElement>('.gallery-media-frame')].map((frame) => {
        const media = frame.querySelector<HTMLImageElement | HTMLVideoElement>('img, video');
        const frameBox = rect(frame);
        const mediaBox = media ? rect(media) : null;
        const naturalWidth = media instanceof HTMLImageElement ? media.naturalWidth : media?.videoWidth ?? 0;
        const naturalHeight = media instanceof HTMLImageElement ? media.naturalHeight : media?.videoHeight ?? 0;
        return { frame: frameBox, media: mediaBox, naturalWidth, naturalHeight };
      });
      return { grid: gridRect, frames, expectedRatio };
    }, viewport.frameRatio);

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    for (const item of geometry.frames) {
      expect(item.frame.left).toBeGreaterThanOrEqual(geometry.grid.left - 1);
      expect(item.frame.right).toBeLessThanOrEqual(geometry.grid.right + 1);
      expect(item.frame.top).toBeGreaterThanOrEqual(geometry.grid.top - 1);
      expect(item.frame.bottom).toBeLessThanOrEqual(geometry.grid.bottom + 1);
      expect(item.frame.height / item.frame.width).toBeGreaterThanOrEqual(geometry.expectedRatio[0]);
      expect(item.frame.height / item.frame.width).toBeLessThanOrEqual(geometry.expectedRatio[1]);
      if (item.media) {
        expect(item.media.left).toBeGreaterThanOrEqual(item.frame.left - 1);
        expect(item.media.right).toBeLessThanOrEqual(item.frame.right + 1);
        expect(item.media.top).toBeGreaterThanOrEqual(item.frame.top - 1);
        expect(item.media.bottom).toBeLessThanOrEqual(item.frame.bottom + 1);
      }
    }

    const landscape = geometry.frames.find((item) => item.naturalWidth / item.naturalHeight > 1.3);
    expect(landscape?.media).toBeTruthy();
    expect((landscape!.media!.width / landscape!.frame.width)).toBeGreaterThanOrEqual(0.9);
    expect((landscape!.media!.height / landscape!.frame.height)).toBeGreaterThanOrEqual(0.55);
  }
});

test('preserves ordinary image anchor fallback and rejects unshared media', async ({ page }) => {
  for (const kind of ['key', 'slug']) {
    await page.goto(`/share/${kind}/opaque-ref`);
    await expect(page.locator('#asset-550e8400-e29b-41d4-a716-446655440002 a')).toHaveAttribute('href', /thumbnail\?(key|slug)=opaque-ref$/);
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

test('emits safe lifecycle diagnostics by default and can be disabled', async ({ page }) => {
  const debugMessages: string[] = [];
  page.on('console', (message) => {
    if (message.text().startsWith('[immich-pages-debug]')) debugMessages.push(message.text());
  });
  await page.goto('/share/key/opaque-ref');
  await expect(page.locator('#asset-550e8400-e29b-41d4-a716-446655440006 .unavailable')).toBeVisible();

  const enabled = process.env.PUBLIC_PAGES_DEBUG !== 'false';
  if (enabled) {
    expect(debugMessages.some((message) => message.includes('"event":"page-model-load"'))).toBe(true);
    expect(debugMessages.some((message) => message.includes('"event":"gallery-state"'))).toBe(true);
    expect(debugMessages.some((message) => message.includes('"event":"hero-load"'))).toBe(true);
    expect(debugMessages.some((message) => message.includes('"event":"media-failure"'))).toBe(true);
    expect(debugMessages.some((message) => message.includes('"status":"unavailable"'))).toBe(true);
  } else {
    expect(debugMessages).toEqual([]);
  }
  for (const message of debugMessages) {
    expect(message).not.toMatch(/opaque-ref|fixture|authorization|cookie|description|Mock browser proof|https?:|127\.0\.0\.1|request.?id|response.?body/i);
  }
});

test('keeps the hero CTA usable and collapses the empty Phase 3 seam', async ({ page }) => {
  await page.goto('/share/key/opaque-ref');
  const seam = page.locator('[data-phase="3-map-seam"]');
  await expect(seam).toHaveCount(1);
  expect((await seam.boundingBox())?.height ?? -1).toBe(0);
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Explore the gallery' }).click();
  await expect(page.locator('#gallery-title')).toBeFocused();
  await expect(page.locator('.eyebrow')).toHaveCount(0);
});

test('opens the image viewer with contained focus, announcements, and clean Back behavior', async ({ page }) => {
  await page.goto('/share/key/opaque-ref');
  await expect(page.locator('[data-lightbox-status]')).toHaveAttribute('data-lightbox-status', 'ready');
  const image = page.locator('#asset-550e8400-e29b-41d4-a716-446655440002 a');
  await image.focus();
  await image.press('Enter');
  const viewer = page.locator('.pswp');
  await expect(viewer).toBeVisible();
  await expect(page).toHaveURL(/\/share\/key\/opaque-ref$/);
  await expect(viewer.locator('button[aria-label*="Close"], button[title*="Close"]')).toBeVisible();
  await expect(page.locator('[data-pswp-announcement]')).toContainText(/1\s*\/\s*\d+/);

  await expect.poll(() => page.evaluate(() => {
    const active = document.activeElement;
    const modal = document.querySelector('.pswp');
    return Boolean(active && modal?.contains(active));
  })).toBe(true);
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.querySelector('.pswp')?.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Shift+Tab');
  expect(await page.evaluate(() => document.querySelector('.pswp')?.contains(document.activeElement))).toBe(true);

  await page.keyboard.press('Escape');
  await expect(viewer).toBeHidden();
  await expect(image).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
  await page.waitForTimeout(100);

  await image.click();
  await expect(viewer).toBeVisible();
  await page.goBack();
  await expect(viewer).toBeHidden();
  await expect(page).toHaveURL(/\/share\/key\/opaque-ref$/);
  await expect(image).toBeFocused();
});
