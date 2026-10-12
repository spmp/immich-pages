import { expect, test, type Page, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';

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

test('control-shape: server-owned control plane receives only capability and active position', async ({ browser, page }) => {
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

test('control-shape: look-ahead 0, N, and all target exact eligible work', async ({ page }) => {
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

test('control-shape: interactive HDR media requests are prioritized independently', async ({ page }) => {
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

function bridgeEvents(): Array<{ method?: string; assetId?: string | null }> {
	const path = process.env.HDR_BRIDGE_LOG;
	if (!path) throw new Error('HDR_BRIDGE_LOG is required for real-route caching evidence');
	try { return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)); }
	catch { return []; }
}

async function installVideoHints(page: Page) {
	await page.context().addCookies([{ name: 'immich_shared_link_token', value: 'fixture', domain: '127.0.0.1', path: '/' }]);
	await page.addInitScript(() => {
		Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 AppleWebKit/605.1.15 Version/18.6 Safari/605.1.15' });
		const nativeMatchMedia = window.matchMedia.bind(window);
		window.matchMedia = (query: string) => query === '(dynamic-range: high)' ? { ...nativeMatchMedia(query), matches: true } : nativeMatchMedia(query);
	});
}

test('real-route evidence: prewarm completion is reused by first and later HDR media requests', async ({ page }) => {
	test.setTimeout(120_000);
	await installVideoHints(page);
	const before = bridgeEvents().length;
	const prewarmResponses: Array<{ status: number; body: Record<string, unknown> }> = [];
	page.on('response', async (response) => {
		if (!response.url().endsWith('/prewarm')) return;
		try { prewarmResponses.push({ status: response.status(), body: await response.json() }); } catch { /* navigation teardown */ }
	});
	await page.goto('/share/key/heic-forward-ref');
	await expect(page.locator('[id^="asset-"]')).toHaveCount(20);
	await expect(page.locator('[data-hdr-representation="video"]')).toHaveCount(20);
	await expect.poll(() => prewarmResponses.some(({ status }) => status === 200)).toBe(true);
	expect(prewarmResponses.map(({ body }) => ({ state: body.state, targeted: body.targeted, completed: body.completed }))).toContainEqual(expect.objectContaining({ state: 'preparing', targeted: 20 }));
	await expect.poll(() => prewarmResponses.some(({ body }) => body.state === 'ready' && body.targeted === 20 && body.completed === 20), { timeout: 100_000 }).toBe(true);
	await expect(page.locator('[aria-label="Enhanced photos ready"]')).toBeVisible();

	const completed = bridgeEvents().slice(before).filter((event) => event.method === 'encodeHdrMp4');
	expect(new Set(completed.map((event) => event.assetId)).size).toBe(20);
	const conversionsBeforeMedia = completed.length;
	for (const number of [2, 20]) {
		const response = await page.evaluate(({ id }) => fetch(`/share/key/heic-forward-ref/media/${id}/image/hdr?key=heic-forward-ref&width=1200&height=800`, { headers: { range: 'bytes=0-1' } }).then((result) => ({ status: result.status, contentRange: result.headers.get('content-range') })), { id: assetId(number) });
		expect(response.status).toBe(206);
		expect(response.contentRange).toMatch(/^bytes 0-1\//);
		await expect.poll(() => bridgeEvents().slice(before).filter((event) => event.method === 'encodeHdrMp4').length).toBe(conversionsBeforeMedia);
	}
});

test('real-route evidence: all lookahead drains beyond queue capacity and keeps progress scoped', async ({ browser }) => {
	test.setTimeout(120_000);
	const first = await browser.newPage({ extraHTTPHeaders: { authorization: 'Bearer fixture' } });
	const second = await browser.newPage({ extraHTTPHeaders: { authorization: 'Bearer fixture' } });
	await Promise.all([installVideoHints(first), installVideoHints(second)]);
	const responses: Array<{ page: string; body: Record<string, unknown> }> = [];
	const pages = [['first', first], ['second', second]] as const;
	for (const [name, current] of pages) current.on('response', async (response) => {
		if (!response.url().endsWith('/prewarm')) return;
		try { responses.push({ page: name, body: await response.json() }); } catch { /* navigation teardown */ }
	});
	await Promise.all([first.goto('/share/key/heic-forward-ref'), second.goto('/share/key/heic-second-ref')]);
	await expect.poll(() => responses.filter(({ body }) => body.state === 'ready').length, { timeout: 100_000 }).toBe(2);
	for (const name of ['first', 'second']) expect(responses.filter((item) => item.page === name).at(-1)?.body).toMatchObject({ targeted: 20, completed: 20, failed: 0 });
	await first.close();
	await second.close();
});

test('real-route evidence: nested album order wins over a scrambled top-level projection', async ({ page }) => {
	await installVideoHints(page);
	const commands: Array<{ activeAssetId: string; activePosition: number }> = [];
	page.on('request', (request) => {
		if (request.method() === 'POST' && request.url().endsWith('/prewarm')) commands.push(request.postDataJSON());
	});
	await page.goto('/share/key/heic-order-production-ref');
	await expect(page.locator('[id^="asset-"]')).toHaveCount(20);
	await expect.poll(() => commands.length).toBeGreaterThan(0);
	expect(await page.locator('[id^="asset-"]').evaluateAll((figures) => figures.slice(0, 3).map((figure) => figure.getAttribute('data-asset-id')))).toEqual([assetId(1), assetId(2), assetId(3)]);
	expect(commands[0]).toMatchObject({ activeAssetId: assetId(1), activePosition: 0, representation: 'video' });
});

test('renders both real album projections in upstream order and keeps HDR positions aligned', async ({ page }) => {
	await installVideoHints(page);
	const orders = [
		{ ref: 'heic-forward-ref', numbers: Array.from({ length: 20 }, (_, index) => index + 1) },
		{ ref: 'heic-reverse-ref', numbers: Array.from({ length: 20 }, (_, index) => 20 - index) }
	] as const;

	for (const { ref: shareRef, numbers } of orders) {
		const commands: Command[] = [];
		page.on('request', (request) => {
			if (request.method() !== 'POST' || !request.url().endsWith('/prewarm')) return;
			const body = request.postDataJSON() as Command;
			commands.push(body);
		});

		await page.goto(`/share/key/${shareRef}`);
		await expect(page.locator('[id^="asset-"]')).toHaveCount(numbers.length);
		await expect.poll(() => page.locator('[id^="asset-"]').evaluateAll((figures) => figures.map((figure) => figure.getAttribute('data-asset-id')))).toEqual(numbers.map(assetId));

		for (const [position, number] of numbers.entries()) {
			await page.evaluate(({ id, activePosition }) => {
				document.dispatchEvent(new CustomEvent('pages:active-asset', { detail: { activeAssetId: id, activePosition } }));
			}, { id: assetId(number), activePosition: position });
			await expect.poll(() => commands.some((command) => command.activePosition === position && command.activeAssetId === assetId(number))).toBe(true);
		}

		page.removeAllListeners('request');
	}
});
