import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GET } from '../../src/routes/share/[kind]/[ref]/media/[assetId]/thumbnail/+server';
import { GET as GET_VIDEO } from '../../src/routes/share/[kind]/[ref]/media/[assetId]/video/playback/+server';
import { GET as GET_FULLSIZE } from '../../src/routes/share/[kind]/[ref]/media/[assetId]/image/fullsize/+server';
import { clearSdrCache } from '../../src/lib/server/media/sdr-cache';
import v3 from '../fixtures/shared-link/v3-valid-page.json';

const fakeHeifConvert = fileURLToPath(new URL('../unit/fixtures/fake-heif-convert.mjs', import.meta.url));
function heicBytes() {
	// Minimal real ftyp-brand HEIC sniff target: inferSafeImageMime only inspects bytes 4-12.
	return new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0]);
}

describe('same-origin thumbnail boundary', () => {
	it.each(['key', 'slug'] as const)('re-resolves the %s share, preserves it for media, and forwards only thumbnail', async (kind) => {
		vi.stubEnv('IMMICH_BASE_URL', 'https://immich.example');
		const cookies = { get: vi.fn(() => undefined), set: vi.fn() };
		const calls: Array<{ url: string; headers: Headers }> = [];
		const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => { calls.push({ url: input.toString(), headers: new Headers(init?.headers) }); return calls.length === 1 ? new Response(JSON.stringify(v3)) : new Response('image', { headers: { 'content-type': 'image/jpeg', 'set-cookie': 'must-not-relay' } }); });
		const response = await GET({ params: { kind, ref: 'opaque_ref', assetId: '22222222-2222-4222-8222-222222222222' }, request: new Request(`https://pages.example/share/${kind}/opaque_ref`, { headers: { cookie: 'immich_shared_link_token=visitor', authorization: 'Bearer visitor' } }), cookies, fetch: fetchMock } as never);
		expect(response.status).toBe(200);
		expect(calls.map((call) => call.url)).toEqual([`https://immich.example/api/shared-links/me?${kind}=opaque_ref`, `https://immich.example/api/assets/22222222-2222-4222-8222-222222222222/thumbnail?${kind}=opaque_ref`]);
		expect(calls[1].headers.get('cookie')).toBe('immich_shared_link_token=visitor');
		expect(calls[1].headers.get('authorization')).toBe('Bearer visitor');
		expect(response.headers.get('set-cookie')).toBeNull();
		vi.unstubAllEnvs();
	});
});

describe('same-origin full-size image boundary', () => {
	beforeEach(() => { vi.stubEnv('IMMICH_BASE_URL', 'https://immich.example'); clearSdrCache(); });
	const imageId = '22222222-2222-4222-8222-222222222222';
	const request = (kind: 'key' | 'slug' = 'key') => new Request(`https://pages.example/share/${kind}/opaque_ref/media/${imageId}/image/fullsize`, { headers: { cookie: 'immich_shared_link_token=visitor' } });
	const invoke = async (fetchMock: typeof fetch, kind: 'key' | 'slug' = 'key', assetId = imageId) => GET_FULLSIZE({ params: { kind, ref: 'opaque_ref', assetId }, request: request(kind), cookies: { get: vi.fn(() => undefined), set: vi.fn() }, fetch: fetchMock } as never);

	it.each(['key', 'slug'] as const)('uses the %s share and authorized original endpoint', async (kind) => {
		const calls: string[] = [];
		const fetchMock = vi.fn(async (input: URL | RequestInfo) => { calls.push(input.toString()); return calls.length === 1 ? new Response(JSON.stringify(v3)) : new Response('jpeg', { headers: { 'content-type': 'image/jpeg', 'set-cookie': 'secret' } }); });
		const response = await invoke(fetchMock, kind);
		expect(response.status).toBe(200);
		expect(calls[1]).toBe(`https://immich.example/api/assets/${imageId}/original?${kind}=opaque_ref`);
		expect(response.headers.get('content-type')).toBe('image/jpeg');
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(response.headers.get('set-cookie')).toBeNull();
	});

	it('retrieves a camera original larger than the generated-thumbnail limit', async () => {
		const original = new Uint8Array(10 * 1024 * 1024 + 1);
		original.set([0xff, 0xd8, 0xff]);
		const calls: string[] = [];
		const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
			calls.push(input.toString());
			return calls.length === 1
				? new Response(JSON.stringify(v3))
				: new Response(original, { headers: { 'content-type': 'image/jpeg' } });
		});

		const response = await invoke(fetchMock);

		expect(response.status).toBe(200);
		expect(calls[1]).toBe(`https://immich.example/api/assets/${imageId}/original?key=opaque_ref`);
		expect((await response.arrayBuffer()).byteLength).toBe(original.byteLength);
	});

	it('rejects non-images and untrusted content types', async () => {
		const videoShare = { ...v3, assets: [{ ...v3.assets[0], id: imageId, type: 'VIDEO' }] };
		const nonImage = await invoke(vi.fn(async () => new Response(JSON.stringify(videoShare))), 'key');
		expect(nonImage.status).toBe(404);
		const html = await invoke(vi.fn(async (input: URL | RequestInfo) => new Response(new URL(input.toString()).pathname.endsWith('/me') ? JSON.stringify(v3) : '<script>', { headers: { 'content-type': 'text/html' } })));
		expect(html.status).toBe(502);
	});

	it('accepts generated image bytes declared as octet-stream', async () => {
		const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
		const response = await invoke(vi.fn(async (input: URL | RequestInfo) => new Response(new URL(input.toString()).pathname.endsWith('/me') ? JSON.stringify(v3) : png, { headers: { 'content-type': 'application/octet-stream' } })));
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('image/png');
	});

	it('rejects unknown bytes even when the upstream declares octet-stream', async () => {
		const response = await invoke(vi.fn(async (input: URL | RequestInfo) => new Response(new URL(input.toString()).pathname.endsWith('/me') ? JSON.stringify(v3) : 'not an image', { headers: { 'content-type': 'application/octet-stream' } })));
		expect(response.status).toBe(502);
	});

	it('bounds oversized original responses', async () => {
		const response = await invoke(vi.fn(async (input: URL | RequestInfo) => new Response(new URL(input.toString()).pathname.endsWith('/me') ? JSON.stringify(v3) : 'x', { headers: { 'content-type': 'image/jpeg', 'content-length': String(100 * 1024 * 1024 + 1) } })));
		expect(response.status).toBe(502);
	});

	it('converts a HEIC original into a browser-displayable JPEG instead of forwarding undecodable bytes', async () => {
		vi.stubEnv('SDR_HEIC_CONVERTER_PATH', fakeHeifConvert);
		const response = await invoke(vi.fn(async (input: URL | RequestInfo) => new Response(new URL(input.toString()).pathname.endsWith('/me') ? JSON.stringify(v3) : heicBytes(), { headers: { 'content-type': 'image/heic' } })));
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('image/jpeg');
		const body = new Uint8Array(await response.arrayBuffer());
		expect(Buffer.from(body.subarray(0, 4))).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
		vi.unstubAllEnvs();
	});

	it('reuses a cached conversion instead of re-invoking the converter for a repeat request', async () => {
		vi.stubEnv('SDR_HEIC_CONVERTER_PATH', fakeHeifConvert);
		const originalResponse = () => new Response(heicBytes(), { headers: { 'content-type': 'image/heic', etag: 'fixed-etag' } });
		const fetchFor = () => vi.fn(async (input: URL | RequestInfo) => new URL(input.toString()).pathname.endsWith('/me') ? new Response(JSON.stringify(v3)) : originalResponse());

		const first = await invoke(fetchFor());
		expect(first.status).toBe(200);

		// If the second identical request re-invoked the converter, it would hit this forced
		// failure; getting a 200 instead proves the first request's result was actually reused.
		vi.stubEnv('FAKE_HEIF_CONVERT_BEHAVIOR', 'fail');
		const second = await invoke(fetchFor());
		expect(second.status).toBe(200);
		vi.unstubAllEnvs();
	});

	it('degrades to a conversion-failure response (letting the client fall back to its thumbnail) when the converter fails', async () => {
		vi.stubEnv('SDR_HEIC_CONVERTER_PATH', fakeHeifConvert);
		vi.stubEnv('FAKE_HEIF_CONVERT_BEHAVIOR', 'fail');
		const response = await invoke(vi.fn(async (input: URL | RequestInfo) => new Response(new URL(input.toString()).pathname.endsWith('/me') ? JSON.stringify(v3) : heicBytes(), { headers: { 'content-type': 'image/heic' } })));
		expect(response.status).toBe(502);
		vi.unstubAllEnvs();
	});
});

describe('bounded share-bound video boundary', () => {
	beforeEach(() => vi.stubEnv('IMMICH_BASE_URL', 'https://immich.example'));
	const videoId = '22222222-2222-4222-8222-222222222223';
	const imageId = '22222222-2222-4222-8222-222222222222';
	const fixture = readFileSync(new URL('../fixtures/video/chromium-2s-320x180-h264-aac.mp4', import.meta.url));
	function share() { return { ...v3, assets: [{ ...v3.assets[0], id: videoId, type: 'VIDEO', width: 640, height: 360 }, { ...v3.assets[0], id: imageId, type: 'IMAGE' }] }; }
	function request(range?: string) { return new Request('https://pages.example/share/key/opaque_ref/media/' + videoId + '/video/playback', { headers: { cookie: 'immich_shared_link_token=visitor', authorization: 'Bearer visitor', ...(range ? { range } : {}) } }); }
	function fetchFor(body: BodyInit | null, headers: HeadersInit = {}, status = 200) {
		const calls: Array<{ url: string; headers: Headers }> = [];
		const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => { calls.push({ url: input.toString(), headers: new Headers(init?.headers) }); return calls.length === 1 ? new Response(JSON.stringify(share())) : new Response(body, { status, headers }); });
		return { fetchMock, calls };
	}
	async function call(range?: string, fetchMock?: typeof fetch, kind: 'key' | 'slug' = 'key') {
		return GET_VIDEO({ params: { kind, ref: 'opaque_ref', assetId: videoId }, request: request(range), cookies: { get: vi.fn(() => undefined), set: vi.fn() }, fetch: fetchMock } as never);
	}

	it.each(['key', 'slug'] as const)('preserves the %s share, forwards visitor auth and exactly one accepted range', async (kind) => {
		const fixture = fetchFor('0123456789', { 'content-type': 'video/mp4', 'content-length': '10', 'content-range': 'bytes 5-14/20', 'accept-ranges': 'bytes', 'set-cookie': 'secret=x' }, 206);
		const response = await call('bytes=5-14', fixture.fetchMock, kind);
		expect(response.status).toBe(206);
		expect(fixture.calls[1].headers.get('range')).toBe('bytes=5-14');
		expect(fixture.calls[1].headers.get('cookie')).toBe('immich_shared_link_token=visitor');
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
		const response = await GET_VIDEO({ params: { kind: 'key', ref: 'opaque_ref', assetId: imageId }, request: new Request('https://pages.example/'), cookies: { get: vi.fn(() => undefined), set: vi.fn() }, fetch: fixture.fetchMock } as never);
		expect(response.status).toBe(404);
		expect(fixture.calls).toHaveLength(1);
	});

	it('rejects an oversized declared response without reading it', async () => {
		const fixture = fetchFor('ignored', { 'content-length': String(64 * 1024 * 1024 + 1), 'content-type': 'video/mp4' });
		const response = await call(undefined, fixture.fetchMock);
		expect(response.status).toBe(502);
	});

	it('returns the complete decodable fixture with truthful large-response metadata', async () => {
		expect(fixture.byteLength).toBeGreaterThan(8 * 1024 * 1024);
		expect(fixture.byteLength).toBeLessThan(64 * 1024 * 1024);
		const upstream = fetchFor(fixture, { 'content-type': 'video/mp4', 'content-length': String(fixture.byteLength), 'accept-ranges': 'bytes', 'set-cookie': 'secret=x' });
		const response = await call(undefined, upstream.fetchMock);
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('video/mp4');
		expect(response.headers.get('content-length')).toBe(String(fixture.byteLength));
		expect(response.headers.get('accept-ranges')).toBe('bytes');
		expect(response.headers.get('set-cookie')).toBeNull();
		expect(Buffer.compare(Buffer.from(await response.arrayBuffer()), fixture)).toBe(0);
	});

	it.each([
		['bytes=0-2047', 0, 2047],
		['bytes=1048576-1050623', 1048576, 1050623],
		['bytes=8388608-', 8388608, fixture.byteLength - 1]
	] as const)('returns exact bytes and metadata for %s', async (range, start, expectedEnd) => {
		const end = Math.min(expectedEnd, fixture.byteLength - 1);
		const body = fixture.subarray(start, end + 1);
		const upstream = fetchFor(body, { 'content-type': 'video/mp4', 'content-length': String(body.byteLength), 'content-range': `bytes ${start}-${end}/${fixture.byteLength}`, 'accept-ranges': 'bytes' }, 206);
		const response = await call(range, upstream.fetchMock);
		expect(response.status).toBe(206);
		expect(response.headers.get('content-length')).toBe(String(body.byteLength));
		expect(response.headers.get('content-range')).toBe(`bytes ${start}-${end}/${fixture.byteLength}`);
		expect(Buffer.compare(Buffer.from(await response.arrayBuffer()), body)).toBe(0);
	});
});
