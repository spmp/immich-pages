import { expect, test } from '@playwright/test';
import { readFileSync, unlinkSync } from 'node:fs';

const orders = {
  'heic-reverse-ref': Array.from({ length: 20 }, (_, index) => 20 - index),
  'heic-forward-ref': Array.from({ length: 20 }, (_, index) => index + 1)
} as const;
const assetId = (number: number) => `70000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const fixtureRoot = new URL('../resources/heic-test-set/', import.meta.url);
const bridgeLog = process.env.HDR_BRIDGE_LOG;
const authHeaders = { authorization: 'Bearer fixture', cookie: 'immich_shared_link_token=fixture' };

test.use({ extraHTTPHeaders: { authorization: 'Bearer fixture' } });
test.beforeEach(async ({ context }) => {
  await context.addCookies([{ name: 'immich_shared_link_token', value: 'fixture', domain: '127.0.0.1', path: '/' }]);
  if (bridgeLog) {
    try { unlinkSync(bridgeLog); } catch { /* The bridge creates it on first invocation. */ }
  }
});

async function enableHdrHints(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const nativeMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query: string) => query === '(dynamic-range: high)' || query === '(color-gamut: p3)' || query === '(color-gamut: rec2020)'
      ? { ...nativeMatchMedia(query), matches: true }
      : nativeMatchMedia(query);
  });
}

test('renders both upstream album orders and converts HEIC originals to browser-displayable JPEG', async ({ page, request, browserName }) => {
  for (const [ref, order] of Object.entries(orders)) {
    await page.goto(`/share/key/${ref}`);
    await expect(page.locator('[data-lightbox-status]')).toHaveAttribute('data-lightbox-status', 'ready');
    await expect.poll(async () => page.locator('[id^="asset-"]').evaluateAll((nodes) => nodes.map((node) => node.id.replace('asset-', '')))).toEqual(order.map(assetId));

    for (const number of [order[0], order[order.length - 1]]) {
      const id = assetId(number);
      const fullsizeUrl = new URL(`/share/key/${ref}/media/${id}/image/fullsize?key=${ref}`, page.url()).toString();
      const response = await request.get(fullsizeUrl, { headers: authHeaders });
      expect(response.status()).toBe(200);
      // Most non-Safari browsers can't decode HEIC in <img>; Pages must convert the HEIC
      // original into a universally displayable JPEG rather than forwarding raw HEIC bytes.
      expect(response.headers()['content-type']).toBe('image/jpeg');
      const body = await response.body();
      expect(body.subarray(0, 3).toString('hex')).toBe('ffd8ff');
      expect(body).not.toEqual(readFileSync(new URL(`originals/${String(number).padStart(2, '0')}.HEIC`, fixtureRoot)));

      if (browserName === 'chromium' && number === order[0]) {
        const requestPromise = page.waitForRequest((request) => request.url() === fullsizeUrl);
        const browserResponseStatus = await page.evaluate(async (url) => (await fetch(url)).status, fullsizeUrl);
        expect(browserResponseStatus).toBe(200);
        await requestPromise;
      }
    }
  }
});

test('runs the HDR bridge through the authenticated request context', async ({ page, request }) => {
  // Only meaningful under the dedicated npm run test:e2e:heic:{chromium,webkit} scripts, which set
  // the HDR_*_PATH bridge env vars; skip (not fail) under the generic npm run test:e2e:mock gate.
  test.skip(!bridgeLog, 'HDR_BRIDGE_LOG is required for executable bridge evidence');
  // GalleryAsset's avifCandidate now prefers the AVIF gain-map candidate over this HDR video
  // bridge whenever supportsAvifGainMapHdr() returns true (see src/lib/media/capabilities.ts):
  // true unconditionally for Chromium, and true for any Safari/WebKit reporting version >= 26.
  // Both of Playwright's bundled test browsers hit that now -- its WebKit build itself reports
  // "Version/26.5" (Apple's unified versioning applies to Playwright's snapshot too, independent
  // of whether that specific build actually renders AVIF gain maps as HDR) -- so neither exercises
  // this video-bridge path anymore. Covering the AVIF path here would need its own bridge fixture
  // (an actual decodable AVIF, not a stand-in) -- not done yet.
  test.skip(true, 'No available test browser takes the HDR video candidate path anymore; this test exercises the video bridge specifically');
  await enableHdrHints(page);
  const id = assetId(7);
  await page.goto('/share/key/heic-forward-ref');
  const candidate = page.locator(`#asset-${id} a`);
  await expect(candidate).toHaveAttribute('data-pswp-type', 'video');
  await expect(candidate).toHaveAttribute('data-video-src', /\/image\/hdr/);
  const hdrHref = await candidate.getAttribute('data-video-src');
  const response = await request.get(new URL(hdrHref!, page.url()).toString(), { headers: authHeaders });
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('video/mp4');
  expect((await response.body()).subarray(4, 8).toString()).toBe('ftyp');
  await expect.poll(() => readBridgeInvocations().filter((invocation) => invocation.assetId === id)).toEqual([
    { method: 'extractAppleHdrMetadata', assetId: id },
    { method: 'composeHdr', assetId: id },
    { method: 'encodeHdrMp4', assetId: id }
  ]);
});

test('selects the HEVC HDR fallback on WebKit below 26 when only HDR dynamic range is reported', async ({ page }) => {
	await page.addInitScript(() => {
		Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 AppleWebKit/605.1.15 Version/18.6 Safari/605.1.15' });
		const nativeMatchMedia = window.matchMedia.bind(window);
		window.matchMedia = (query: string) => query === '(dynamic-range: high)'
			? { ...nativeMatchMedia(query), matches: true }
			: query === '(color-gamut: p3)' || query === '(color-gamut: rec2020)'
				? { ...nativeMatchMedia(query), matches: false }
				: nativeMatchMedia(query);
	});
	await page.goto('/share/key/heic-forward-ref');
	await expect(page.locator('[data-lightbox-status]')).toHaveAttribute('data-lightbox-status', 'ready');
	const candidate = page.locator(`#asset-${assetId(7)} a`);
	await expect(candidate).toHaveAttribute('data-pswp-type', 'video');
	await expect(candidate).toHaveAttribute('data-video-src', /\/image\/hdr/);
});

test('promotes the legacy WebKit HDR video after its media becomes ready', async ({ page }) => {
	test.skip(!bridgeLog, 'HDR_BRIDGE_LOG is required for the legacy WebKit promotion scenario');
	await page.addInitScript(() => {
		Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 AppleWebKit/605.1.15 Version/18.6 Safari/605.1.15' });
		const nativeMatchMedia = window.matchMedia.bind(window);
		window.matchMedia = (query: string) => query === '(dynamic-range: high)'
			? { ...nativeMatchMedia(query), matches: true }
			: query === '(color-gamut: p3)' || query === '(color-gamut: rec2020)'
				? { ...nativeMatchMedia(query), matches: false }
				: nativeMatchMedia(query);
	});
	await page.goto('/share/key/heic-forward-ref');
	await expect(page.locator('[data-lightbox-status]')).toHaveAttribute('data-lightbox-status', 'ready');
	const candidate = page.locator(`#asset-${assetId(7)} a`);
	await candidate.click();
	await expect(page.locator('.pswp')).toBeVisible();
	await expect(page.locator('.pswp')).toHaveAttribute('data-pswp-hdr-state', 'loaded', { timeout: 90_000 });
});

test('never blanks the lightbox slide while a slow HDR conversion is in flight, and promotes to the video once it completes', async ({ page }) => {
  // Requires HDR_BRIDGE_ENCODE_DELAY_MS (set by the dedicated npm run test:e2e:heic:* scripts) to
  // reproduce the real-world timing that caused this: a real first-time HDR conversion realistically
  // takes several seconds server-side, and the lightbox used to remove the working SDR poster the
  // moment the HDR <video> element was created, leaving a blank slide until the video (or a too-short
  // client timeout) resolved -- observed in production as "loads fullsize, blanks, never recovers".
  test.skip(!bridgeLog || !process.env.HDR_BRIDGE_ENCODE_DELAY_MS, 'HDR_BRIDGE_LOG and HDR_BRIDGE_ENCODE_DELAY_MS are required for this scenario');
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 AppleWebKit/605.1.15 Version/18.6 Safari/605.1.15' });
    const nativeMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query: string) => query === '(dynamic-range: high)'
      ? { ...nativeMatchMedia(query), matches: true }
      : query === '(color-gamut: p3)' || query === '(color-gamut: rec2020)'
        ? { ...nativeMatchMedia(query), matches: false }
        : nativeMatchMedia(query);
  });
  // A distinct asset from the other tests in this file: the server-side HDR cache is a
  // process-level singleton, and reusing an already-requested asset here would hit that warm
  // cache and skip the artificial delay entirely, defeating the point of this test.
  const id = assetId(15);
  await page.goto('/share/key/heic-forward-ref');
  await expect(page.locator('[data-lightbox-status]')).toHaveAttribute('data-lightbox-status', 'ready');
  const candidate = page.locator(`#asset-${id} a`);
  await expect(candidate).toHaveAttribute('data-pswp-type', 'video');
  await candidate.click();
  await expect(page.locator('.pswp')).toBeVisible();

  // Scoped to the currently active slide, excluding PhotoSwipe's own built-in low-res
  // placeholder (a separate, unrelated mechanism it creates automatically): PhotoSwipe also
  // preloads neighboring slides' images into the DOM, which is unrelated to this slide's own
  // placeholder-then-video lifecycle.
  const activeSlideMedia = page.locator('.pswp__item[aria-hidden="false"] img:not(.pswp__img--placeholder), .pswp__item[aria-hidden="false"] video');
  await expect(activeSlideMedia).toBeVisible();
  await expect(activeSlideMedia).toHaveJSProperty('tagName', 'IMG');

  // Partway through the artificial server-side delay, the placeholder must still be the one
  // visible thing -- at no point should the active slide have zero visible media.
  await page.waitForTimeout(Number(process.env.HDR_BRIDGE_ENCODE_DELAY_MS) / 2);
  await expect(activeSlideMedia).toBeVisible();
  await expect(activeSlideMedia).toHaveJSProperty('tagName', 'IMG');

  // Once the slow conversion completes, it must actually promote to the real video and stay there.
  const activeVideo = page.locator('.pswp__item[aria-hidden="false"] video');
  await expect(activeVideo).toBeVisible({ timeout: Number(process.env.HDR_BRIDGE_ENCODE_DELAY_MS) + 10_000 });
  await page.waitForTimeout(500);
  await expect(activeVideo).toBeVisible();
});

function readBridgeInvocations() {
  if (!bridgeLog) return [];
  try { return readFileSync(bridgeLog, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)); } catch { return []; }
}
