import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { extractAppleHdrMetadata } from '../../src/lib/server/media/hdr-metadata';
import { decodeHdrAvifStream, encodeHdrAvif } from '../../src/lib/server/media/hdr-compositor';
import { describeNativeHdr, nativeBinary } from '../helpers/native-hdr';

// The AVIF gain-map path is the HDR version most browsers get (Chrome, Safari 26+), yet every
// other AVIF test replaces hdr-avif-decode/hdr-avif-encode with a stub or bridge script. These
// run the real binaries on real Apple photos and read the result back with libavif's own avifdec:
// a P3 SDR base image, upright, carrying a gain map whose HDR headroom is real but never more than
// the photo's own (Apple's) headroom.
const work = mkdtempSync(join(tmpdir(), 'hdr-avif-real-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

async function convert(name: string) {
	const heic = new Uint8Array(readFileSync(new URL(`../resources/heic-test-set/originals/${name}.HEIC`, import.meta.url)));
	const metadata = await extractAppleHdrMetadata(heic);
	expect(metadata).toBeTruthy();
	const stream = await decodeHdrAvifStream(heic, metadata!, { executable: nativeBinary('hdr-avif-decode') });
	const avif = await encodeHdrAvif(stream, metadata!, { executable: nativeBinary('hdr-avif-encode') });
	const path = join(work, `${name}.avif`);
	writeFileSync(path, avif);
	const info = execFileSync('avifdec', ['--info', path], { encoding: 'utf8' });
	const field = (label: string) => info.match(new RegExp(`\\* ${label}\\s*: (.+)`))?.[1]?.trim();
	const gainMap = field('Gain map') ?? '';
	return {
		metadata: metadata!,
		bytes: avif.byteLength,
		resolution: field('Resolution'),
		primaries: field('Color Primaries'),
		transfer: field('Transfer Char\\.'),
		transformations: field('Transformations'),
		gainMap,
		baseHeadroom: Number(gainMap.match(/Base Headroom ([\d.]+)/)?.[1]),
		alternateHeadroom: Number(gainMap.match(/Alternate Headroom ([\d.]+)/)?.[1])
	};
}

describeNativeHdr('real (unbridged) AVIF gain-map pipeline', { binaries: ['hdr-avif-decode', 'hdr-avif-encode'], tools: ['exiftool', 'avifdec'] }, () => {
	it('makes a gain-map AVIF with a P3 base and the photo\'s own HDR headroom', { timeout: 60_000 }, async () => {
		const result = await convert('01');
		expect(result.bytes).toBeGreaterThan(100_000);
		expect(result.resolution).toBe('4032x2268');
		// The SDR base keeps the photo's Display P3 colour (CICP 12) and sRGB transfer (13): no
		// silent fall back to sRGB primaries, which would desaturate every photo.
		expect(result.primaries).toBe('12');
		expect(result.transfer).toBe('13');
		expect(result.gainMap).toContain('YUV400');
		expect(result.baseHeadroom).toBe(0);
		// Real HDR, never brighter than the photo itself allows (Apple's headroom, in stops).
		expect(result.alternateHeadroom).toBeGreaterThan(0.5);
		expect(result.alternateHeadroom).toBeLessThanOrEqual(Math.log2(result.metadata.headroom) + 0.05);
	});

	it('makes an upright AVIF from a rotated (upright-held) 4:3 photo', { timeout: 60_000 }, async () => {
		const result = await convert('17');
		expect(result.metadata.orientation).toBe(6);
		// Rotated in the pixels, with no rotation left for a viewer to apply (or forget) on top.
		expect(result.resolution).toBe('3024x4032');
		expect(result.transformations).toBe('None');
		expect(result.gainMap).toMatch(/^1512x2016 pixels/);
		expect(result.alternateHeadroom).toBeGreaterThan(0.5);
		expect(result.alternateHeadroom).toBeLessThanOrEqual(Math.log2(result.metadata.headroom) + 0.05);
	});
});
