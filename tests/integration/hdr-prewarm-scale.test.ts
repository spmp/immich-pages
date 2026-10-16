import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../../src/routes/share/[kind]/[ref]/prewarm/+server';
import { HdrPrewarmCoordinator, setHdrInteractiveCoordinatorForTests } from '../../src/lib/server/media/hdr-prewarm';
import { clearHdrCache } from '../../src/lib/server/media/hdr-cache';
import { clearHdrMetadataCache } from '../../src/lib/server/media/hdr-metadata-cache';
import v3 from '../fixtures/shared-link/v3-valid-page.json';
import type { AppleHdrMetadata } from '../../src/lib/server/media/hdr-metadata';

// Production (2026-10-15, HDR_PREWARM_LOOKAHEAD=all, 125-photo album): every /prewarm poll
// downloaded EVERY original in the album, one after another, before answering -- so conversions
// started late, a revisit of a fully converted album took minutes to report "ready", and the
// server held every original in memory at once. And the open photo was located by position
// alone, so an album whose order differed between two Immich calls was rejected (400), which
// the page shows as an orange dot.
vi.setConfig({ testTimeout: 30_000 });

const ids = Array.from({ length: 30 }, (_, index) => `71000000-0000-4000-8000-${String(index).padStart(12, '0')}`);
const source = new Uint8Array([0, 0, 0, 0, 102, 116, 121, 112, 104, 101, 105, 99]);
const metadata: AppleHdrMetadata = { version: '1.0', auxiliaryType: 'urn:com:apple:photo:2020:aux:hdrgainmap', makerNote33: 0.8, makerNote48: 0.4, headroom: 1.8, hdrGain: 0.4, sourceProfile: 'display-p3', sourceTransfer: 'srgb', orientation: 1 };
const share = { ...v3, type: 'ALBUM', album: { ...v3.album, id: '11111111-1111-4111-8111-111111111111' }, assets: ids.map((id) => ({ ...v3.assets[0], id, type: 'IMAGE', originalMimeType: 'image/heic', width: 800, height: 600 })) };
const event = (body: unknown, fetch: typeof globalThis.fetch) => ({ params: { kind: 'key', ref: 'scale-ref' }, request: new Request('https://pages.example/share/key/scale-ref/prewarm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), cookies: { get: vi.fn(), set: vi.fn() }, fetch });

let originalsFetched: string[];
const fetchMock = (assets = share.assets) => vi.fn(async (input: URL | RequestInfo) => {
	const url = new URL(input.toString());
	if (url.pathname.endsWith('/me')) return new Response(JSON.stringify({ ...share, assets }));
	const match = url.pathname.match(/assets\/([^/]+)\/original/);
	if (match) originalsFetched.push(match[1]);
	return new Response(source, { headers: { 'content-type': 'image/heic', etag: `"${match?.[1]}"` } });
});

describe('HDR prewarm at album scale', () => {
	let restore: () => void;
	let coordinator: HdrPrewarmCoordinator;
	let convert: ReturnType<typeof vi.fn<(input: { assetId: string }) => Promise<{ body: Uint8Array; contentType: string }>>>;
	beforeEach(async () => {
		clearHdrCache(); clearHdrMetadataCache();
		vi.stubEnv('IMMICH_BASE_URL', 'https://immich.example');
		vi.stubEnv('HDR_PREWARM_LOOKAHEAD', 'all');
		originalsFetched = [];
		convert = vi.fn(async ({ assetId }: { assetId: string }) => ({ body: new Uint8Array([assetId.length]), contentType: 'video/mp4' }));
		coordinator = new HdrPrewarmCoordinator({ convert });
		restore = setHdrInteractiveCoordinatorForTests(coordinator);
		vi.spyOn(await import('../../src/lib/server/media/hdr-metadata'), 'extractAppleHdrMetadata').mockResolvedValue(metadata);
	});
	afterEach(async () => {
		// The queue outlives a request by design: stop it, and let what is converting finish, so it
		// does not compete with the next test for conversion slots.
		coordinator.dispose();
		await vi.waitFor(() => expect(coordinator.idle()).toBe(true), { timeout: 10_000 });
		restore(); vi.restoreAllMocks(); vi.unstubAllEnvs();
	});

	// One visit queues the whole album on the server; the work carries on after the page is left.
	// Before, work was admitted only while the page kept polling, so leaving page A stranded the
	// rest of A until it was revisited.
	it('queues the whole album from one visit and finishes it without further polls', async () => {
		const response = await POST(event({ activeAssetId: ids[10], activePosition: 10, representation: 'video' }, fetchMock()) as never);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ state: 'preparing', targeted: 30 });
		// No more polls: the page has been left.
		await vi.waitFor(() => expect(convert).toHaveBeenCalledTimes(30), { timeout: 15_000 });
		expect(new Set(originalsFetched)).toEqual(new Set(ids));
		const done = await POST(event({ activeAssetId: ids[10], activePosition: 10, representation: 'video' }, fetchMock()) as never);
		expect(await done.json()).toMatchObject({ state: 'ready', targeted: 30, completed: 30 });
	});

	it('answers at once, without downloading originals in the request, and starts at the open photo', async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => { release = resolve; });
		const slow = vi.fn(async (input: URL | RequestInfo) => { if (input.toString().includes('/original')) await gate; return fetchMock()(input); });
		const response = await POST(event({ activeAssetId: ids[10], activePosition: 10, representation: 'video' }, slow as never) as never);
		expect(response.status).toBe(200);
		release();
		await vi.waitFor(() => expect(originalsFetched.length).toBeGreaterThan(0));
		expect(originalsFetched[0]).toBe(ids[10]);
	});

	it('holds only a few originals in memory at a time however large the album', async () => {
		let open = 0;
		let peak = 0;
		convert.mockImplementation(async ({ assetId }: { assetId: string }) => {
			open += 1; peak = Math.max(peak, open);
			await new Promise((resolve) => setTimeout(resolve, 10));
			open -= 1;
			return { body: new Uint8Array([assetId.length]), contentType: 'video/mp4' };
		});
		await POST(event({ activeAssetId: ids[0], activePosition: 0, representation: 'video' }, fetchMock()) as never);
		await vi.waitFor(() => expect(convert).toHaveBeenCalledTimes(30), { timeout: 15_000 });
		expect(peak).toBeLessThanOrEqual(8);
	});

	it('does not download again what is already converted: a revisit answers ready at once', async () => {
		await POST(event({ activeAssetId: ids[0], activePosition: 0, representation: 'video' }, fetchMock()) as never);
		await vi.waitFor(() => expect(convert).toHaveBeenCalledTimes(30), { timeout: 15_000 });
		originalsFetched = [];
		const revisit = await POST(event({ activeAssetId: ids[0], activePosition: 0, representation: 'video' }, fetchMock()) as never);
		expect(await revisit.json()).toMatchObject({ state: 'ready', targeted: 30, completed: 30 });
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(originalsFetched).toEqual([]);
	});

	it('finds the open photo by its ID when the album order differs between calls', async () => {
		const reordered = [...share.assets.slice(1), share.assets[0]];
		const response = await POST(event({ activeAssetId: ids[0], activePosition: 0, representation: 'video' }, fetchMock(reordered)) as never);
		expect(response.status).toBe(200);
		await vi.waitFor(() => expect(originalsFetched.length).toBeGreaterThan(0));
		expect(originalsFetched[0]).toBe(ids[0]);
	});

	it('still rejects a photo that is not in the share at all', async () => {
		const response = await POST(event({ activeAssetId: '79999999-0000-4000-8000-000000000000', activePosition: 0, representation: 'video' }, fetchMock()) as never);
		expect(response.status).toBe(400);
	});

	// Two albums opened one after the other share the conversion queue fairly: their photos are
	// interleaved, so the second is not stuck behind the whole of the first.
	it('interleaves two shares instead of finishing one before starting the other', async () => {
		const order: string[] = [];
		convert.mockImplementation(async ({ assetId }: { assetId: string }) => { order.push(assetId); await new Promise((resolve) => setTimeout(resolve, 5)); return { body: new Uint8Array([1]), contentType: 'video/mp4' }; });
		const otherIds = ids.map((id) => id.replace('71000000', '72000000'));
		const otherShare = { ...share, assets: otherIds.map((id) => ({ ...share.assets[0], id })) };
		const otherFetch = vi.fn(async (input: URL | RequestInfo) => {
			const url = new URL(input.toString());
			if (url.pathname.endsWith('/me')) return new Response(JSON.stringify(otherShare));
			return new Response(source, { headers: { 'content-type': 'image/heic', etag: `"${url.pathname}"` } });
		});
		const otherEvent = { ...event({ activeAssetId: otherIds[0], activePosition: 0, representation: 'video' }, otherFetch as never), params: { kind: 'key', ref: 'other-ref' } };
		await POST(event({ activeAssetId: ids[0], activePosition: 0, representation: 'video' }, fetchMock()) as never);
		await POST(otherEvent as never);
		await vi.waitFor(() => expect(convert).toHaveBeenCalledTimes(60), { timeout: 20_000 });
		// Within the first third of all conversions, the second album already has a fair share.
		const early = order.slice(0, 20);
		expect(early.filter((id) => id.startsWith('72')).length).toBeGreaterThanOrEqual(6);
	});

	it('moves the photos from a new position to the front when the visitor moves on', async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => { release = resolve; });
		convert.mockImplementation(async ({ assetId }: { assetId: string }) => { await gate; return { body: new Uint8Array([assetId.length]), contentType: 'video/mp4' }; });
		await POST(event({ activeAssetId: ids[0], activePosition: 0, representation: 'video' }, fetchMock()) as never);
		await new Promise((resolve) => setTimeout(resolve, 30));
		await POST(event({ activeAssetId: ids[20], activePosition: 20, representation: 'video' }, fetchMock()) as never);
		release();
		await vi.waitFor(() => expect(convert).toHaveBeenCalledTimes(30), { timeout: 15_000 });
		const afterMove = originalsFetched.findIndex((id) => id === ids[20]);
		const stillOld = originalsFetched.findIndex((id) => id === ids[19]);
		expect(afterMove).toBeLessThan(stillOld);
	});

	it('drops a share\'s queue when Immich stops authorising it', async () => {
		await POST(event({ activeAssetId: ids[0], activePosition: 0, representation: 'video' }, fetchMock()) as never);
		await vi.waitFor(() => expect(convert.mock.calls.length).toBeGreaterThan(0));
		// The share is revoked: Immich answers 403 from now on.
		const revoked = vi.fn(async () => new Response('denied', { status: 403 }));
		await POST(event({ activeAssetId: ids[0], activePosition: 0, representation: 'video' }, revoked as never) as never);
		const before = convert.mock.calls.length;
		await new Promise((resolve) => setTimeout(resolve, 300));
		expect(convert.mock.calls.length - before).toBeLessThanOrEqual(8);
	});
});

