import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../../src/routes/share/[kind]/[ref]/media/[assetId]/image/hdr/+server';
import { clearHdrCache } from '../../src/lib/server/media/hdr-cache';
import v3 from '../fixtures/shared-link/v3-valid-page.json';

const assetId = v3.assets[0].id;
const params = { kind: 'key', ref: 'opaque-ref', assetId };

describe('share HDR media boundary', () => {
	beforeEach(() => { vi.stubEnv('IMMICH_BASE_URL', 'https://immich.example'); clearHdrCache(); });

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
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(compose).toHaveBeenCalledWith(source, expect.objectContaining({ makerNote33: 0.8, makerNote48: 0.4 }));
		expect(encode).toHaveBeenCalledWith(new Uint8Array([1, 2]));
		compose.mockRestore();
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
		expect(extract).toHaveBeenCalledWith(source);
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
