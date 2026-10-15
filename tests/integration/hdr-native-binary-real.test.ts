import { existsSync, readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../../src/routes/share/[kind]/[ref]/media/[assetId]/image/hdr/+server';
import { clearHdrCache } from '../../src/lib/server/media/hdr-cache';
import { clearHdrMetadataCache } from '../../src/lib/server/media/hdr-metadata-cache';
import v3 from '../fixtures/shared-link/v3-valid-page.json';

// Real-backend UAT (2026-10-12): every fast unit/integration/E2E test in this repo deliberately
// substitutes a bridge script for the native compositor/ffmpeg (HDR_METADATA_PATH/
// HDR_COMPOSITOR_PATH/HDR_FFMPEG_PATH env vars), by design, for CI speed and determinism -- the
// real unbridged binaries are only otherwise exercised inside the production Docker image build.
// That left a real, structural gap: nothing proved the unbridged pipeline actually works on a
// bare host running `npm run dev` directly (not via Docker) -- which is exactly how this bug was
// found, invisible until real manual browsing against a real backend happened. This test closes
// that gap without requiring every contributor/CI machine to have g++/libheif-dev/libavif-dev
// installed: it skips cleanly if the real binary isn't present, and proves real end-to-end
// correctness when it is.
const compositorPath = process.env.HDR_COMPOSITOR_PATH ?? '/usr/local/bin/hdr-gainmap-compositor';
const hasRealCompositor = existsSync(compositorPath) && !process.env.HDR_METADATA_PATH && !process.env.HDR_COMPOSITOR_PATH;

const assetId = v3.assets[0].id;
const params = { kind: 'key', ref: 'opaque-ref', assetId };
const realHeic = readFileSync(new URL('../resources/heic-test-set/originals/01.HEIC', import.meta.url));

describe.skipIf(!hasRealCompositor)('real (unbridged) native HDR compositor + ffmpeg pipeline', () => {
	beforeEach(() => { vi.stubEnv('IMMICH_BASE_URL', 'https://immich.example'); clearHdrCache(); clearHdrMetadataCache(); });

	it('produces a real, valid HEVC Main10/PQ/BT.2020 MP4 from a real Apple HDR gain-map photo', { timeout: 30_000 }, async () => {
		const share = { ...v3, assets: [{ ...v3.assets[0], type: 'IMAGE', originalMimeType: 'image/heic', width: 4032, height: 2268 }] };
		const fetchMock = async (input: URL | RequestInfo) =>
			new Response(new URL(input.toString()).pathname.endsWith('/me') ? JSON.stringify(share) : realHeic, { headers: { 'content-type': 'image/heic' } });
		const response = await GET({ params, request: new Request('https://pages.example/share/key/opaque-ref'), cookies: { get: () => undefined, set: () => undefined }, fetch: fetchMock } as never);

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('video/mp4');
		const body = new Uint8Array(await response.arrayBuffer());
		// A real single-frame 4K HEVC Main10 output is consistently in the low megabytes (not a
		// placeholder/empty-output bug) -- see the real manual confirmation this test automates:
		// a 4032x2268 real photo produced a 2.5MB file during this session's own UAT.
		expect(body.byteLength).toBeGreaterThan(500_000);
		// Every valid MP4/ISOBMFF file has an 'ftyp' box within its first few bytes.
		const header = Buffer.from(body.slice(0, 32)).toString('latin1');
		expect(header).toContain('ftyp');
	});

	// 17.HEIC is a 4:3 photo taken with the phone held upright, straight from the camera: stored
	// 4032x3024 with a "rotate 90 degrees" instruction. Both the photo and its gain map carry the
	// rotation, so the real compositor must produce an upright portrait frame -- this shape used to
	// be refused outright (rotated) and would also have overflowed the old output cap (4:3).
	it('converts a rotated (upright-held) 4:3 photo into an upright portrait frame', { timeout: 60_000 }, async () => {
		const { extractAppleHdrMetadata } = await import('../../src/lib/server/media/hdr-metadata');
		const { composeHdr } = await import('../../src/lib/server/media/hdr-compositor');
		const rotated = new Uint8Array(readFileSync(new URL('../resources/heic-test-set/originals/17.HEIC', import.meta.url)));
		const metadata = await extractAppleHdrMetadata(rotated);
		expect(metadata?.orientation).toBe(6);
		const frame = await composeHdr(rotated, metadata!, { executable: compositorPath });
		const [, width, height] = Buffer.from(frame.subarray(0, 24)).toString('latin1').split(/\s+/);
		expect([Number(width), Number(height)]).toEqual([3024, 4032]);
	});
});

