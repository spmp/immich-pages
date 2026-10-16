import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn }));

import { appleHeadroom, extractAppleHdrMetadata, normalizeAppleMetadata } from '../../src/lib/server/media/hdr-metadata';

function childFor(output: string, code = 0) {
	const child = new EventEmitter() as EventEmitter & { stdin: EventEmitter & { end: (input: Uint8Array) => void }; stdout: EventEmitter; stderr: EventEmitter; kill: ReturnType<typeof vi.fn> };
	child.stdout = new EventEmitter();
	child.stderr = new EventEmitter();
	child.kill = vi.fn();
	child.stdin = Object.assign(new EventEmitter(), { end: vi.fn(() => { child.stdout.emit('data', Buffer.from(output)); child.emit('close', code); }) });
	return child;
}

const valid = { AuxiliaryImageType: 'urn:com:apple:photo:2020:aux:hdrgainmap', HDRGainMapVersion: '1.0', MakerNotes: { '33': 0.8, '48': 0.4 }, ProfileName: 'Display P3', TransferFunction: 'sRGB', Orientation: 1 };

// Captured verbatim from `exiftool -json -G1 -s -HDRGainMapVersion -Apple:HDRHeadroom# -Apple:HDRGain#
// -AuxiliaryImageType -ICC_Profile:ProfileDescription -Orientation# -` against a real Apple HDR
// gain-map HEIC photo. This is the shape every real photo actually produces; the raw-numeric-key
// "33"/"48" shape above has never been observed from real ExifTool output and is kept only as a
// defense-in-depth fallback.
const realExifToolShape = {
	'XMP-HDRGainMap:HDRGainMapVersion': '0.1.0.0',
	'Apple:HDRHeadroom': 1.568873048,
	'Apple:HDRGain': 0.000004384119166,
	'QuickTime:AuxiliaryImageType': 'urn:com:apple:photo:2020:aux:hdrgainmap',
	'ICC_Profile:ProfileDescription': 'Display P3',
	'ICC_Profile2:ProfileDescription': 'Linear Gray',
	'IFD0:Orientation': 1
};

describe('Apple HDR metadata extraction', () => {
	beforeEach(() => spawn.mockReset());

	it('extracts real-world ExifTool output (friendly MakerNote names, dotted version, ICC profile description)', () => {
		expect(normalizeAppleMetadata(realExifToolShape)).toMatchObject({ version: '1.0', makerNote33: 1.568873048, makerNote48: 0.000004384119166, sourceProfile: 'display-p3', sourceTransfer: 'srgb', orientation: 1 });
	});

	it('never picks up the secondary ICC_Profile2 (the gain map\'s own embedded profile) as the source profile', () => {
		// Only the primary ICC_Profile:ProfileDescription (exact key match, not a suffix match)
		// counts; without it there is no other profile signal in this real-world shape, so the
		// asset is correctly rejected rather than silently matching ICC_Profile2's "Linear Gray".
		expect(normalizeAppleMetadata({ ...realExifToolShape, 'ICC_Profile:ProfileDescription': undefined })).toBeUndefined();
	});

	it('extracts the version, raw numeric MakerNote 33/48 (legacy fallback shape), profile, and orientation', async () => {
		spawn.mockReturnValue(childFor(JSON.stringify([valid])));
		await expect(extractAppleHdrMetadata(new Uint8Array([1]))).resolves.toMatchObject({ version: '1.0', makerNote33: 0.8, makerNote48: 0.4, sourceProfile: 'display-p3', sourceTransfer: 'srgb', orientation: 1 });
		expect(spawn.mock.calls[0]).toEqual(['/usr/bin/exiftool', expect.arrayContaining(['-HDRGainMapVersion', '-Apple:HDRHeadroom#', '-Apple:HDRGain#', '-AuxiliaryImageType', '-ICC_Profile:ProfileDescription', '-Orientation#']), expect.objectContaining({ shell: false, stdio: ['pipe', 'pipe', 'pipe'] })]);
	});

	it.each([
		{ ...valid, HDRGainMapVersion: undefined },
		{ ...valid, HDRGainMapVersion: '2.0' },
		{ ...valid, AuxiliaryImageType: 'other' },
		{ ...valid, MakerNotes: { '33': Number.NaN, '48': 1 } },
		{ ...valid, Orientation: 9 },
		{ ...valid, Orientation: 0 },
		{ ...valid, ProfileName: 'Unknown Camera RGB' }
	])('rejects incomplete, ambiguous, or unsupported metadata', (record) => {
		expect(normalizeAppleMetadata(record)).toBeUndefined();
	});

	it('implements all four Apple stop-curve branches without a universal constant', () => {
		expect(appleHeadroom(0.5, 0.01)).toBeCloseTo(2 ** 1.6);
		expect(appleHeadroom(0.5, 0.2)).toBeCloseTo(2 ** 1.5808);
		expect(appleHeadroom(1.5, 0.01)).toBeCloseTo(2 ** 2.3);
		expect(appleHeadroom(1.5, 0.2)).toBeCloseTo(2 ** 2.2424);
	});

	it('rejects empty and malformed bounded process output', async () => {
		spawn.mockReturnValue(childFor('not-json'));
		await expect(extractAppleHdrMetadata(new Uint8Array([1]))).resolves.toBeUndefined();
	});

	// Production failure (2026-10-15, photo 35 of a 125-photo album): a Portrait-mode iPhone photo
	// has THREE auxiliary images -- the HDR gain map, a depth map and disparity data. ExifTool
	// without -a reports only the last one per group, so the gain map was never seen. Captured
	// from the real file with the arguments Pages now uses (-a -G1:4 numbers the duplicates).
	const portraitModeShape = {
		'XMP-HDRGainMap:HDRGainMapVersion': '0.1.0.0',
		'Apple:HDRHeadroom': 0.6173437834,
		'XMP-apdi:Copy2:AuxiliaryImageType': 'disparity',
		'QuickTime:Copy1:AuxiliaryImageType': 'urn:com:apple:photo:2020:aux:hdrgainmap',
		'QuickTime:AuxiliaryImageType': 'urn:mpeg:hevc:2015:auxid:2',
		'ICC_Profile:ProfileDescription': 'Display P3',
		'ICC_Profile2:ProfileDescription': 'Generic Gray Gamma 2.2 Profile',
		'ExifIFD:ColorSpace': 'Uncalibrated',
		'IFD0:Orientation': 1
	};

	it('finds the gain map among several auxiliary images (Portrait mode)', () => {
		expect(normalizeAppleMetadata(portraitModeShape)).toMatchObject({ auxiliaryType: 'urn:com:apple:photo:2020:aux:hdrgainmap', makerNote33: 0.6173437834 });
	});

	// The same photo has HDRHeadroom (MakerNote 33) but no HDRGain (MakerNote 48). Skia, which
	// renders Apple gain maps in Chrome, treats that as 48 = 0: "Many images have a maker33 but
	// not a maker48" (src/codec/SkExif.cpp). Rejecting it threw away a real HDR photo.
	it('treats a missing HDRGain as 0, as Skia does', () => {
		const metadata = normalizeAppleMetadata(portraitModeShape);
		expect(metadata?.makerNote48).toBe(0);
		expect(metadata?.headroom).toBeCloseTo(2 ** 1.8, 6);
	});

	it('still rejects a photo whose only auxiliary image is not a gain map', () => {
		const { 'QuickTime:Copy1:AuxiliaryImageType': _gainMap, ...depthOnly } = portraitModeShape;
		expect(normalizeAppleMetadata(depthOnly)).toBeUndefined();
	});

	it('still rejects a photo with no HDR headroom at all (not captured as HDR)', () => {
		const { 'Apple:HDRHeadroom': _headroom, ...noHeadroom } = portraitModeShape;
		expect(normalizeAppleMetadata(noHeadroom)).toBeUndefined();
	});

	it('asks ExifTool for every duplicate tag, numbered, so no auxiliary image is hidden', async () => {
		spawn.mockReturnValueOnce(childFor(JSON.stringify([portraitModeShape])));
		await extractAppleHdrMetadata(new Uint8Array([1]));
		const args = spawn.mock.calls.at(-1)?.[1] as string[];
		expect(args).toContain('-a');
		expect(args).toContain('-G1:4');
		expect(args).not.toContain('-G1');
	});

	// A photo taken with the phone held upright is stored landscape with a "rotate 90 degrees"
	// instruction (EXIF Orientation 6, HEIF irot). Rejecting every rotated photo sent all of them to
	// the standard photo. The rotation lives in the HEIF container and libheif applies it to the
	// photo and the gain map alike; the converters themselves refuse a pair whose shapes disagree.
	it.each([1, 3, 6, 8])('accepts a photo with EXIF orientation %i', (orientation) => {
		expect(normalizeAppleMetadata({ ...realExifToolShape, 'IFD0:Orientation': orientation })?.orientation).toBe(orientation);
	});
});
