import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const id = '70000000-0000-4000-8000-000000000001';

test.use({ extraHTTPHeaders: { authorization: 'Bearer fixture' } });

async function selectVideoCapability(page: Page) {
	await page.context().addCookies([{ name: 'immich_shared_link_token', value: 'fixture', domain: '127.0.0.1', path: '/' }]);
	await page.addInitScript(() => {
		// Deliberately select the legacy WebKit video branch: HDR display is true, P3/AVIF is not.
		Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 AppleWebKit/605.1.15 Version/18.6 Safari/605.1.15' });
		const nativeMatchMedia = window.matchMedia.bind(window);
		window.matchMedia = (query: string) => query === '(dynamic-range: high)'
			? { ...nativeMatchMedia(query), matches: true }
			: nativeMatchMedia(query);
	});
}

function encodeCount(): number {
	const path = process.env.HDR_BRIDGE_LOG;
	if (!path) throw new Error('HDR_BRIDGE_LOG is required; WebKit promotion evidence cannot be inferred from DOM stubs');
	try {
		return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)).filter((event) => event.method === 'encodeHdrMp4').length;
	} catch { return 0; }
}

test('WebKit real-route evidence: delayed HDR video loads, plays, promotes, and is reused on revisit', async ({ page }) => {
	test.setTimeout(90_000);
	await selectVideoCapability(page);
	const before = encodeCount();
	const representations: string[] = [];
	page.on('request', (request) => {
		if (request.method() === 'POST' && request.url().endsWith('/prewarm')) representations.push(request.headers()['x-hdr-representation'] ?? '');
	});
	await page.goto('/share/key/heic-forward-ref');
	const candidate = page.locator(`#asset-${id} a`);
	await expect(candidate).toHaveAttribute('data-video-src', /\/image\/hdr/);
	await expect.poll(() => representations.length).toBeGreaterThan(0);
	expect(representations).toContain('video');

	const mediaResponse = page.waitForResponse((response) => response.url().includes(`/media/${id}/image/hdr`) && response.request().method() === 'GET' && [200, 206].includes(response.status()));
	await expect(candidate).toBeVisible();
	await candidate.click({ force: true });
	await expect(page.locator('.pswp')).toBeVisible();
	const media = await mediaResponse;
	expect([200, 206]).toContain(media.status());
	const activeVideo = page.locator('.pswp__item[aria-hidden="false"] video.pswp__video');
	await expect(activeVideo).toBeVisible();
	await expect.poll(() => activeVideo.evaluate((video) => (video as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2);
	await expect.poll(() => activeVideo.evaluate((video) => !(video as HTMLVideoElement).paused)).toBe(true);
	await expect(page.locator('[data-pswp-hdr-status]')).toHaveText('HDR video: playing');
	await expect(page.locator('.pswp[data-pswp-hdr-state="loaded"]')).toBeVisible();
	const conversionsAfterPromotion = encodeCount();
	expect(conversionsAfterPromotion).toBeGreaterThanOrEqual(before + 1);

	await page.keyboard.press('Escape');
	await expect(page.locator('.pswp')).toBeHidden();
	await candidate.click();
	await expect(page.locator('.pswp')).toBeVisible();
	await expect(page.locator('.pswp[data-pswp-hdr-state="loaded"]')).toBeVisible();
	await expect.poll(() => page.locator('.pswp__item[aria-hidden="false"] video').evaluate((video) => !(video as HTMLVideoElement).paused)).toBe(true);
	await expect.poll(() => encodeCount()).toBe(conversionsAfterPromotion);
});
