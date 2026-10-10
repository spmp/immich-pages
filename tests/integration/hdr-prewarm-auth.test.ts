import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../../src/routes/share/[kind]/[ref]/prewarm/+server';
import { getHdrInteractiveCoordinator } from '../../src/lib/server/media/hdr-prewarm';
import { clearHdrCache } from '../../src/lib/server/media/hdr-cache';
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
		expect(await response.json()).toEqual(expect.objectContaining({ representation: 'video', targeted: 1 }));
		expect(schedule).toHaveBeenCalledWith(expect.objectContaining({ assets: [expect.objectContaining({ id: targetAssetId, sourceBytes: expect.any(Uint8Array) })] }), 'video', 'background');
		expect(fetchMock).toHaveBeenCalledWith(expect.any(URL), expect.anything());
		expect(extract).toHaveBeenCalledWith(source);
		schedule.mockRestore();
		extract.mockRestore();
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
