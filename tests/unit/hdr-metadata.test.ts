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
		{ ...valid, Orientation: 6 },
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
});
