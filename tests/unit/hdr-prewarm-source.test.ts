import { describe, expect, it, vi } from 'vitest';
import { createHdrPrewarmCoordinator } from '../../src/lib/server/media/hdr-prewarm';
import { prepareAuthorizedHdrSources } from '../../src/lib/server/media/hdr-prewarm-source';
import type { AppleHdrMetadata } from '../../src/lib/server/media/hdr-metadata';
import type { ShareAuthContext } from '../../src/lib/server/immich/auth-context';

const metadata: AppleHdrMetadata = {
	version: '1.0', auxiliaryType: 'urn:com:apple:photo:2020:aux:hdrgainmap', makerNote33: 0.8,
	makerNote48: 0.4, headroom: 1.8, hdrGain: 1.25, sourceProfile: 'display-p3', sourceTransfer: 'srgb', orientation: 1
};
const context = { shareRef: { kind: 'key' as const, value: 'opaque-ref' }, cookie: 'visitor-cookie', authorization: 'Bearer visitor' };
const asset = (id: string, mime = 'image/heic') => ({ id, type: 'IMAGE', thumbnail: `/media/${id}`, sourceMimeType: mime, sourceWidth: 1200, sourceHeight: 800 });

describe('authorized HDR prewarm source acquisition', () => {
	it('uses fresh membership-backed source reads and clears bounded bytes after scheduling', async () => {
		const bytes = new Uint8Array([1, 2, 3, 4]);
		const getFullsizeImage = vi.fn(async (_context: ShareAuthContext, id: string) => ({ status: 200, response: new Response(bytes, { headers: { 'content-type': id === 'a' ? 'image/heic' : 'image/jpeg' } }) }));
		const coordinator = createHdrPrewarmCoordinator({ convert: async () => ({ body: new Uint8Array([8]), contentType: 'video/mp4' }) });
		const snapshot = await prepareAuthorizedHdrSources({ getFullsizeImage }, context, { assets: [asset('cover', 'image/jpeg'), asset('a'), asset('b', 'image/jpeg')] }, {
			coordinator, activePosition: 0, lookahead: { kind: 'all' }, extractMetadata: async () => metadata
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(snapshot.targeted).toBe(1);
		expect(getFullsizeImage).toHaveBeenCalledTimes(1);
		expect(getFullsizeImage).toHaveBeenCalledWith(context, 'a');
		expect(coordinator.inspectSourceBytes()).toBe(0);
	});

	it('disposes unsupported or metadata-invalid source bytes without scheduling', async () => {
		const source = new Uint8Array([5, 6, 7]);
		let observed: Uint8Array | undefined;
		const coordinator = createHdrPrewarmCoordinator({ convert: vi.fn() });
		const getFullsizeImage = vi.fn(async () => ({ status: 200, response: new Response(source, { headers: { 'content-type': 'image/heic' } }) }));
		const snapshot = await prepareAuthorizedHdrSources({ getFullsizeImage }, context, { assets: [asset('cover', 'image/jpeg'), asset('a')] }, {
			coordinator, activePosition: 0, lookahead: { kind: 'all' }, extractMetadata: async (input) => { observed = input; return undefined; }
		});
		expect(snapshot.targeted).toBe(0);
		expect(coordinator.inspectSourceBytes()).toBe(0);
		expect(observed && [...observed]).toEqual([0, 0, 0]);
	});

	it('keeps representation identity independent for the same authorized source', async () => {
		const coordinator = createHdrPrewarmCoordinator({ convert: async ({ representation }) => ({ body: new Uint8Array([representation === 'video' ? 1 : 2]), contentType: representation === 'video' ? 'video/mp4' : 'image/avif' }) });
		const getFullsizeImage = vi.fn(async () => ({ status: 200, response: new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/heic' } }) }));
		const page = { assets: [asset('cover', 'image/jpeg'), asset('a')] };
		const video = await prepareAuthorizedHdrSources({ getFullsizeImage }, context, page, { coordinator, activePosition: 0, lookahead: { kind: 'all' }, representation: 'video', extractMetadata: async () => metadata });
		const avif = await prepareAuthorizedHdrSources({ getFullsizeImage }, context, page, { coordinator, activePosition: 0, lookahead: { kind: 'all' }, representation: 'avif', extractMetadata: async () => metadata });
		expect(video.representation).toBe('video');
		expect(avif.representation).toBe('avif');
	});
});
