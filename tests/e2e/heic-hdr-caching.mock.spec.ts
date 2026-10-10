import { expect, test, type Page } from '@playwright/test';
import { readFileSync, unlinkSync } from 'node:fs';

const mode = process.env.HDR_TEST_MODE;
const bridgeLog = process.env.HDR_BRIDGE_LOG;
const assetId = (number: number) => `70000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const numbers = Array.from({ length: 20 }, (_, index) => index + 1);
const ref = 'heic-forward-ref';

test.use({ extraHTTPHeaders: { authorization: 'Bearer fixture' } });

test.beforeEach(async ({ context }) => {
	await context.addCookies([{ name: 'immich_shared_link_token', value: 'fixture', domain: '127.0.0.1', path: '/' }]);
	if (bridgeLog) {
		try { unlinkSync(bridgeLog); } catch { /* The bridge creates it on first invocation. */ }
	}
});

async function enableHdrHints(page: Page) {
	await page.addInitScript((selectedMode) => {
		const nativeMatchMedia = window.matchMedia.bind(window);
		window.matchMedia = (query: string) => query === '(dynamic-range: high)' || query === '(color-gamut: p3)' || query === '(color-gamut: rec2020)'
			? { ...nativeMatchMedia(query), matches: true }
			: nativeMatchMedia(query);
		if (selectedMode === 'video') {
			// Keep the real Chromium media engine, but make the capability policy take its legacy
			// Safari branch so this run exercises the HDR-video fallback rather than AVIF.
			Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 Version/18.6 Safari/605.1.15' });
		}
	}, mode);
}

async function waitForPromotedHdr(page: Page, expectedIndex: number) {
	const announcement = page.locator('[data-pswp-announcement]');
	await expect.poll(async () => announcement.textContent()).toContain(`${expectedIndex} / 20`);
	const root = page.locator('.pswp');
	await expect(root).toHaveAttribute('data-pswp-hdr-state', 'loaded', { timeout: 90_000 });
	await expect(root.locator('.pswp__preloader')).not.toHaveClass(/pswp__preloader--active/);
	if (mode === 'avif') {
		await expect(root.locator('.pswp__item[aria-hidden="false"] img:not(.pswp__img--placeholder)')).toBeVisible();
	} else {
		await expect(root.locator('.pswp__item[aria-hidden="false"] video')).toBeVisible();
	}
}

async function swipe(page: Page, direction: 'next' | 'previous') {
	await page.keyboard.press(direction === 'next' ? 'ArrowRight' : 'ArrowLeft');
}

function bridgeInvocations(): Array<{ method: string; assetId: string }> {
	if (!bridgeLog) return [];
	try {
		return readFileSync(bridgeLog, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
	} catch {
		return [];
	}
}

function expectedMethods() {
	return mode === 'avif'
		? ['extractAppleHdrMetadata', 'decodeHdrAvif', 'encodeHdrAvif']
		: ['extractAppleHdrMetadata', 'composeHdr', 'encodeHdrMp4'];
}

async function waitForAllBackendConversions() {
	const methods = expectedMethods();
	await expect.poll(() => {
		const invocations = bridgeInvocations();
		// The mock server's HDR cache survives between repeated browser runs. A warm
		// run legitimately has no bridge invocations to account for.
		if (!invocations.length) return true;
		return numbers.every((number) => {
			const id = assetId(number);
			return methods.every((method) => invocations.some((invocation) => invocation.assetId === id && invocation.method === method));
		});
	}, { timeout: 90_000 }).toBe(true);
}

test('AVIF HDR promotes through the full gallery and reuses server conversion cache', async ({ page, request }) => {
	test.setTimeout(120_000);
	test.skip(mode !== 'avif' || !bridgeLog, 'run with the AVIF HDR bridge');
	await enableHdrHints(page);
	await page.goto(`/share/key/${ref}`);
	await expect(page.locator('[data-lightbox-status]')).toHaveAttribute('data-lightbox-status', 'ready');
	await expect(page.locator('[id^="asset-"]')).toHaveCount(20);
	const firstCandidate = page.locator(`#asset-${assetId(1)} a`);
	await expect(firstCandidate).toHaveAttribute('data-pswp-type', 'hdr-image');
	const firstHdrSource = await firstCandidate.getAttribute('data-pswp-src');
	const firstHdrResponse = await request.get(new URL(firstHdrSource!, page.url()).toString(), { headers: { cookie: 'immich_shared_link_token=fixture' } });
	await expect(firstHdrResponse).toBeOK();
	expect(firstHdrResponse.headers()['content-type']).toContain('image/avif');
	await firstCandidate.click();
	await expect(page.locator('.pswp')).toBeVisible();

	for (const number of numbers) {
		if (number > 1) await swipe(page, 'next');
		await waitForPromotedHdr(page, number);
	}
	await waitForAllBackendConversions();
	const forwardInvocations = bridgeInvocations();

	for (const number of numbers.slice().reverse().slice(1)) {
		await swipe(page, 'previous');
		await waitForPromotedHdr(page, number);
	}
	await expect.poll(() => bridgeInvocations()).toEqual(forwardInvocations);

	await page.reload();
	await expect(page.locator('[data-lightbox-status]')).toHaveAttribute('data-lightbox-status', 'ready');
	await page.locator(`#asset-${assetId(20)} a`).click();
	await expect(page.locator('.pswp')).toBeVisible();
	await waitForPromotedHdr(page, 20);
	await expect(bridgeInvocations()).toEqual(forwardInvocations);
});

test('HDR video promotes through the full gallery and reuses server conversion cache', async ({ page }) => {
	test.setTimeout(120_000);
	test.skip(mode !== 'video' || !bridgeLog, 'run with the video HDR bridge');
	await enableHdrHints(page);
	await page.goto(`/share/key/${ref}`);
	await expect(page.locator('[data-lightbox-status]')).toHaveAttribute('data-lightbox-status', 'ready');
	await expect(page.locator('[id^="asset-"]')).toHaveCount(20);
	await page.locator(`#asset-${assetId(1)} a`).click();
	await expect(page.locator('.pswp')).toBeVisible();

	for (const number of numbers) {
		if (number > 1) await swipe(page, 'next');
		await waitForPromotedHdr(page, number);
	}
	await waitForAllBackendConversions();
	const forwardInvocations = bridgeInvocations();

	for (const number of numbers.slice().reverse().slice(1)) {
		await swipe(page, 'previous');
		await waitForPromotedHdr(page, number);
	}
	await expect.poll(() => bridgeInvocations()).toEqual(forwardInvocations);

	await page.reload();
	await expect(page.locator('[data-lightbox-status]')).toHaveAttribute('data-lightbox-status', 'ready');
	await page.locator(`#asset-${assetId(20)} a`).click();
	await expect(page.locator('.pswp')).toBeVisible();
	await waitForPromotedHdr(page, 20);
	await expect(bridgeInvocations()).toEqual(forwardInvocations);
});

test('HDR video recovers when a slide is reopened after swiping through cached neighbors', async ({ page }) => {
	test.setTimeout(120_000);
	test.skip(mode !== 'video' || !bridgeLog, 'run with the video HDR bridge');
	await enableHdrHints(page);
	await page.goto(`/share/key/${ref}`);
	await expect(page.locator('[data-lightbox-status]')).toHaveAttribute('data-lightbox-status', 'ready');

	const openAndVerify = async (number: number) => {
		await page.locator(`#asset-${assetId(number)} a`).click();
		await expect(page.locator('.pswp')).toBeVisible();
		await waitForPromotedHdr(page, number);
		await page.keyboard.press('Escape');
		await expect(page.locator('.pswp')).toBeHidden();
	};

	// Match the observed device flow: the first slide succeeds, navigation visits other
	// cached conversions, then closing and reopening an affected thumbnail must still
	// produce HDR rather than leaving the fresh PhotoSwipe content pending forever.
	await openAndVerify(1);
	await openAndVerify(5);
	await openAndVerify(10);

	await page.locator(`#asset-${assetId(5)} a`).click();
	await expect(page.locator('.pswp')).toBeVisible();
	await waitForPromotedHdr(page, 5);
	await swipe(page, 'next');
	await waitForPromotedHdr(page, 6);
});
