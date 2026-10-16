import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../../src/routes/share/[kind]/[ref]/media/[assetId]/image/hdr-avif/+server';
import { clearHdrCache } from '../../src/lib/server/media/hdr-cache';
import { clearHdrMetadataCache } from '../../src/lib/server/media/hdr-metadata-cache';
import v3 from '../fixtures/shared-link/v3-valid-page.json';

const assetId = v3.assets[0].id;
const params = { kind: 'key', ref: 'opaque-ref', assetId };

describe('share HDR AVIF media boundary', () => {
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

	it('returns the gain-map pipeline result as a private AVIF HDR candidate', async () => {
		const source = new Uint8Array([0, 0, 0, 0, 102, 116, 121, 112, 104, 101, 105, 99]);
		const fetchMock = vi.fn(async (input: URL | RequestInfo) => new Response(new URL(input.toString()).pathname.endsWith('/me') ? JSON.stringify(v3) : source, { headers: { 'content-type': 'image/heic' } }));
		const compositor = await import('../../src/lib/server/media/hdr-compositor');
		const metadata = await import('../../src/lib/server/media/hdr-metadata');
		const decode = vi.spyOn(compositor, 'decodeHdrAvifStream').mockResolvedValue(new Uint8Array([1, 2]));
		const encode = vi.spyOn(compositor, 'encodeHdrAvif').mockResolvedValue(new Uint8Array([3, 4]));
		const extract = vi.spyOn(metadata, 'extractAppleHdrMetadata').mockResolvedValue({ version: '1.0', auxiliaryType: 'urn:com:apple:photo:2020:aux:hdrgainmap', makerNote33: 0.8, makerNote48: 0.4, headroom: 1.8, hdrGain: 1.25, sourceProfile: 'display-p3', sourceTransfer: 'srgb', orientation: 1 });
		const response = await GET({ params, request: new Request('https://pages.example/share/key/opaque-ref'), cookies: { get: vi.fn(), set: vi.fn() }, fetch: fetchMock } as never);
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('image/avif');
		// Decided tradeoff (see .planning/debug/hdr-lightbox-state-regression.md): successful
		// media may be cached by the browser itself -- never a shared/proxy cache -- for as long
		// as the server's own result cache promises identical bytes.
		expect(response.headers.get('cache-control')).toBe('private, max-age=600');
		expect(decode).toHaveBeenCalledWith(source, expect.objectContaining({ makerNote33: 0.8, makerNote48: 0.4 }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
		expect(encode).toHaveBeenCalledWith(new Uint8Array([1, 2]), expect.objectContaining({ sourceProfile: 'display-p3' }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
		decode.mockRestore();
		encode.mockRestore();
		extract.mockRestore();
	});

	it('keeps SDR fallback when Apple metadata is absent', async () => {
		const source = new Uint8Array([0, 0, 0, 0, 102, 116, 121, 112, 104, 101, 105, 99]);
		const fetchMock = vi.fn(async (input: URL | RequestInfo) => new Response(new URL(input.toString()).pathname.endsWith('/me') ? JSON.stringify(v3) : source, { headers: { 'content-type': 'image/heic' } }));
		const metadata = await import('../../src/lib/server/media/hdr-metadata');
		const extract = vi.spyOn(metadata, 'extractAppleHdrMetadata').mockResolvedValue(undefined);
		const response = await GET({ params, request: new Request('https://pages.example/share/key/opaque-ref'), cookies: { get: vi.fn(), set: vi.fn() }, fetch: fetchMock } as never);
		expect(response.status).toBe(404);
		extract.mockRestore();
	});

	// hdr-caching-uat-20261010 finding 4: this route previously never read or forwarded
	// width/height at all, so its cache key was always 'auto':'auto' while the background prewarm
	// path for the 'avif' representation keyed on the asset's real dimensions -- a guaranteed,
	// unconditional miss for every AVIF prewarm entry. The interactive route must key on whatever
	// width/height it was actually asked for, the same way the video route (/image/hdr) already
	// does, so a request with matching query dimensions reuses a cached result instead of forcing
	// a second conversion, and a request with DIFFERENT dimensions is treated as a different asset
	// representation (bounded cache key, not an unconditional collision).
	it('keys its cache entry on ?width=/?height= the same way the video route does', async () => {
		const source = new Uint8Array([0, 0, 0, 0, 102, 116, 121, 112, 104, 101, 105, 99]);
		const fetchMock = vi.fn(async (input: URL | RequestInfo) => new Response(new URL(input.toString()).pathname.endsWith('/me') ? JSON.stringify(v3) : source, { headers: { 'content-type': 'image/heic' } }));
		const compositor = await import('../../src/lib/server/media/hdr-compositor');
		const metadata = await import('../../src/lib/server/media/hdr-metadata');
		const decode = vi.spyOn(compositor, 'decodeHdrAvifStream').mockResolvedValue(new Uint8Array([1, 2]));
		const encode = vi.spyOn(compositor, 'encodeHdrAvif').mockResolvedValue(new Uint8Array([3, 4]));
		const extract = vi.spyOn(metadata, 'extractAppleHdrMetadata').mockResolvedValue({ version: '1.0', auxiliaryType: 'urn:com:apple:photo:2020:aux:hdrgainmap', makerNote33: 0.8, makerNote48: 0.4, headroom: 1.8, hdrGain: 1.25, sourceProfile: 'display-p3', sourceTransfer: 'srgb', orientation: 1 });
		const request = (query: string) => ({ params, request: new Request(`https://pages.example/share/key/opaque-ref${query}`), cookies: { get: vi.fn(), set: vi.fn() }, fetch: fetchMock });

		const first = await GET(request('?width=800&height=600') as never);
		expect(first.status).toBe(200);
		expect(decode).toHaveBeenCalledTimes(1);

		// Same dimensions again -- must reuse the cached entry, not convert a second time.
		const second = await GET(request('?width=800&height=600') as never);
		expect(second.status).toBe(200);
		expect(decode).toHaveBeenCalledTimes(1);

		// Different dimensions -- a distinct cache key, so this is a legitimate miss, not a bug.
		const third = await GET(request('?width=400&height=300') as never);
		expect(third.status).toBe(200);
		expect(decode).toHaveBeenCalledTimes(2);

		decode.mockRestore();
		encode.mockRestore();
		extract.mockRestore();
	});

	it('does not collide with the HEVC/MP4 cache entry for the same asset', async () => {
		const source = new Uint8Array([0, 0, 0, 0, 102, 116, 121, 112, 104, 101, 105, 99]);
		const fetchMock = vi.fn(async (input: URL | RequestInfo) => new Response(new URL(input.toString()).pathname.endsWith('/me') ? JSON.stringify(v3) : source, { headers: { 'content-type': 'image/heic' } }));
		const compositor = await import('../../src/lib/server/media/hdr-compositor');
		const metadata = await import('../../src/lib/server/media/hdr-metadata');
		const decode = vi.spyOn(compositor, 'decodeHdrAvifStream').mockResolvedValue(new Uint8Array([1, 2]));
		const encode = vi.spyOn(compositor, 'encodeHdrAvif').mockResolvedValue(new Uint8Array([3, 4]));
		vi.spyOn(metadata, 'extractAppleHdrMetadata').mockResolvedValue({ version: '1.0', auxiliaryType: 'urn:com:apple:photo:2020:aux:hdrgainmap', makerNote33: 0.8, makerNote48: 0.4, headroom: 1.8, hdrGain: 1.25, sourceProfile: 'display-p3', sourceTransfer: 'srgb', orientation: 1 });
		const { GET: videoGet } = await import('../../src/routes/share/[kind]/[ref]/media/[assetId]/image/hdr/+server');
		const videoCompose = vi.spyOn(compositor, 'composeHdr').mockResolvedValue(new Uint8Array([5, 6]));
		const videoEncode = vi.spyOn(compositor, 'encodeHdrMp4').mockResolvedValue(new Uint8Array([7, 8]));
		const request = { request: new Request('https://pages.example/share/key/opaque-ref'), cookies: { get: vi.fn(), set: vi.fn() }, fetch: fetchMock };
		const avifResponse = await GET({ ...request, params } as never);
		const videoResponse = await videoGet({ ...request, params } as never);
		expect(avifResponse.headers.get('content-type')).toBe('image/avif');
		expect(videoResponse.headers.get('content-type')).toBe('video/mp4');
		decode.mockRestore();
		encode.mockRestore();
		videoCompose.mockRestore();
		videoEncode.mockRestore();
	});

	// The lightbox asks this before trying to show an HDR version, so a photo with no HDR data just
	// stays the standard photo: no conversion attempted, nothing shown as failed. The answer comes
	// from the same metadata check (and cache) the conversion itself uses.
	describe('HDR availability probe (?probe=1)', () => {
		const source = new Uint8Array([0, 0, 0, 0, 102, 116, 121, 112, 104, 101, 105, 99]);
		const probeRequest = () => new Request('https://pages.example/share/key/opaque-ref/media/x/image?probe=1');
		const fetchMock = () => vi.fn(async (input: URL | RequestInfo) => new Response(new URL(input.toString()).pathname.endsWith('/me') ? JSON.stringify(v3) : source, { headers: { 'content-type': 'image/heic', etag: '"probe-etag"' } }));

		it('answers 204 when the photo has an HDR version, without converting anything', async () => {
			const compositor = await import('../../src/lib/server/media/hdr-compositor');
			const metadata = await import('../../src/lib/server/media/hdr-metadata');
			const extract = vi.spyOn(metadata, 'extractAppleHdrMetadata').mockResolvedValue({ version: '1.0', auxiliaryType: 'urn:com:apple:photo:2020:aux:hdrgainmap', makerNote33: 0.8, makerNote48: 0.4, headroom: 1.8, hdrGain: 0.4, sourceProfile: 'display-p3', sourceTransfer: 'srgb', orientation: 1 });
			const compose = vi.spyOn(compositor, 'composeHdr');
			const decode = vi.spyOn(compositor, 'decodeHdrAvifStream');
			const response = await GET({ params, request: probeRequest(), cookies: { get: vi.fn(), set: vi.fn() }, fetch: fetchMock() } as never);
			expect(response.status).toBe(204);
			expect(response.headers.get('x-pages-hdr')).toBe('available');
			expect(compose).not.toHaveBeenCalled();
			expect(decode).not.toHaveBeenCalled();
			extract.mockRestore(); compose.mockRestore(); decode.mockRestore();
		});

		it('answers 404 with x-pages-hdr: none when the photo has no HDR data', async () => {
			const metadata = await import('../../src/lib/server/media/hdr-metadata');
			const extract = vi.spyOn(metadata, 'extractAppleHdrMetadata').mockResolvedValue(undefined);
			const response = await GET({ params, request: probeRequest(), cookies: { get: vi.fn(), set: vi.fn() }, fetch: fetchMock() } as never);
			expect(response.status).toBe(404);
			expect(response.headers.get('x-pages-hdr')).toBe('none');
			// Remembered: asking again does not re-read the photo.
			const again = await GET({ params, request: probeRequest(), cookies: { get: vi.fn(), set: vi.fn() }, fetch: fetchMock() } as never);
			expect(again.headers.get('x-pages-hdr')).toBe('none');
			expect(extract).toHaveBeenCalledTimes(1);
			extract.mockRestore();
		});

		it('still checks share membership first', async () => {
			const fetchNotMember = vi.fn(async () => new Response(JSON.stringify({ ...v3, assets: [], album: undefined })));
			const response = await GET({ params, request: probeRequest(), cookies: { get: vi.fn(), set: vi.fn() }, fetch: fetchNotMember } as never);
			expect(response.status).toBe(404);
			expect(response.headers.get('x-pages-hdr')).toBeNull();
		});
	});
});

