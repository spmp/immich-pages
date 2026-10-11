import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../../src/routes/share/[kind]/[ref]/prewarm/+server';
import { GET as GET_HDR } from '../../src/routes/share/[kind]/[ref]/media/[assetId]/image/hdr/+server';
import { HdrPrewarmCoordinator, setHdrInteractiveCoordinatorForTests } from '../../src/lib/server/media/hdr-prewarm';
import { clearHdrCache } from '../../src/lib/server/media/hdr-cache';
import v3 from '../fixtures/shared-link/v3-valid-page.json';
import type { AppleHdrMetadata } from '../../src/lib/server/media/hdr-metadata';

const ids = ['70000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000003'];
const source = new Uint8Array([0, 0, 0, 0, 102, 116, 121, 112, 104, 101, 105, 99]);
const metadata: AppleHdrMetadata = { version: '1.0', auxiliaryType: 'urn:com:apple:photo:2020:aux:hdrgainmap', makerNote33: 0.8, makerNote48: 0.4, headroom: 1.8, hdrGain: 1.25, sourceProfile: 'display-p3', sourceTransfer: 'srgb', orientation: 1 };

function event(body: unknown, fetch: typeof globalThis.fetch) {
	return { params: { kind: 'key', ref: 'opaque-ref' }, request: new Request('https://pages.example/share/key/opaque-ref/prewarm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), cookies: { get: vi.fn(), set: vi.fn() }, fetch };
}

describe('real HDR prewarm control-route lifecycle', () => {
	beforeEach(() => { clearHdrCache(); vi.stubEnv('IMMICH_BASE_URL', 'https://immich.example'); });

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
			await vi.waitFor(() => expect(coordinator.snapshot().state).toBe('ready'));
			const poll = await POST(event({ activeAssetId: ids[0], activePosition: 0, representation: 'video' }, fetchMock) as never);
			expect(await poll.json()).toMatchObject({ state: 'ready', targeted: 2, completed: 2, failed: 0 });
			const media = await GET_HDR({ params: { kind: 'key', ref: 'opaque-ref', assetId: ids[1] }, request: new Request(`https://pages.example/share/key/opaque-ref/media/${ids[1]}/image/hdr?width=800&height=600`, { headers: { range: 'bytes=0-1' } }), cookies: { get: vi.fn(), set: vi.fn() }, fetch: fetchMock, locals: {} } as never);
			expect(media.status).toBe(206);
			expect(convert).toHaveBeenCalledTimes(2);
		} finally { extract.mockRestore(); restore(); }
	});
});
