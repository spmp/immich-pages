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

describe('Apple HDR metadata extraction', () => {
	beforeEach(() => spawn.mockReset());

	it('extracts the version, raw numeric MakerNote 33/48, profile, and orientation', async () => {
		spawn.mockReturnValue(childFor(JSON.stringify([valid])));
		await expect(extractAppleHdrMetadata(new Uint8Array([1]))).resolves.toMatchObject({ version: '1.0', makerNote33: 0.8, makerNote48: 0.4, sourceProfile: 'display-p3', sourceTransfer: 'srgb', orientation: 1 });
		expect(spawn.mock.calls[0]).toEqual(['/usr/bin/exiftool', expect.arrayContaining(['-HDRGainMapVersion', '-MakerNotes', '-AuxiliaryImageType']), expect.objectContaining({ shell: false, stdio: ['pipe', 'pipe', 'pipe'] })]);
	});

	it.each([
		{ ...valid, HDRGainMapVersion: undefined },
		{ ...valid, AuxiliaryImageType: 'other' },
		{ ...valid, MakerNotes: { HDRHeadroom: 1.8, HDRGain: 1.2 } },
		{ ...valid, MakerNotes: { '33': Number.NaN, '48': 1 } },
		{ ...valid, Orientation: 6 },
		{ ...valid, ProfileName: 'Unknown Camera RGB' }
	])('rejects incomplete, friendly-tag-only, ambiguous, or unsupported metadata', (record) => {
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
