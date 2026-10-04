import { expect, test } from '@playwright/test';

async function enableHdrHints(page: import('@playwright/test').Page) {
	await page.addInitScript(() => {
		const nativeMatchMedia = window.matchMedia.bind(window);
		window.matchMedia = (query: string) => {
			if (query === '(dynamic-range: high)' || query === '(color-gamut: p3)' || query === '(color-gamut: rec2020)') return { ...nativeMatchMedia(query), matches: true };
			return nativeMatchMedia(query);
		};
	});
}

test.use({ extraHTTPHeaders: { authorization: 'Bearer fixture' } });
test.beforeEach(async ({ context }) => {
	await context.addCookies([{ name: 'immich_shared_link_token', value: 'fixture', domain: '127.0.0.1', path: '/' }]);
});

test('keeps an adequate thumbnail as the initial and lightbox anchor source', async ({ page }) => {
	const paths: string[] = [];
	page.on('request', (request) => paths.push(new URL(request.url()).pathname));
	await page.goto('/share/key/opaque-ref');
	await expect(page.locator('[data-lightbox-status]')).toHaveAttribute('data-lightbox-status', 'ready');
	const image = page.locator('#asset-550e8400-e29b-41d4-a716-446655440002');
	await expect(image.locator('img')).toHaveAttribute('data-media-source', 'thumbnail');
	await expect(image.locator('a')).toHaveAttribute('href', /\/thumbnail\?/);
	expect(paths.some((path) => /\/original|\/download/.test(path))).toBe(false);
});

test('retains thumbnail fallback semantics when promotion is unavailable', async ({ page }) => {
	await page.goto('/share/key/opaque-ref');
	const image = page.locator('#asset-550e8400-e29b-41d4-a716-446655440002');
	await expect(image.locator('a')).toHaveAttribute('data-lightbox-fallback', 'native-anchor');
	await expect(image.locator('img')).toHaveAttribute('loading', 'lazy');
	await expect(image.locator('a')).toHaveAttribute('href', /\/thumbnail\?/);
});

test('opens the authorized original when inspecting an image', async ({ page }) => {
	await page.goto('/share/key/opaque-ref');
	await expect(page.locator('[data-lightbox-status]')).toHaveAttribute('data-lightbox-status', 'ready');
	const image = page.locator('#asset-550e8400-e29b-41d4-a716-446655440002');
	await expect(image.locator('img')).toHaveAttribute('data-media-source', 'thumbnail');
	await expect(image.locator('a')).toHaveAttribute('data-pswp-src', /\/image\/fullsize\?/);

	const fullsizeResponse = page.waitForResponse((response) => response.url().includes('/image/fullsize'), { timeout: 2_000 });
	await image.locator('a').click();
	const response = await fullsizeResponse;
	expect(response.status()).toBe(200);
	expect(response.url()).toMatch(/^https?:\/\/[^/]+\/share\/key\/opaque-ref\/media\/[^/]+\/image\/fullsize\?/);
	expect(response.headers()['set-cookie']).toBeUndefined();
	expect(response.url()).not.toContain('immich-host');
});

test('falls back to the thumbnail when the promoted original is an undecodable HEIF', async ({ page }) => {
	await page.route('**/share/key/opaque-ref/media/550e8400-e29b-41d4-a716-446655440002/image/fullsize*', async (route) => {
		await route.fulfill({ status: 200, contentType: 'image/heif', body: Buffer.from('not-a-decodable-heif') });
	});
	await page.goto('/share/key/opaque-ref');
	await expect(page.locator('[data-lightbox-status]')).toHaveAttribute('data-lightbox-status', 'ready');
	const anchor = page.locator('#asset-550e8400-e29b-41d4-a716-446655440002 a');
	await anchor.click();
	await expect(page.locator('.pswp')).toBeVisible();
	await expect(page.locator('.pswp__error-msg')).toHaveCount(0);
	await expect(page.locator('.pswp__img')).toHaveAttribute('src', /\/thumbnail\?/);
	await expect(anchor).not.toHaveAttribute('data-pswp-src');
});

test('keeps promotion request context scoped to the share and never broadens media access', async ({ page }) => {
	const requests: string[] = [];
	page.on('request', (request) => requests.push(request.url()));
	await page.goto('/share/slug/opaque-ref');
	await expect(page.locator('#asset-550e8400-e29b-41d4-a716-446655440002 img')).toBeVisible();
	const fullsize = requests.find((url) => url.includes('/image/fullsize'));
	if (fullsize) expect(fullsize).toMatch(/\?(key|slug)=opaque-ref$/);
	expect(requests.some((url) => /\/original|\/download|immich-host/.test(url))).toBe(false);
});

test('never requests HDR for an SDR or unknown-dynamic-range client', async ({ page }) => {
	const hdrRequests: string[] = [];
	page.on('request', (request) => { if (request.url().includes('/image/hdr')) hdrRequests.push(request.url()); });
	await page.goto('/share/key/opaque-ref');
	await expect(page.locator('#asset-550e8400-e29b-41d4-a716-446655440002 img')).toBeVisible();
	await page.waitForTimeout(250);
	expect(hdrRequests).toEqual([]);
});

test('HDR hints keep the poster first and promote only through PhotoSwipe media (AVIF candidate)', async ({ page }) => {
	// Chromium (the browser this mock config always runs under) is in the AVIF-gain-map allowlist
	// (see supportsAvifGainMapHdr), so with HDR hints enabled it's the 'hdr-image' candidate that's
	// exercised here, not the HDR video candidate -- that path is covered on WebKit/video-bridge
	// specifically by tests/e2e/heic-sdr-hdr.mock.spec.ts instead.
	await enableHdrHints(page);
	const hdrRequests: string[] = [];
	page.on('request', (request) => { if (request.url().includes('/image/hdr-avif')) hdrRequests.push(request.url()); });
	await page.goto('/share/key/opaque-ref');
	const asset = page.locator('#asset-550e8400-e29b-41d4-a716-446655440002');
	await expect(asset.locator('img')).toHaveAttribute('data-media-source', 'thumbnail');
	await expect(asset.locator('a')).toHaveAttribute('data-pswp-type', 'hdr-image');
	await expect(asset.locator('a')).toHaveAttribute('data-pswp-poster', /\/image\/fullsize\?/);
	await expect(asset.locator('a')).toHaveAttribute('data-pswp-src', /\/image\/hdr-avif\?/);
	await asset.locator('a').click();
	await expect.poll(() => hdrRequests.length).toBeGreaterThan(0);
	await expect(page.locator('.pswp')).toBeVisible();
	expect(hdrRequests[0]).toMatch(/\?(key|slug)=opaque-ref$/);
});

test('unsupported metadata and HTTP HDR failures restore a usable native fallback', async ({ page }) => {
	await enableHdrHints(page);
	await page.route('**/share/key/opaque-ref/media/550e8400-e29b-41d4-a716-446655440002/image/hdr*', async (route) => {
		await route.fulfill({ status: 404, contentType: 'text/plain', body: 'HDR unavailable' });
	});
	await page.goto('/share/key/opaque-ref');
	await expect(page.locator('[data-lightbox-status]')).toHaveAttribute('data-lightbox-status', 'ready');
	const anchor = page.locator('#asset-550e8400-e29b-41d4-a716-446655440002 a');
	await anchor.click();
	await expect(page.locator('.pswp')).toBeVisible();
	await expect(page.locator('.pswp__error-msg')).toHaveCount(0);
	// The lightbox never removes the already-working SDR poster (the same fullsize image already
	// proven to load) while attempting an optional HDR upgrade, so an HDR failure leaves that
	// poster in place rather than degrading further to the lower-resolution thumbnail.
	await expect(page.locator('.pswp__img:not(.pswp__img--placeholder)')).toHaveAttribute('src', /\/image\/fullsize\?/);
	await expect(anchor).toHaveAttribute('data-lightbox-fallback', 'native-anchor');
});

test('portrait and landscape assets retain bounded intrinsic viewer dimensions', async ({ page }) => {
	await page.goto('/share/key/opaque-ref');
	await expect(page.locator('#asset-550e8400-e29b-41d4-a716-446655440002 a')).toHaveAttribute('data-pswp-width', '1200');
	await expect(page.locator('#asset-550e8400-e29b-41d4-a716-446655440007 a')).toHaveAttribute('data-pswp-height', '1200');
});
