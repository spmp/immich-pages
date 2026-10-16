import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../../src/routes/share/[kind]/[ref]/prewarm/+server';
import { GET as GET_HDR } from '../../src/routes/share/[kind]/[ref]/media/[assetId]/image/hdr/+server';
import { HdrPrewarmCoordinator, setHdrInteractiveCoordinatorForTests } from '../../src/lib/server/media/hdr-prewarm';
import { clearHdrCache } from '../../src/lib/server/media/hdr-cache';
import { clearHdrMetadataCache } from '../../src/lib/server/media/hdr-metadata-cache';
import v3 from '../fixtures/shared-link/v3-valid-page.json';
import type { AppleHdrMetadata } from '../../src/lib/server/media/hdr-metadata';

const ids = ['70000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000003'];
const source = new Uint8Array([0, 0, 0, 0, 102, 116, 121, 112, 104, 101, 105, 99]);
const metadata: AppleHdrMetadata = { version: '1.0', auxiliaryType: 'urn:com:apple:photo:2020:aux:hdrgainmap', makerNote33: 0.8, makerNote48: 0.4, headroom: 1.8, hdrGain: 1.25, sourceProfile: 'display-p3', sourceTransfer: 'srgb', orientation: 1 };

function event(body: unknown, fetch: typeof globalThis.fetch, ref = 'opaque-ref') {
	return { params: { kind: 'key', ref }, request: new Request(`https://pages.example/share/key/${ref}/prewarm`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), cookies: { get: vi.fn(), set: vi.fn() }, fetch };
}

describe('real HDR prewarm control-route lifecycle', () => {
	beforeEach(() => { clearHdrCache(); clearHdrMetadataCache(); vi.stubEnv('IMMICH_BASE_URL', 'https://immich.example'); });

	it('schedules authorized album work, reports terminal progress, and shares the cache with interactive media', async () => {
		const convert = vi.fn(async ({ assetId }: { assetId: string }) => ({ body: new Uint8Array([assetId.endsWith('2') ? 2 : 1]), contentType: 'video/mp4' }));
		const coordinator = new HdrPrewarmCoordinator({ convert });
		const restore = setHdrInteractiveCoordinatorForTests(coordinator);
		const share = { ...v3, type: 'ALBUM', album: { ...v3.album, id: '11111111-1111-4111-8111-111111111111' }, assets: ids.map((id, position) => ({ ...v3.assets[0], id, type: 'IMAGE', originalMimeType: 'image/heic', width: 800, height: 600, position })) };
		const fetchMock = vi.fn(async (input: URL | RequestInfo) => new Response(new URL(input.toString()).pathname.endsWith('/me') ? JSON.stringify(share) : source, { headers: { 'content-type': 'image/heic' } }));
		const extract = vi.spyOn(await import('../../src/lib/server/media/hdr-metadata'), 'extractAppleHdrMetadata').mockResolvedValue(metadata);
		try {
			const first = await POST(event({ activeAssetId: ids[0], activePosition: 0, representation: 'video' }, fetchMock) as never);
			expect(first.status).toBe(200);
			// Wait on this share's own progress (what the page polls), not the coordinator's default bucket.
			let poll!: Response;
			await vi.waitFor(async () => {
				poll = await POST(event({ activeAssetId: ids[0], activePosition: 0, representation: 'video' }, fetchMock) as never);
				expect((await poll.clone().json()).state).toBe('ready');
			});
			// targetLookahead now includes the viewer's own current position (ids[0], position 0),
			// not just what's strictly ahead of it -- see hdr-prewarm-policy.ts and
			// .planning/debug/hdr-caching-uat-20261010.md root_cause (2)/(4). All 3 assets at
			// positions 0-2 are targeted and converted, not just the 2 ahead of position 0.
			// activeAssetState (root_cause (3)) must independently confirm the SPECIFIC asset the
			// viewer has open (ids[0]) has succeeded, not just that the aggregate window is ready.
			expect(await poll.json()).toMatchObject({ state: 'ready', targeted: 3, completed: 3, failed: 0, activeAssetState: 'succeeded' });
			const media = await GET_HDR({ params: { kind: 'key', ref: 'opaque-ref', assetId: ids[1] }, request: new Request(`https://pages.example/share/key/opaque-ref/media/${ids[1]}/image/hdr?width=800&height=600`, { headers: { range: 'bytes=0-1' } }), cookies: { get: vi.fn(), set: vi.fn() }, fetch: fetchMock, locals: {} } as never);
			expect(media.status).toBe(206);
			expect(convert).toHaveBeenCalledTimes(3);
		} finally { extract.mockRestore(); restore(); }
	});

	// Real-backend UAT (2026-10-12): the background prewarm loop called extractAppleHdrMetadata()
	// directly, bypassing hdr-metadata-cache.ts entirely -- unlike the interactive media routes,
	// which already shared that cache. Every repeated /prewarm poll (fired continuously by the
	// client while scrolling, and again fresh on every page reload) re-spawned exiftool for every
	// asset in its lookahead window with zero memoization, which was the dominant cause of the
	// exiftool CPU load observed manually against a real Immich backend -- not per-call cost.
	it('reuses the metadata-cache result across repeated /prewarm polls for the same asset instead of re-extracting', async () => {
		const convert = vi.fn(async () => ({ body: new Uint8Array([1]), contentType: 'video/mp4' }));
		const coordinator = new HdrPrewarmCoordinator({ convert });
		const restore = setHdrInteractiveCoordinatorForTests(coordinator);
		const share = { ...v3, type: 'ALBUM', album: { ...v3.album, id: '22222222-2222-4222-8222-222222222222' }, assets: ids.map((id, position) => ({ ...v3.assets[0], id, type: 'IMAGE', originalMimeType: 'image/heic', width: 800, height: 600, position })) };
		const fetchMock = vi.fn(async (input: URL | RequestInfo) => new Response(new URL(input.toString()).pathname.endsWith('/me') ? JSON.stringify(share) : source, { headers: { 'content-type': 'image/heic' } }));
		const extract = vi.spyOn(await import('../../src/lib/server/media/hdr-metadata'), 'extractAppleHdrMetadata').mockResolvedValue(metadata);
		try {
			await POST(event({ activeAssetId: ids[0], activePosition: 0, representation: 'video' }, fetchMock, 'poll-ref') as never);
			// Originals are fetched by the server's queue after the response: let it finish first.
			await vi.waitFor(() => expect(coordinator.idle()).toBe(true));
			const callsAfterFirstPoll = extract.mock.calls.length;
			expect(callsAfterFirstPoll).toBeGreaterThan(0);
			await POST(event({ activeAssetId: ids[0], activePosition: 0, representation: 'video' }, fetchMock, 'poll-ref') as never);
			// A second poll for the identical targets must hit the cache, not call exiftool again.
			expect(extract.mock.calls.length).toBe(callsAfterFirstPoll);
		} finally { extract.mockRestore(); restore(); }
	});

	// hdr-caching-uat-20261010 CR-01 / 08-21-PLAN.md Task 1, Behavior Test 5: a background
	// schedule() and a later interactive submitInteractive() call for the SAME asset/
	// representation/scope, while the background conversion is still in flight, must join the
	// identical HdrAssetRegistry entry rather than starting a second native conversion. Before
	// this fix, the two call sites derived their cache identity independently and could diverge.
	it('joins the same registry entry for a background schedule() and a later interactive call on the same in-flight asset', async () => {
		let resolveConvert!: (value: { body: Uint8Array; contentType: string }) => void;
		const convert = vi.fn(() => new Promise<{ body: Uint8Array; contentType: string }>((resolve) => { resolveConvert = resolve; }));
		const coordinator = new HdrPrewarmCoordinator({ convert });
		const asset = { id: ids[0], eligible: true, position: 0, sourceIdentity: 'source-shared', sourceBytes: new Uint8Array([4, 5, 6]) };
		const scope = 'share-scope-x';

		coordinator.schedule({ assets: [asset], activePosition: -1, lookahead: { kind: 'all' }, generation: 0, scope }, 'video', 'background');
		await vi.waitFor(() => expect(convert).toHaveBeenCalledTimes(1));

		const interactive = coordinator.submitInteractive(asset, 'video', coordinator.getScopedGeneration(scope), scope);
		resolveConvert({ body: new Uint8Array([9]), contentType: 'video/mp4' });
		const result = await interactive;

		expect(result.body).toEqual(new Uint8Array([9]));
		expect(convert).toHaveBeenCalledTimes(1);
	});

	// WR-03 close (08-21-PLAN.md Task 4, Behavior Test 2): two distinct scopes (two different
	// share refs) authorized and scheduled concurrently, each with a setTimeout-delayed
	// conversion, must reach 'ready' independently -- own target/completed counts, no
	// cross-scope leakage. The integration-level (non-Playwright) equivalent of the existing
	// E2E "all lookahead drains... keeps progress scoped" test; proves CR-02's fix structurally,
	// not just via the mock-only control-plane coverage WR-03 named as insufficient on its own.
	it('keeps two concurrently-authorized scopes independent through terminal readiness', async () => {
		const idsA = ['70000000-0000-4000-8000-00000000000a', '70000000-0000-4000-8000-00000000000b'];
		const idsB = ['70000000-0000-4000-8000-00000000000c'];
		const convert = vi.fn(() => new Promise<{ body: Uint8Array; contentType: string }>((resolve) => {
			setTimeout(() => resolve({ body: new Uint8Array([1]), contentType: 'video/mp4' }), 5);
		}));
		const coordinator = new HdrPrewarmCoordinator({ convert });
		const restore = setHdrInteractiveCoordinatorForTests(coordinator);
		const shareFor = (albumId: string, ids: string[]) => ({ ...v3, type: 'ALBUM', album: { ...v3.album, id: albumId }, assets: ids.map((id, position) => ({ ...v3.assets[0], id, type: 'IMAGE', originalMimeType: 'image/heic', width: 800, height: 600, position })) });
		const fetchFor = (albumId: string, ids: string[]) => vi.fn(async (input: URL | RequestInfo) => new Response(new URL(input.toString()).pathname.endsWith('/me') ? JSON.stringify(shareFor(albumId, ids)) : source, { headers: { 'content-type': 'image/heic' } }));
		const extract = vi.spyOn(await import('../../src/lib/server/media/hdr-metadata'), 'extractAppleHdrMetadata').mockResolvedValue(metadata);
		try {
			const [responseA, responseB] = await Promise.all([
				POST(event({ activeAssetId: idsA[0], activePosition: 0, representation: 'video' }, fetchFor('11111111-1111-4111-8111-00000000000a', idsA), 'ref-scope-a') as never),
				POST(event({ activeAssetId: idsB[0], activePosition: 0, representation: 'video' }, fetchFor('11111111-1111-4111-8111-00000000000b', idsB), 'ref-scope-b') as never)
			]);
			expect(responseA.status).toBe(200);
			expect(responseB.status).toBe(200);
			const scopeA = 'share-key-ref-scope-a';
			const scopeB = 'share-key-ref-scope-b';
			await vi.waitFor(() => {
				expect(coordinator.snapshot(coordinator.getScopedGeneration(scopeA), 'video', scopeA)).toMatchObject({ state: 'ready', targeted: 2, completed: 2 });
				expect(coordinator.snapshot(coordinator.getScopedGeneration(scopeB), 'video', scopeB)).toMatchObject({ state: 'ready', targeted: 1, completed: 1 });
			});
			// No leakage in either direction: scope A's count is unaffected by scope B's work and vice versa.
			expect(coordinator.snapshot(coordinator.getScopedGeneration(scopeA), 'video', scopeA).targeted).toBe(2);
			expect(coordinator.snapshot(coordinator.getScopedGeneration(scopeB), 'video', scopeB).targeted).toBe(1);
			expect(convert).toHaveBeenCalledTimes(3);
		} finally { extract.mockRestore(); restore(); }
	});
});
