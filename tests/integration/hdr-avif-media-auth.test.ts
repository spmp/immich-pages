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
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(decode).toHaveBeenCalledWith(source, expect.objectContaining({ makerNote33: 0.8, makerNote48: 0.4 }));
		expect(encode).toHaveBeenCalledWith(new Uint8Array([1, 2]), expect.objectContaining({ sourceProfile: 'display-p3' }));
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
});
