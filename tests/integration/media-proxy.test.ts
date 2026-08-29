import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../../src/routes/share/[kind]/[ref]/media/[assetId]/thumbnail/+server';
import { GET as GET_VIDEO } from '../../src/routes/share/[kind]/[ref]/media/[assetId]/video/playback/+server';
import v3 from '../fixtures/shared-link/v3-valid-page.json';

describe('same-origin thumbnail boundary', () => {
	it.each(['key', 'slug'] as const)('re-resolves the %s share, preserves it for media, and forwards only thumbnail', async (kind) => {
		vi.stubEnv('IMMICH_BASE_URL', 'https://immich.example');
		const calls: Array<{ url: string; headers: Headers }> = [];
		const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => { calls.push({ url: input.toString(), headers: new Headers(init?.headers) }); return calls.length === 1 ? new Response(JSON.stringify(v3)) : new Response('image', { headers: { 'content-type': 'image/jpeg', 'set-cookie': 'must-not-relay' } }); });
		const response = await GET({ params: { kind, ref: 'opaque_ref', assetId: '22222222-2222-4222-8222-222222222222' }, request: new Request(`https://pages.example/share/${kind}/opaque_ref`, { headers: { cookie: 'visitor=1', authorization: 'Bearer visitor' } }), fetch: fetchMock } as never);
		expect(response.status).toBe(200);
		expect(calls.map((call) => call.url)).toEqual([`https://immich.example/api/shared-links/me?${kind}=opaque_ref`, `https://immich.example/api/assets/22222222-2222-4222-8222-222222222222/thumbnail?${kind}=opaque_ref`]);
		expect(calls[1].headers.get('cookie')).toBe('visitor=1');
		expect(calls[1].headers.get('authorization')).toBe('Bearer visitor');
		expect(response.headers.get('set-cookie')).toBeNull();
		vi.unstubAllEnvs();
	});
});

describe('bounded share-bound video boundary', () => {
	beforeEach(() => vi.stubEnv('IMMICH_BASE_URL', 'https://immich.example'));
	const videoId = '22222222-2222-4222-8222-222222222223';
	const imageId = '22222222-2222-4222-8222-222222222222';
	function share() { return { ...v3, assets: [{ ...v3.assets[0], id: videoId, type: 'VIDEO', width: 640, height: 360 }, { ...v3.assets[0], id: imageId, type: 'IMAGE' }] }; }
	function request(range?: string) { return new Request('https://pages.example/share/key/opaque_ref/media/' + videoId + '/video/playback', { headers: { cookie: 'visitor=1', authorization: 'Bearer visitor', ...(range ? { range } : {}) } }); }
	function fetchFor(body: BodyInit | null, headers: HeadersInit = {}, status = 200) {
		const calls: Array<{ url: string; headers: Headers }> = [];
		const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => { calls.push({ url: input.toString(), headers: new Headers(init?.headers) }); return calls.length === 1 ? new Response(JSON.stringify(share())) : new Response(body, { status, headers }); });
		return { fetchMock, calls };
	}
	async function call(range?: string, fetchMock?: typeof fetch, kind: 'key' | 'slug' = 'key') {
		return GET_VIDEO({ params: { kind, ref: 'opaque_ref', assetId: videoId }, request: request(range), fetch: fetchMock } as never);
	}

	it.each(['key', 'slug'] as const)('preserves the %s share, forwards visitor auth and exactly one accepted range', async (kind) => {
		const fixture = fetchFor('0123456789', { 'content-type': 'video/mp4', 'content-length': '10', 'content-range': 'bytes 5-14/20', 'accept-ranges': 'bytes', 'set-cookie': 'secret=x' }, 206);
		const response = await call('bytes=5-14', fixture.fetchMock, kind);
		expect(response.status).toBe(206);
		expect(fixture.calls[1].headers.get('range')).toBe('bytes=5-14');
		expect(fixture.calls[1].headers.get('cookie')).toBe('visitor=1');
		expect(fixture.calls[1].headers.get('authorization')).toBe('Bearer visitor');
		expect(fixture.calls[1].url).toBe(`https://immich.example/api/assets/${videoId}/video/playback?${kind}=opaque_ref`);
		expect(response.headers.get('set-cookie')).toBeNull();
		expect(response.headers.get('content-range')).toBe('bytes 5-14/20');
	});

	it.each(['bytes=-5', 'bytes=1-2,4-5', 'bytes= 1-2', 'bytes=2-1'])('rejects unsafe range %s before upstream media fetch', async (range) => {
		const fixture = fetchFor('ignored');
		const response = await call(range, fixture.fetchMock);
		expect(response.status).toBe(416);
		expect(fixture.calls).toHaveLength(0);
	});

	it('rejects a non-video member and preserves no direct media bypass', async () => {
		const fixture = fetchFor('ignored');
		const response = await GET_VIDEO({ params: { kind: 'key', ref: 'opaque_ref', assetId: imageId }, request: new Request('https://pages.example/'), fetch: fixture.fetchMock } as never);
		expect(response.status).toBe(404);
		expect(fixture.calls).toHaveLength(1);
	});

	it('rejects an oversized declared response without reading it', async () => {
		const fixture = fetchFor('ignored', { 'content-length': String(16 * 1024 * 1024 + 1), 'content-type': 'video/mp4' });
		const response = await call(undefined, fixture.fetchMock);
		expect(response.status).toBe(502);
	});
});
