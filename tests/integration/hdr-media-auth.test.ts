import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../../src/routes/share/[kind]/[ref]/media/[assetId]/image/hdr/+server';
import { clearHdrCache } from '../../src/lib/server/media/hdr-cache';
import { clearHdrMetadataCache } from '../../src/lib/server/media/hdr-metadata-cache';
import v3 from '../fixtures/shared-link/v3-valid-page.json';

const assetId = v3.assets[0].id;
const params = { kind: 'key', ref: 'opaque-ref', assetId };

describe('share HDR media boundary', () => {
	beforeEach(() => { vi.stubEnv('IMMICH_BASE_URL', 'https://immich.example'); clearHdrCache(); clearHdrMetadataCache(); });

	it('checks share membership before attempting conversion', async () => {
		const calls: string[] = [];
		const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
			calls.push(new URL(input.toString()).pathname);
			return new Response(JSON.stringify({ ...v3, assets: [], album: undefined }));
		});
		const response = await GET({ params, request: new Request('https://pages.example/share/key/opaque-ref'), cookies: { get: vi.fn(), set: vi.fn() }, fetch: fetchMock } as never);
		expect(response.status).toBe(404);
		expect(calls).toEqual(['/api/shared-links/me']);
	});

	it('returns the compositor result as a private MP4 HDR candidate', async () => {
		const source = new Uint8Array([0, 0, 0, 0, 102, 116, 121, 112, 104, 101, 105, 99]);
		const fetchMock = vi.fn(async (input: URL | RequestInfo) => new Response(new URL(input.toString()).pathname.endsWith('/me') ? JSON.stringify(v3) : source, { headers: { 'content-type': 'image/heic' } }));
		const compositor = await import('../../src/lib/server/media/hdr-compositor');
		const metadata = await import('../../src/lib/server/media/hdr-metadata');
		const compose = vi.spyOn(compositor, 'composeHdr').mockResolvedValue(new Uint8Array([1, 2]));
		const encode = vi.spyOn(compositor, 'encodeHdrMp4').mockResolvedValue(new Uint8Array([3, 4]));
		const extract = vi.spyOn(metadata, 'extractAppleHdrMetadata').mockResolvedValue({ version: '1.0', auxiliaryType: 'urn:com:apple:photo:2020:aux:hdrgainmap', makerNote33: 0.8, makerNote48: 0.4, headroom: 1.8, hdrGain: 1.25, sourceProfile: 'display-p3', sourceTransfer: 'srgb', orientation: 1 });
		const response = await GET({ params, request: new Request('https://pages.example/share/key/opaque-ref'), cookies: { get: vi.fn(), set: vi.fn() }, fetch: fetchMock } as never);
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('video/mp4');
		// Decided tradeoff (see .planning/debug/hdr-lightbox-state-regression.md): successful
		// media may be cached by the browser itself -- never a shared/proxy cache -- for as long
		// as the server's own result cache promises identical bytes.
		expect(response.headers.get('cache-control')).toBe('private, max-age=600');
		expect(compose).toHaveBeenCalledWith(source, expect.objectContaining({ makerNote33: 0.8, makerNote48: 0.4 }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
		expect(encode).toHaveBeenCalledWith(new Uint8Array([1, 2]), expect.objectContaining({ signal: expect.any(AbortSignal) }));
		compose.mockRestore();
		encode.mockRestore();
		extract.mockRestore();
	});

	it('honors Range requests -- Safari/WebKit refuses to play a <video src> that only ever answers 200 to a probe', async () => {
		const source = new Uint8Array([0, 0, 0, 0, 102, 116, 121, 112, 104, 101, 105, 99]);
		const encoded = new Uint8Array([10, 11, 12, 13, 14, 15, 16, 17]);
		const fetchMock = vi.fn(async (input: URL | RequestInfo) => new Response(new URL(input.toString()).pathname.endsWith('/me') ? JSON.stringify(v3) : source, { headers: { 'content-type': 'image/heic' } }));
		const compositor = await import('../../src/lib/server/media/hdr-compositor');
		const metadata = await import('../../src/lib/server/media/hdr-metadata');
		const compose = vi.spyOn(compositor, 'composeHdr').mockResolvedValue(new Uint8Array([1, 2]));
		const encode = vi.spyOn(compositor, 'encodeHdrMp4').mockResolvedValue(encoded);
		const extract = vi.spyOn(metadata, 'extractAppleHdrMetadata').mockResolvedValue({ version: '1.0', auxiliaryType: 'urn:com:apple:photo:2020:aux:hdrgainmap', makerNote33: 0.8, makerNote48: 0.4, headroom: 1.8, hdrGain: 1.25, sourceProfile: 'display-p3', sourceTransfer: 'srgb', orientation: 1 });

		const full = await GET({ params, request: new Request('https://pages.example/share/key/opaque-ref'), cookies: { get: vi.fn(), set: vi.fn() }, fetch: fetchMock } as never);
		expect(full.headers.get('accept-ranges')).toBe('bytes');

		const partial = await GET({ params, request: new Request('https://pages.example/share/key/opaque-ref', { headers: { range: 'bytes=2-4' } }), cookies: { get: vi.fn(), set: vi.fn() }, fetch: fetchMock } as never);
		expect(partial.status).toBe(206);
		expect(partial.headers.get('content-range')).toBe('bytes 2-4/8');
		expect(partial.headers.get('content-length')).toBe('3');
		expect(new Uint8Array(await partial.arrayBuffer())).toEqual(new Uint8Array([12, 13, 14]));

		const openEnded = await GET({ params, request: new Request('https://pages.example/share/key/opaque-ref', { headers: { range: 'bytes=5-' } }), cookies: { get: vi.fn(), set: vi.fn() }, fetch: fetchMock } as never);
		expect(openEnded.status).toBe(206);
		expect(openEnded.headers.get('content-range')).toBe('bytes 5-7/8');
		expect(new Uint8Array(await openEnded.arrayBuffer())).toEqual(new Uint8Array([15, 16, 17]));

		const unsatisfiable = await GET({ params, request: new Request('https://pages.example/share/key/opaque-ref', { headers: { range: 'bytes=100-200' } }), cookies: { get: vi.fn(), set: vi.fn() }, fetch: fetchMock } as never);
		expect(unsatisfiable.status).toBe(416);
		expect(unsatisfiable.headers.get('content-range')).toBe('bytes */8');

		compose.mockRestore();
		encode.mockRestore();
		extract.mockRestore();
	});

	it('skips re-reading the original body once the HDR output is already cached (header identity + cached metadata is enough to prove the cache hit)', async () => {
		const source = new Uint8Array([0, 0, 0, 0, 102, 116, 121, 112, 104, 101, 105, 99]);
		const fetchMock = vi.fn(async (input: URL | RequestInfo) => new Response(new URL(input.toString()).pathname.endsWith('/me') ? JSON.stringify(v3) : source, { headers: { 'content-type': 'image/heic', etag: 'fixed-etag' } }));
		const compositor = await import('../../src/lib/server/media/hdr-compositor');
		const metadata = await import('../../src/lib/server/media/hdr-metadata');
		const client = await import('../../src/lib/server/immich/client');
		const compose = vi.spyOn(compositor, 'composeHdr').mockResolvedValue(new Uint8Array([1, 2]));
		const encode = vi.spyOn(compositor, 'encodeHdrMp4').mockResolvedValue(new Uint8Array([3, 4]));
		const extract = vi.spyOn(metadata, 'extractAppleHdrMetadata').mockResolvedValue({ version: '1.0', auxiliaryType: 'urn:com:apple:photo:2020:aux:hdrgainmap', makerNote33: 0.8, makerNote48: 0.4, headroom: 1.8, hdrGain: 1.25, sourceProfile: 'display-p3', sourceTransfer: 'srgb', orientation: 1 });
		const readSpy = vi.spyOn(client, 'readBoundedBytes');
		const request = { request: new Request('https://pages.example/share/key/opaque-ref'), cookies: { get: vi.fn(), set: vi.fn() }, fetch: fetchMock };

		const first = await GET({ ...request, params } as never);
		expect(first.status).toBe(200);
		// The shared-link JSON body is parsed through provider.ts's own internal readBoundedText,
		// a same-module call this cross-module spy can't see -- so the one call it does observe
		// here is exactly the original HEIC body read in this route's own code.
		expect(readSpy).toHaveBeenCalledTimes(1);

		const second = await GET({ ...request, params } as never);
		expect(second.status).toBe(200);
		expect(new Uint8Array(await second.arrayBuffer())).toEqual(new Uint8Array([3, 4]));
		// No additional call: the cache hit above was proven (and reached) using only header
		// identity + already-cached metadata, without ever reading the original body again.
		expect(readSpy).toHaveBeenCalledTimes(1);
		expect(compose).toHaveBeenCalledTimes(1);
		compose.mockRestore();
		encode.mockRestore();
		extract.mockRestore();
		readSpy.mockRestore();
	});

	it('keeps SDR fallback when Apple metadata is absent', async () => {
		const source = new Uint8Array([0, 0, 0, 0, 102, 116, 121, 112, 104, 101, 105, 99]);
		const fetchMock = vi.fn(async (input: URL | RequestInfo) => new Response(new URL(input.toString()).pathname.endsWith('/me') ? JSON.stringify(v3) : source, { headers: { 'content-type': 'image/heic' } }));
		const metadata = await import('../../src/lib/server/media/hdr-metadata');
		const extract = vi.spyOn(metadata, 'extractAppleHdrMetadata').mockResolvedValue(undefined);
		const response = await GET({ params, request: new Request('https://pages.example/share/key/opaque-ref'), cookies: { get: vi.fn(), set: vi.fn() }, fetch: fetchMock } as never);
		expect(response.status).toBe(404);
		expect(extract).toHaveBeenCalledWith(source);
		extract.mockRestore();
	});

	it('caches the no-HDR-metadata result so a repeat request never re-invokes extraction', async () => {
		// This is the real-world hot path: a viewer opens each photo in the lightbox and the client
		// probes /image/hdr for every HEIC asset, but the large majority of real photos are not
		// Apple HDR captures. Without this cache, every single one of those requests re-downloaded
		// the full original and spawned exiftool, on every click, forever.
		const source = new Uint8Array([0, 0, 0, 0, 102, 116, 121, 112, 104, 101, 105, 99]);
		const fetchMock = vi.fn(async (input: URL | RequestInfo) => new Response(new URL(input.toString()).pathname.endsWith('/me') ? JSON.stringify(v3) : source, { headers: { 'content-type': 'image/heic' } }));
		const metadata = await import('../../src/lib/server/media/hdr-metadata');
		const extract = vi.spyOn(metadata, 'extractAppleHdrMetadata').mockResolvedValue(undefined);
		const first = await GET({ params, request: new Request('https://pages.example/share/key/opaque-ref'), cookies: { get: vi.fn(), set: vi.fn() }, fetch: fetchMock } as never);
		const second = await GET({ params, request: new Request('https://pages.example/share/key/opaque-ref'), cookies: { get: vi.fn(), set: vi.fn() }, fetch: fetchMock } as never);
		expect(first.status).toBe(404);
		expect(second.status).toBe(404);
		expect(extract).toHaveBeenCalledTimes(1);
		extract.mockRestore();
	});

	it('returns a private unavailable fallback for non-HEIF input', async () => {
		const fetchMock = vi.fn(async (input: URL | RequestInfo) => new Response(new URL(input.toString()).pathname.endsWith('/me') ? JSON.stringify(v3) : new Uint8Array([255, 216, 255]), { headers: { 'content-type': 'image/jpeg' } }));
		const response = await GET({ params, request: new Request('https://pages.example/share/key/opaque-ref'), cookies: { get: vi.fn(), set: vi.fn() }, fetch: fetchMock } as never);
		expect(response.status).toBe(404);
		expect(response.headers.get('cache-control')).toBe('private, no-store');
	});

	it('authorizes a repeat request before it can reuse a cached representation', async () => {
		const source = new Uint8Array([0, 0, 0, 0, 102, 116, 121, 112, 104, 101, 105, 99]);
		let shareCalls = 0;
		const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
			if (new URL(input.toString()).pathname.endsWith('/me')) {
				shareCalls += 1;
				return shareCalls === 1 ? new Response(JSON.stringify(v3)) : new Response(null, { status: 401 });
			}
			return new Response(source, { headers: { 'content-type': 'image/heic' } });
		});
		const compositor = await import('../../src/lib/server/media/hdr-compositor');
		const metadata = await import('../../src/lib/server/media/hdr-metadata');
		const compose = vi.spyOn(compositor, 'composeHdr').mockResolvedValue(new Uint8Array([1, 2]));
		const encode = vi.spyOn(compositor, 'encodeHdrMp4').mockResolvedValue(new Uint8Array([3, 4]));
		vi.spyOn(metadata, 'extractAppleHdrMetadata').mockResolvedValue({ version: '1.0', auxiliaryType: 'urn:com:apple:photo:2020:aux:hdrgainmap', makerNote33: 0.8, makerNote48: 0.4, headroom: 1.8, hdrGain: 1.25, sourceProfile: 'display-p3', sourceTransfer: 'srgb', orientation: 1 });
		const request = { request: new Request('https://pages.example/share/key/opaque-ref'), cookies: { get: vi.fn(), set: vi.fn() }, fetch: fetchMock };
		await expect(GET({ ...request, params } as never)).resolves.toMatchObject({ status: 200 });
		await expect(GET({ ...request, params } as never)).resolves.toMatchObject({ status: 403 });
		expect(compose).toHaveBeenCalledTimes(1);
		encode.mockRestore();
		compose.mockRestore();
	});
});
