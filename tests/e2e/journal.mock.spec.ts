import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test.use({ extraHTTPHeaders: { authorization: 'Bearer fixture' }, locale: 'en-GB' });
test.beforeEach(async ({ context }) => { await context.addCookies([{ name: 'immich_shared_link_token', value: 'fixture', domain: '127.0.0.1', path: '/' }]); });

test('renders ordered responsive gallery and authorized video tile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/share/key/opaque-ref');
  await expect(page.locator('[data-lightbox-status]')).toHaveAttribute('data-lightbox-status', 'ready');
  await expect(page.getByRole('heading', { name: 'Mock Journey' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open journeys' })).toBeVisible();
  const assets = page.locator('[id^="asset-"]');
   await expect(assets).toHaveCount(4);
  await expect(assets.nth(0)).toHaveAttribute('id', 'asset-550e8400-e29b-41d4-a716-446655440002');
   const videoTile = assets.nth(1);
   const videoLink = videoTile.locator('a');
   const video = videoTile.locator('video');
   await expect(videoLink).toHaveAttribute('href', /\/video\/playback\?(key|slug)=opaque-ref$/);
   await expect(videoLink).toHaveAttribute('data-video-src', /\/video\/playback\?(key|slug)=opaque-ref$/);
   await expect(videoLink).toHaveAttribute('data-video-poster', /\/thumbnail\?(key|slug)=opaque-ref$/);
   await expect(video).toHaveAttribute('src', /\/video\/playback\?(key|slug)=opaque-ref$/);
   await expect(video).toHaveAttribute('poster', /\/thumbnail\?(key|slug)=opaque-ref$/);
   await expect(video).toHaveAttribute('controls', '');
   await expect(video).toHaveAttribute('playsinline', '');
	  await expect(videoLink).toHaveAttribute('data-media-source', 'thumbnail');
	  await expect(assets.nth(0).locator('a')).toHaveAttribute('data-media-source', 'thumbnail');
  await expect(page.locator('.gallery-grid img').nth(0)).toHaveAttribute('loading', 'lazy');
  // map.enabled defaults to true now, so the page legitimately embeds the (intentionally public,
  // browser-fetched) map style URL; only this mock's fixture setup happens to serve it from the
  // same 127.0.0.1 origin as fake Immich. Strip that one expected occurrence, then the check for
  // a leaked Immich original/download endpoint or any other internal address stays strict.
  const content = (await page.content()).replace(/http:\/\/127\.0\.0\.1:\d+\/api\/map-style\.json/g, '');
  expect(content).not.toMatch(/original|download|127\.0\.0\.1:\d+/);
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.locator('.gallery-grid')).toBeVisible();
});

test('keeps image and video lightbox items on the thumbnail-backed baseline', async ({ page }) => {
	const requests: string[] = [];
	page.on('request', (request) => requests.push(new URL(request.url()).pathname));
	await page.goto('/share/key/opaque-ref');
	await expect(page.locator('[data-lightbox-status]')).toHaveAttribute('data-lightbox-status', 'ready');
	await expect(page.locator('#asset-550e8400-e29b-41d4-a716-446655440002 a')).toHaveAttribute('href', /\/thumbnail\?/);
	await expect(page.locator('#asset-550e8400-e29b-41d4-a716-446655440005 a')).toHaveAttribute('data-media-source', 'thumbnail');
	expect(requests.some((path) => /\/original|\/download/.test(path))).toBe(false);
});

test('keeps mixed-orientation media occupied and stable at every responsive band', async ({ page }) => {
  const viewports = [
    { width: 390, height: 844, frameRatio: [0.95, 1.05] },
    { width: 768, height: 1024, frameRatio: [0.62, 0.80] },
    { width: 1024, height: 768, frameRatio: [0.62, 0.80] },
    { width: 1440, height: 900, frameRatio: [0.62, 0.80] },
    { width: 844, height: 390, frameRatio: [0.62, 0.80] }
  ];

  const measure = async () => page.locator('.gallery-grid').evaluate((grid) => {
    const rect = (element: Element) => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
    };
    const gridRect = rect(grid);
    const frames = [...grid.querySelectorAll<HTMLElement>('.gallery-media-frame')].map((frame) => {
      const media = frame.querySelector<HTMLImageElement | HTMLVideoElement>('img, video');
      const frameBox = rect(frame);
      const mediaBox = media ? rect(media) : null;
       const naturalWidth = media instanceof HTMLImageElement ? Number(media.getAttribute('width')) : media?.videoWidth ?? 0;
       const naturalHeight = media instanceof HTMLImageElement ? Number(media.getAttribute('height')) : media?.videoHeight ?? 0;
      const objectFit = media ? getComputedStyle(media).objectFit : '';
      const decoded = naturalWidth > 0 && naturalHeight > 0;
      const scale = decoded && objectFit === 'contain'
        ? Math.min(frameBox.width / naturalWidth, frameBox.height / naturalHeight)
        : decoded ? Math.max(frameBox.width / naturalWidth, frameBox.height / naturalHeight) : 0;
      return {
        frame: frameBox,
        media: mediaBox,
        naturalWidth,
        naturalHeight,
        objectFit,
        paintedWidth: naturalWidth * scale,
        paintedHeight: naturalHeight * scale,
        decoded
      };
    });
    return { grid: gridRect, frames };
  });

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto('/share/key/opaque-ref');
    await expect(page.locator('.gallery-grid img').nth(0)).toHaveAttribute('width', '1200');
    await expect(page.locator('.gallery-grid img').nth(1)).toHaveAttribute('width', '800');
    await expect.poll(() => page.locator('.gallery-grid').evaluate((grid) => [...grid.querySelectorAll<HTMLElement>('.gallery-media-frame')].every((frame) => {
      const frameBox = frame.getBoundingClientRect();
      const gridBox = grid.getBoundingClientRect();
      return frameBox.right <= gridBox.right + 1;
    }))).toBe(true);
    const geometry = await measure();

    for (const item of geometry.frames) {
      expect(item.frame.left).toBeGreaterThanOrEqual(geometry.grid.left - 1);
      expect(item.frame.right).toBeLessThanOrEqual(geometry.grid.right + 1);
      expect(item.frame.top).toBeGreaterThanOrEqual(geometry.grid.top - 1);
      expect(item.frame.bottom).toBeLessThanOrEqual(geometry.grid.bottom + 1);
       expect(item.frame.width).toBeGreaterThan(0);
       expect(item.frame.height).toBeGreaterThan(0);
      if (item.media) {
        expect(item.media.left).toBeGreaterThanOrEqual(item.frame.left - 1);
        expect(item.media.right).toBeLessThanOrEqual(item.frame.right + 1);
        expect(item.media.top).toBeGreaterThanOrEqual(item.frame.top - 1);
        expect(item.media.bottom).toBeLessThanOrEqual(item.frame.bottom + 1);
      }
    }

      const baseline = geometry.frames.map((item) => ({ width: item.frame.width, height: item.frame.height, paintedWidth: item.paintedWidth, paintedHeight: item.paintedHeight }));
      await page.reload();
      await expect.poll(() => page.locator('.gallery-grid').evaluate((grid) => [...grid.querySelectorAll<HTMLElement>('.gallery-media-frame')].every((frame) => {
        const frameBox = frame.getBoundingClientRect();
        const gridBox = grid.getBoundingClientRect();
        return frameBox.right <= gridBox.right + 1;
      }))).toBe(true);
      const reloaded = (await measure()).frames;
     reloaded.forEach((item, index) => {
       expect(Math.abs(item.frame.width - baseline[index].width)).toBeLessThanOrEqual(1);
       expect(Math.abs(item.frame.height - baseline[index].height)).toBeLessThanOrEqual(1);
       expect(Math.abs(item.paintedWidth - baseline[index].paintedWidth)).toBeLessThanOrEqual(1);
       expect(Math.abs(item.paintedHeight - baseline[index].paintedHeight)).toBeLessThanOrEqual(1);
     });
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
  const expected = await page.evaluate(() => new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date('2026-01-01T00:00:00.000Z')));
  await expect(page.locator('[data-date-iso="2026-01-01T00:00:00.000Z"] .date-value')).toHaveText(expected);
  await expect(page.locator('[data-date-iso="2026-01-01T00:00:00.000Z"]')).toHaveAttribute('data-date-iso', '2026-01-01T00:00:00.000Z');
  expect(consoleMessages.filter((message) => /hydration|mismatch/i.test(message))).toEqual([]);

  const favicon = await page.request.get('/favicon.ico');
  const expectedBytes = readFileSync(new URL('../../static/favicon.ico', import.meta.url));
  expect(Buffer.from(await favicon.body())).toEqual(expectedBytes);
  expect(favicon.headers()['content-type']).toBe('image/x-icon');
  expect([...expectedBytes.subarray(0, 4)]).toEqual([0, 0, 1, 0]);
});

test('emits safe lifecycle diagnostics when enabled and can be disabled', async ({ page }) => {
  const debugMessages: string[] = [];
  page.on('console', (message) => {
    if (message.text().startsWith('[immich-pages-debug]')) debugMessages.push(message.text());
  });
  await page.goto('/share/key/opaque-ref');
  await expect(page.locator('#asset-550e8400-e29b-41d4-a716-446655440006 .unavailable')).toBeVisible();

  const enabled = process.env.PUBLIC_PAGES_DEBUG === 'true';
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

test('keeps a gallery item inline when a previously valid thumbnail becomes unauthorized', async ({ page }) => {
  const thumbnail = '**/share/key/opaque-ref/media/550e8400-e29b-41d4-a716-446655440002/thumbnail*';
  await page.route(thumbnail, (route) => route.fulfill({ status: 403, body: 'Media not authorized' }));
  await page.goto('/share/key/opaque-ref');
  const item = page.locator('#asset-550e8400-e29b-41d4-a716-446655440002');
  await expect(item.locator('.unavailable')).toBeVisible();
  expect(await item.boundingBox()).not.toBeNull();
  await expect(page.locator('.gallery-grid .justified-row > figure')).toHaveCount(4);
});

test('omits the hero CTA and collapses the empty Phase 3 seam', async ({ page }) => {
  // map.enabled now defaults to true; this test is specifically about the seam collapsing to
  // zero height when there is no map, so it needs a fixture that explicitly opts out.
  await page.goto('/share/key/no-map-ref');
  const seam = page.locator('[data-phase="3-map-seam"]');
  await expect(seam).toHaveCount(1);
  expect((await seam.boundingBox())?.height ?? -1).toBe(0);
  await expect(page.getByRole('button', { name: 'Explore the gallery' })).toHaveCount(0);
  await expect(page.locator('.gallery-grid')).toBeVisible();
  await expect(page.locator('.eyebrow')).toHaveCount(0);
});

test('renders the local MapLibre journey and focuses an authorized gallery asset', async ({ page }) => {
  const externalRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('map') && !request.url().includes('127.0.0.1')) externalRequests.push(request.url());
  });
  await page.goto('/share/key/map-ref');
  await expect(page.getByRole('region', { name: 'Journey map' })).toBeVisible();
  await expect(page.locator('.journey-slot.enabled')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(page.locator('.journey-slot.enabled canvas').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Journey map' })).toHaveCount(0);
  await expect(page.getByText('Interactive journey map')).toHaveCount(0);
  await page.getByRole('button', { name: 'London' }).click();
  await expect(page).toHaveURL(/#asset-550e8400-e29b-41d4-a716-446655440002$/);
  await expect(page.locator('#asset-550e8400-e29b-41d4-a716-446655440002')).toHaveClass(/map-focus-highlight/);
  expect(externalRequests).toEqual([]);
  expect(await page.content()).not.toMatch(/Bearer fixture|immich_shared_link_token|originalPath|assetResponseDto/i);
});

test('opens the lightbox with contained focus, announcements, and clean Back behavior', async ({ page }) => {
  await page.goto('/share/key/opaque-ref');
  await expect(page.locator('[data-lightbox-status]')).toHaveAttribute('data-lightbox-status', 'ready');
  const media = page.locator('#asset-550e8400-e29b-41d4-a716-446655440005 a');
  await media.focus();
  await media.press('Enter');
  const viewer = page.locator('.pswp');
  await expect(viewer).toBeVisible();
  await expect(page).toHaveURL(/\/share\/key\/opaque-ref$/);
  await expect(viewer.locator('button[aria-label*="Close"], button[title*="Close"]')).toBeVisible();
  await expect(page.locator('[data-pswp-announcement]')).toContainText(/2\s*\/\s*\d+/);

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
  await expect(media).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
  await page.waitForTimeout(100);

  await media.click();
  await expect(viewer).toBeVisible();
  await page.goBack();
  await expect(viewer).toBeHidden();
  await expect(page).toHaveURL(/\/share\/key\/opaque-ref$/);
});

test('loads a thumbnail-backed image without PhotoSwipe image-load error', async ({ page }) => {
  const image = page.locator('#asset-550e8400-e29b-41d4-a716-446655440002 a');
  const errorMessage = page.locator('.pswp__error-msg');
  await page.goto('/share/key/opaque-ref');
  await expect(page.locator('[data-lightbox-status]')).toHaveAttribute('data-lightbox-status', 'ready');
  await expect(image).toHaveAttribute('href', /thumbnail\?(key|slug)=opaque-ref$/);
  await expect(image).not.toHaveAttribute('data-pswp-src');
  await expect(image).toBeVisible();
  await image.focus();
  await image.press('Enter');

  await expect(page.locator('.pswp')).toBeVisible();
	await expect(errorMessage).toHaveCount(0);
});
