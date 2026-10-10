import { expect, test, type Page, type Route } from '@playwright/test';

const ref = 'heic-forward-ref';
const assetId = (number: number) => `70000000-0000-4000-8000-${String(number).padStart(12, '0')}`;

test.use({ extraHTTPHeaders: { authorization: 'Bearer fixture' } });

async function installHints(page: Page, kind: 'avif' | 'video' | 'none') {
	await page.addInitScript((selected) => {
		if (selected === 'avif') Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 AppleWebKit/605.1.15 Version/26.1 Safari/605.1.15' });
		const nativeMatchMedia = window.matchMedia.bind(window);
		window.matchMedia = (query: string) => {
			const hdr = selected !== 'none' && query === '(dynamic-range: high)';
			const gamut = selected === 'avif' && (query === '(color-gamut: p3)' || query === '(color-gamut: rec2020)');
			return hdr || gamut ? { ...nativeMatchMedia(query), matches: true } : nativeMatchMedia(query);
		};
		if (selected === 'video') Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 AppleWebKit/605.1.15 Version/18.6 Safari/605.1.15' });
	}, kind);
}

async function controlPlane(page: Page, state: 'preparing' | 'ready' | 'partial', representation: 'avif' | 'video' = 'avif') {
	await page.route('**/prewarm', (route) => route.fulfill({
		status: 200,
		contentType: 'application/json',
		body: JSON.stringify({ generation: 1, representation, state, targeted: 3, queued: state === 'preparing' ? 2 : 0, running: state === 'preparing' ? 1 : 0, completed: state === 'ready' ? 3 : 0, failed: state === 'partial' ? 1 : 0, skipped: 0 })
	}));
}

async function assertUsableSdr(page: Page, number: number) {
	const slide = page.locator('.pswp__item[aria-hidden="false"]');
	await expect(slide.locator('img')).toBeVisible();
	await expect(slide).not.toContainText(/image cannot be loaded/i);
	await expect(page.locator('.pswp')).toBeVisible();
	await expect(page.locator(`#asset-${assetId(number)} a`)).toHaveAttribute('data-lightbox-fallback', 'native-anchor');
}

test('unsupported clients stay SDR-only and keep a native anchor', async ({ page }) => {
	await installHints(page, 'none');
	const controlRequests: string[] = [];
	await page.route('**/prewarm', (route) => { controlRequests.push(route.request().url()); return route.fulfill({ status: 500, body: '{}' }); });
	await page.goto(`/share/key/${ref}`);
	await expect(page.locator(`#asset-${assetId(1)} a`)).not.toHaveAttribute('data-pswp-type', 'hdr-image');
	await expect(page.locator(`#asset-${assetId(1)} a`)).not.toHaveAttribute('data-video-src', /image\/hdr/);
	expect(controlRequests).toHaveLength(0);
	await expect(page.locator(`#asset-${assetId(1)} a`)).toHaveAttribute('href', /thumbnail/);
});

test('preparing, ready, and partial readiness never block SDR navigation', async ({ page }) => {
	await installHints(page, 'avif');
	let state: 'preparing' | 'ready' | 'partial' = 'preparing';
	await page.route('**/prewarm', (route) => route.fulfill({
		status: 200, contentType: 'application/json',
		body: JSON.stringify({ generation: 1, representation: 'avif', state, targeted: 3, queued: state === 'preparing' ? 1 : 0, running: state === 'preparing' ? 1 : 0, completed: state === 'ready' ? 3 : 0, failed: state === 'partial' ? 1 : 0, skipped: 0 })
	}));
	await page.goto(`/share/key/${ref}`);
	await expect(page.locator('[data-lightbox-status]')).toHaveAttribute('data-lightbox-status', 'ready');
	await expect(page.locator('[id^="asset-"]')).toHaveCount(20);
	await expect(page.locator('[aria-label="Preparing enhanced photos"]')).toBeVisible();
	state = 'ready';
	await page.evaluate(() => document.dispatchEvent(new CustomEvent('pages:active-asset', { detail: { activeAssetId: '70000000-0000-4000-8000-000000000005', activePosition: 4 } })));
	await expect(page.locator('[aria-label="Enhanced photos ready"]')).toBeVisible();
	state = 'partial';
	await page.evaluate(() => document.dispatchEvent(new CustomEvent('pages:active-asset', { detail: { activeAssetId: '70000000-0000-4000-8000-000000000006', activePosition: 5 } })));
	await expect(page.locator('[aria-label*="Some enhanced photos are unavailable"]')).toBeVisible();
	await expect(page.locator('section[aria-label="Gallery"]')).toBeVisible();
	await expect(page.locator('body')).not.toContainText(/image cannot be loaded/i);
});

test('AVIF HTTP/decode failures and legacy video playback failure recover to the SDR poster', async ({ browser }) => {
	for (const [kind, failure] of [['avif', 'http'], ['avif', 'decode'], ['video', 'playback']] as const) {
		const page = await browser.newPage({ extraHTTPHeaders: { authorization: 'Bearer fixture' } });
		await page.context().addCookies([{ name: 'immich_shared_link_token', value: 'fixture', domain: '127.0.0.1', path: '/' }]);
		await installHints(page, kind);
		await controlPlane(page, 'ready', kind);
		const mediaPath = kind === 'avif' ? '/image/hdr-avif' : '/image/hdr';
		await page.route(`**${mediaPath}**`, async (route: Route) => {
			if (failure === 'decode') return route.fulfill({ status: 200, contentType: 'image/avif', body: 'not-an-avif' });
			return route.fulfill({ status: 503, contentType: kind === 'avif' ? 'image/avif' : 'video/mp4', body: '' });
		});
		await page.goto(`/share/key/${ref}`);
		const candidate = page.locator(`#asset-${assetId(7)} a`);
		if (kind === 'video') {
			await expect(candidate).toHaveAttribute('data-video-src', /image\/hdr/);
			await candidate.click();
			await assertUsableSdr(page, 7);
		} else {
			const response = await page.evaluate(({ shareRef, id }) => fetch(`/share/key/${shareRef}/media/${id}/image/hdr-avif?key=${shareRef}`).then((result) => result.status), { shareRef: ref, id: assetId(7) });
			expect(response).toBe(failure === 'http' ? 503 : 200);
			await expect(candidate).toHaveAttribute('data-lightbox-fallback', 'native-anchor');
		}
		await expect(page.locator('text=The image cannot be loaded')).toHaveCount(0);
		await expect(page.locator('a[href*="/original"], a[href*="/download"]')).toHaveCount(0);
		await page.close();
	}
});

test('video and AVIF control-plane progress stay representation-specific', async ({ browser }) => {
	const seen: string[] = [];
	for (const kind of ['avif', 'video'] as const) {
		const page = await browser.newPage({ extraHTTPHeaders: { authorization: 'Bearer fixture' } });
		await page.context().addCookies([{ name: 'immich_shared_link_token', value: 'fixture', domain: '127.0.0.1', path: '/' }]);
		await installHints(page, kind);
		await page.route('**/prewarm', async (route) => { seen.push(await route.request().headerValue('x-hdr-representation') ?? ''); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ generation: 1, representation: kind, state: 'ready', targeted: 1, queued: 0, running: 0, completed: 1, failed: 0, skipped: 0 }) }); });
		await page.goto(`/share/key/${ref}`);
		await page.evaluate(({ shareRef, representation }) => fetch(`/share/key/${shareRef}/prewarm`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hdr-representation': representation }, body: JSON.stringify({ activeAssetId: '70000000-0000-4000-8000-000000000001', activePosition: 0 }) }), { shareRef: ref, representation: kind });
		await expect.poll(() => seen.includes(kind)).toBe(true);
		await page.close();
	}
	expect(seen).toContain('avif');
	expect(seen).toContain('video');
	// This is mock/control-plane evidence only; it intentionally makes no physical HDR claim.
});
