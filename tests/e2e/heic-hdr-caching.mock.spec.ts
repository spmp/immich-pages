import { expect, test, type Page, type Route } from '@playwright/test';

const ref = 'heic-forward-ref';
const assetId = (number: number) => `70000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const positions = Array.from({ length: 20 }, (_, index) => index);

test.use({ extraHTTPHeaders: { authorization: 'Bearer fixture' } });

type Command = { activeAssetId: string; activePosition: number };
type ControlRequest = { command: Command; representation: string; bodyKeys: string[] };

async function enableHdrHints(page: Page) {

	await page.addInitScript(() => {
		Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 AppleWebKit/605.1.15 Version/18.6 Safari/605.1.15' });
		const nativeMatchMedia = window.matchMedia.bind(window);
		window.matchMedia = (query: string) => query === '(dynamic-range: high)'
			? { ...nativeMatchMedia(query), matches: true }
			: nativeMatchMedia(query);
	});
}

function targetCount(mode: '0' | '3' | 'all', activePosition: number): number {
	if (mode === '0') return 0;
	const ahead = positions.filter((position) => position > activePosition);
	return mode === 'all' ? ahead.length : Math.min(3, ahead.length);
}

async function installControlPlane(page: Page, mode: '0' | '3' | 'all', requests: ControlRequest[]) {
	await page.route('**/prewarm', async (route: Route) => {
		const request = route.request();
		const body = request.postDataJSON() as Command;
		requests.push({
			command: body,
			representation: await request.headerValue('x-hdr-representation') ?? '',
			bodyKeys: Object.keys(body).sort()
		});
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				generation: 1,
				representation: await request.headerValue('x-hdr-representation') ?? 'avif',
				state: mode === '0' ? 'ready' : 'preparing',
				targeted: targetCount(mode, body.activePosition),
				queued: targetCount(mode, body.activePosition),
				running: 0,
				completed: 0,
				failed: 0,
				skipped: 0
			})
		});
	});
}

async function announce(page: Page, number: number) {
	await page.evaluate(({ id, position }) => {
		document.dispatchEvent(new CustomEvent('pages:active-asset', { detail: { activeAssetId: id, activePosition: position } }));
	}, { id: assetId(number), position: number - 1 });
}

test('server-owned control plane receives only capability and active position, advances its window, and deduplicates visitors', async ({ browser, page }) => {
	test.setTimeout(60_000);
	await enableHdrHints(page);
	const requests: ControlRequest[] = [];
	await installControlPlane(page, '3', requests);
	await page.goto(`/share/key/${ref}`);
	await expect(page.locator('[id^="asset-"]')).toHaveCount(20);
	await expect.poll(() => requests.length).toBeGreaterThan(0);
	await announce(page, 5);
	await announce(page, 15);
	await expect.poll(() => requests.some(({ command }) => command.activePosition === 14)).toBe(true);

	const secondPage = await browser.newPage();
	await secondPage.addInitScript(() => {
		Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 AppleWebKit/605.1.15 Version/18.6 Safari/605.1.15' });
		const nativeMatchMedia = window.matchMedia.bind(window);
		window.matchMedia = (query: string) => query === '(dynamic-range: high)'
			? { ...nativeMatchMedia(query), matches: true }
			: nativeMatchMedia(query);
	});
	await installControlPlane(secondPage, '3', requests);
	await secondPage.goto(`/share/key/${ref}`);
	await expect.poll(() => requests.filter(({ command }) => command.activePosition === 0).length).toBeGreaterThan(1);

	for (const request of requests) {
		expect(request.representation).toBe('video');
		expect(request.bodyKeys).toEqual(['activeAssetId', 'activePosition']);
		expect(request.command.activeAssetId).toMatch(/^70000000-0000-4000-8000-/);
		expect(request.command.activePosition).toBeGreaterThanOrEqual(0);
	}
	const uniqueCommands = new Set(requests.map(({ command }) => `${command.activeAssetId}:${command.activePosition}`));
	expect(uniqueCommands).toEqual(new Set([`${assetId(1)}:0`, `${assetId(5)}:4`, `${assetId(15)}:14`]));
	await secondPage.close();
});

test('look-ahead 0, N, and all responses target exact eligible work without a client asset list', async ({ page }) => {
	await enableHdrHints(page);
	for (const mode of ['0', '3', 'all'] as const) {
		const requests: ControlRequest[] = [];
		await installControlPlane(page, mode, requests);
		await page.goto(`/share/key/${ref}`);
		await expect.poll(() => requests.length).toBeGreaterThan(0);
		const initial = requests.at(-1)!;
		expect(initial.command.activePosition).toBe(0);
		expect(targetCount(mode, initial.command.activePosition)).toBe(mode === '0' ? 0 : mode === 'all' ? 19 : 3);
		await page.unroute('**/prewarm');
	}
});

test('interactive HDR media requests are prioritized independently from background announcements', async ({ page }) => {
	await enableHdrHints(page);
	const requests: ControlRequest[] = [];
	await installControlPlane(page, '3', requests);
	await page.route('**/image/hdr**', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
	await page.goto(`/share/key/${ref}`);
	const hdrRequest = page.waitForRequest((request) => request.url().includes('/image/hdr'));
	await page.evaluate(({ id, shareRef }) => fetch(`/share/key/${shareRef}/media/${id}/image/hdr?key=${shareRef}&priority=interactive`), { id: assetId(5), shareRef: ref });
	const request = await hdrRequest;
	expect(new URL(request.url()).searchParams.get('priority')).toBe('interactive');
	expect(request.url()).not.toContain('/original');
	expect(request.url()).not.toContain('/download');
});
