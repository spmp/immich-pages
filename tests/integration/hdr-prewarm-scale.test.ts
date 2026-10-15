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
	let convert: ReturnType<typeof vi.fn<(input: { assetId: string }) => Promise<{ body: Uint8Array; contentType: string }>>>;
	beforeEach(async () => {
		clearHdrCache(); clearHdrMetadataCache();
		vi.stubEnv('IMMICH_BASE_URL', 'https://immich.example');
		vi.stubEnv('HDR_PREWARM_LOOKAHEAD', 'all');
		originalsFetched = [];
		convert = vi.fn(async ({ assetId }: { assetId: string }) => ({ body: new Uint8Array([assetId.length]), contentType: 'video/mp4' }));
		restore = setHdrInteractiveCoordinatorForTests(new HdrPrewarmCoordinator({ convert }));
		vi.spyOn(await import('../../src/lib/server/media/hdr-metadata'), 'extractAppleHdrMetadata').mockResolvedValue(metadata);
	});
	afterEach(() => { restore(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

	it('downloads only a small batch of new originals per poll, nearest the open photo first, and says more is coming', async () => {
		const response = await POST(event({ activeAssetId: ids[10], activePosition: 10, representation: 'video' }, fetchMock()) as never);
		expect(response.status).toBe(200);
		expect(originalsFetched.length).toBeGreaterThan(0);
		expect(originalsFetched.length).toBeLessThanOrEqual(8);
		expect(originalsFetched[0]).toBe(ids[10]);
		expect(originalsFetched).toEqual(ids.slice(10, 10 + originalsFetched.length));
		// The whole album is the target, so the page keeps polling until all of it is done.
		const body = await response.json();
		expect(body.targeted).toBe(30);
		expect(body.state).toBe('preparing');
	});

	it('works through the whole album over repeated polls, wrapping round to the photos before the open one', async () => {
		for (let poll = 0; poll < 20 && convert.mock.calls.length < 30; poll += 1) {
			await POST(event({ activeAssetId: ids[10], activePosition: 10, representation: 'video' }, fetchMock()) as never);
			await new Promise((resolve) => setTimeout(resolve, 5));
		}
		await vi.waitFor(() => expect(convert).toHaveBeenCalledTimes(30));
		expect(new Set(originalsFetched)).toEqual(new Set(ids));
		const done = await POST(event({ activeAssetId: ids[10], activePosition: 10, representation: 'video' }, fetchMock()) as never);
		expect(await done.json()).toMatchObject({ state: 'ready', targeted: 30, completed: 30 });
	});

	it('does not download again what is already converted: a revisit answers ready at once', async () => {
		for (let poll = 0; poll < 20 && convert.mock.calls.length < 30; poll += 1) {
			await POST(event({ activeAssetId: ids[0], activePosition: 0, representation: 'video' }, fetchMock()) as never);
			await new Promise((resolve) => setTimeout(resolve, 5));
		}
		await vi.waitFor(() => expect(convert).toHaveBeenCalledTimes(30));
		originalsFetched = [];
		const revisit = await POST(event({ activeAssetId: ids[0], activePosition: 0, representation: 'video' }, fetchMock()) as never);
		expect(await revisit.json()).toMatchObject({ state: 'ready', targeted: 30, completed: 30 });
		expect(originalsFetched).toEqual([]);
	});

	it('finds the open photo by its ID when the album order differs between calls', async () => {
		const reordered = [...share.assets.slice(1), share.assets[0]];
		const response = await POST(event({ activeAssetId: ids[0], activePosition: 0, representation: 'video' }, fetchMock(reordered)) as never);
		expect(response.status).toBe(200);
		expect(originalsFetched[0]).toBe(ids[0]);
	});

	it('still rejects a photo that is not in the share at all', async () => {
		const response = await POST(event({ activeAssetId: '79999999-0000-4000-8000-000000000000', activePosition: 0, representation: 'video' }, fetchMock()) as never);
		expect(response.status).toBe(400);
	});
});
