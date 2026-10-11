import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../../src/routes/share/[kind]/[ref]/prewarm/+server';
import { getHdrInteractiveCoordinator } from '../../src/lib/server/media/hdr-prewarm';
import { clearHdrCache } from '../../src/lib/server/media/hdr-cache';
import { selectTargetResolution } from '../../src/lib/media/resolution';
import v3 from '../fixtures/shared-link/v3-valid-page.json';

const activeAssetId = v3.assets[0].id;
const targetAssetId = '55555555-5555-4555-8555-555555555555';

function cookies() {
	return { get: vi.fn(), set: vi.fn() };
}

function event(body: unknown, fetch: typeof globalThis.fetch) {
	return {
		params: { kind: 'key', ref: 'opaque-ref' },
		request: new Request('https://pages.example/share/key/opaque-ref/prewarm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
		cookies: cookies(),
		fetch
	};
}

describe('authorized HDR prewarm control plane', () => {
	beforeEach(() => {
		vi.stubEnv('IMMICH_BASE_URL', 'https://immich.example');
		clearHdrCache();
	});

	it('reauthorizes and schedules only an eligible server-owned album target', async () => {
		const share = {
			...v3,
			assets: [
				{ ...v3.assets[0], originalMimeType: 'image/jpeg' },
				{ id: targetAssetId, type: 'IMAGE', originalMimeType: 'image/heic', width: 800, height: 600 }
			]
		};
		const source = new Uint8Array([0, 0, 0, 0, 102, 116, 121, 112, 104, 101, 105, 99]);
		const fetchMock = vi.fn(async (input: URL | RequestInfo) => new Response(new URL(input.toString()).pathname.endsWith('/me') ? JSON.stringify(share) : source, { headers: { 'content-type': 'image/heic' } }));
		const metadata = await import('../../src/lib/server/media/hdr-metadata');
		const extract = vi.spyOn(metadata, 'extractAppleHdrMetadata').mockResolvedValue({ version: '1.0', auxiliaryType: 'urn:com:apple:photo:2020:aux:hdrgainmap', makerNote33: 0.8, makerNote48: 0.4, headroom: 1.8, hdrGain: 1.25, sourceProfile: 'display-p3', sourceTransfer: 'srgb', orientation: 1 });
		const coordinator = getHdrInteractiveCoordinator();
		const schedule = vi.spyOn(coordinator, 'schedule').mockReturnValue({ generation: coordinator.getGeneration(), representation: 'video', state: 'preparing', targeted: 1, queued: 1, running: 0, completed: 0, failed: 0, skipped: 0 });

		const response = await POST(event({ activeAssetId, activePosition: 0, representation: 'video' }, fetchMock) as never);
		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		// activeAssetId here is position 0, the jpeg -- not an HDR candidate at all. Per-asset
		// readiness (hdr-caching-uat-20261010 root_cause (3)) must report that directly rather than
		// leaving the viewer's own dot keyed to the unrelated eligible target's progress.
		expect(await response.json()).toEqual(expect.objectContaining({ representation: 'video', targeted: 1, activeAssetState: 'ineligible' }));
		expect(schedule).toHaveBeenCalledWith(expect.objectContaining({ assets: [expect.objectContaining({ id: targetAssetId, sourceBytes: expect.any(Uint8Array) })] }), 'video', 'background');
		expect(fetchMock).toHaveBeenCalledWith(expect.any(URL), expect.anything());
		expect(extract).toHaveBeenCalledWith(source);
		schedule.mockRestore();
		extract.mockRestore();
	});

	// hdr-caching-uat-20261010 finding 5 (latent, confirmed correctness-affecting above 32MP/8192px):
	// this route previously keyed the prewarm cache entry on the RAW Immich asset width/height,
	// while the interactive route keys on selectTargetResolution's bounded/scaled target. They only
	// coincided because scale happened to compute to exactly 1 for assets under that threshold. The
	// prewarm path must bound its own width/height the SAME way before scheduling, so the two sides
	// compute an identical cache key for any source, not just small ones.
	it('bounds an oversized asset to the SAME scaled target the interactive route will compute, not raw Immich dimensions', async () => {
		const oversizedWidth = 10_000;
		const oversizedHeight = 10_000;
		const expectedTarget = selectTargetResolution(oversizedWidth, oversizedHeight);
		expect(expectedTarget?.bounded).toBe(true);
		const share = {
			...v3,
			assets: [{ id: targetAssetId, type: 'IMAGE', originalMimeType: 'image/heic', width: oversizedWidth, height: oversizedHeight }]
		};
		const source = new Uint8Array([0, 0, 0, 0, 102, 116, 121, 112, 104, 101, 105, 99]);
		const fetchMock = vi.fn(async (input: URL | RequestInfo) => new Response(new URL(input.toString()).pathname.endsWith('/me') ? JSON.stringify(share) : source, { headers: { 'content-type': 'image/heic' } }));
		const metadata = await import('../../src/lib/server/media/hdr-metadata');
		const extract = vi.spyOn(metadata, 'extractAppleHdrMetadata').mockResolvedValue({ version: '1.0', auxiliaryType: 'urn:com:apple:photo:2020:aux:hdrgainmap', makerNote33: 0.8, makerNote48: 0.4, headroom: 1.8, hdrGain: 1.25, sourceProfile: 'display-p3', sourceTransfer: 'srgb', orientation: 1 });
		const coordinator = getHdrInteractiveCoordinator();
		const schedule = vi.spyOn(coordinator, 'schedule').mockReturnValue({ generation: coordinator.getGeneration(), representation: 'video', state: 'preparing', targeted: 1, queued: 1, running: 0, completed: 0, failed: 0, skipped: 0 });

		const response = await POST(event({ activeAssetId: targetAssetId, activePosition: 0, representation: 'video' }, fetchMock) as never);
		expect(response.status).toBe(200);
		expect(schedule).toHaveBeenCalledWith(expect.objectContaining({ assets: [expect.objectContaining({ id: targetAssetId, width: expectedTarget?.width, height: expectedTarget?.height })] }), 'video', 'background');
		schedule.mockRestore();
		extract.mockRestore();
	});

	it('reports the active asset as unavailable when it is eligible but its own fetch fails, distinct from ineligible', async () => {
		const share = { ...v3, assets: [{ id: targetAssetId, type: 'IMAGE', originalMimeType: 'image/heic', width: 800, height: 600 }] };
		const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
			const url = new URL(input.toString());
			if (url.pathname.endsWith('/me')) return new Response(JSON.stringify(share));
			// The album lookup succeeds but this specific asset's own original-image fetch fails.
			return new Response(null, { status: 500 });
		});
		const response = await POST(event({ activeAssetId: targetAssetId, activePosition: 0, representation: 'video' }, fetchMock) as never);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual(expect.objectContaining({ targeted: 0, activeAssetState: 'unavailable' }));
	});

	// hdr-caching-uat-20261010 finding 6b: the user explicitly asked for more server-side logging
	// to debug this class of issue -- every /prewarm POST, successful or not, must now be logged.
	it('logs the outcome of a successful /prewarm POST, including which assets were targeted and the active asset\'s own status', async () => {
		const diagnostics = await import('../../src/lib/server/share/diagnostics');
		const log = vi.spyOn(diagnostics, 'logHdrPrewarmRequest');
		const share = { ...v3, assets: [{ id: targetAssetId, type: 'IMAGE', originalMimeType: 'image/heic', width: 800, height: 600 }] };
		const source = new Uint8Array([0, 0, 0, 0, 102, 116, 121, 112, 104, 101, 105, 99]);
		const fetchMock = vi.fn(async (input: URL | RequestInfo) => new Response(new URL(input.toString()).pathname.endsWith('/me') ? JSON.stringify(share) : source, { headers: { 'content-type': 'image/heic' } }));
		const metadata = await import('../../src/lib/server/media/hdr-metadata');
		const extract = vi.spyOn(metadata, 'extractAppleHdrMetadata').mockResolvedValue({ version: '1.0', auxiliaryType: 'urn:com:apple:photo:2020:aux:hdrgainmap', makerNote33: 0.8, makerNote48: 0.4, headroom: 1.8, hdrGain: 1.25, sourceProfile: 'display-p3', sourceTransfer: 'srgb', orientation: 1 });

		const response = await POST(event({ activeAssetId: targetAssetId, activePosition: 0, representation: 'video' }, fetchMock) as never);
		expect(response.status).toBe(200);
		expect(log).toHaveBeenCalledWith(expect.objectContaining({ status: 200, activePosition: 0, activeAssetId: targetAssetId, targetedAssetIds: [targetAssetId] }));
		log.mockRestore();
		extract.mockRestore();
	});

	it('logs rejected /prewarm POSTs too, not only successful ones', async () => {
		const diagnostics = await import('../../src/lib/server/share/diagnostics');
		const log = vi.spyOn(diagnostics, 'logHdrPrewarmRequest');
		const unauthorizedFetch = vi.fn(async () => new Response(null, { status: 401 }));
		const response = await POST(event({ activeAssetId, activePosition: 0, representation: 'video' }, unauthorizedFetch) as never);
		expect(response.status).toBe(403);
		expect(log).toHaveBeenCalledWith(expect.objectContaining({ status: 403, activeAssetId }));
		log.mockRestore();
	});

	it('rejects unauthorized shares, arbitrary IDs, and client asset lists before scheduling', async () => {
		const schedule = vi.spyOn(getHdrInteractiveCoordinator(), 'schedule');
		const unauthorizedFetch = vi.fn(async () => new Response(null, { status: 401 }));
		const unauthorized = await POST(event({ activeAssetId, activePosition: 0, representation: 'video' }, unauthorizedFetch) as never);
		expect(unauthorized.status).toBe(403);
		expect(schedule).not.toHaveBeenCalled();

		const shareFetch = vi.fn(async (input: URL | RequestInfo) => new Response(new URL(input.toString()).pathname.endsWith('/me') ? JSON.stringify(v3) : new Uint8Array([1])));
		const arbitrary = await POST(event({ activeAssetId: '66666666-6666-4666-8666-666666666666', activePosition: 0, representation: 'video', assetIds: [targetAssetId] }, shareFetch) as never);
		expect(arbitrary.status).toBe(400);
		expect(schedule).not.toHaveBeenCalled();
		schedule.mockRestore();
	});

	it('bounds malformed and oversized control bodies without touching the provider', async () => {
		const fetchMock = vi.fn();
		const malformed = await POST(event({ activeAssetId, activePosition: -1, representation: 'video' }, fetchMock) as never);
		expect(malformed.status).toBe(400);
		expect(fetchMock).not.toHaveBeenCalled();
		const oversized = new Request('https://pages.example/share/key/opaque-ref/prewarm', { method: 'POST', headers: { 'content-length': '20000' }, body: '{}'.padEnd(20_000, 'x') });
		const response = await POST({ ...event({}, fetchMock), request: oversized } as never);
		expect(response.status).toBe(413);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
