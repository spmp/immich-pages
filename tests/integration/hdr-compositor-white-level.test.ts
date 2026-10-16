import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { extractAppleHdrMetadata } from '../../src/lib/server/media/hdr-metadata';

// The HDR video fallback (PQ, absolute nits) used to place the photo's SDR white at 100 nits,
// while the AVIF path uses 203 nits (ITU-R BT.2408 reference white, libavif's convention). A
// player following BT.2408 then showed the video a stop darker than the page around it, and the
// same photo looked different depending on which representation a browser received.
//
// Built from the current source here (skipped without g++/libheif), so this tests the code in the
// tree rather than whatever binary happens to be installed. The reference build pins the old
// 100-nit white; every pixel of the default build must be exactly 203/100 as bright.
const work = mkdtempSync(join(tmpdir(), 'hdr-white-'));
const build = (name: string, defines: string[] = []) => {
	const output = join(work, name);
	const result = spawnSync('g++', ['-O2', '-std=c++17', ...defines, 'scripts/hdr-gainmap-compositor.cpp', '-lheif', '-o', output], { encoding: 'utf8' });
	return result.status === 0 ? output : undefined;
};
const current = build('current');
const reference = current ? build('reference', ['-DHDR_SDR_WHITE_NITS=100']) : undefined;
afterAll(() => rmSync(work, { recursive: true, force: true }));

const pqToNits = (code: number) => {
	const m1 = 2610 / 16384, m2 = 2523 / 32, c1 = 3424 / 4096, c2 = 2413 / 128, c3 = 2392 / 128;
	const e = Math.pow(code / 65535, 1 / m2);
	return 10000 * Math.pow(Math.max(e - c1, 0) / (c2 - c3 * e), 1 / m1);
};

function frame(binary: string, heic: Uint8Array, args: string[]): Uint16Array {
	const ppm = execFileSync(binary, args, { input: heic, maxBuffer: 512 * 1024 * 1024 });
	// "P6\n<w> <h>\n65535\n" then big-endian 16-bit RGB.
	let offset = 0;
	for (let fields = 0; fields < 4; offset += 1) if (ppm[offset] === 0x0a || (fields === 1 && ppm[offset] === 0x20)) fields += 1;
	const values = new Uint16Array((ppm.length - offset) / 2);
	for (let i = 0; i < values.length; i += 1) values[i] = ppm.readUInt16BE(offset + i * 2);
	return values;
}

describe.skipIf(!current || !reference)('HDR video fallback white level', () => {
	it('places the photo\'s SDR white at 203 nits (BT.2408), like the AVIF path', { timeout: 120_000 }, async () => {
		const heic = new Uint8Array(readFileSync(new URL('../resources/heic-test-set/originals/01.HEIC', import.meta.url)));
		const metadata = await extractAppleHdrMetadata(heic);
		expect(metadata).toBeTruthy();
		const args = ['--hdr-version', metadata!.version, '--maker-note-33', String(metadata!.makerNote33), '--maker-note-48', String(metadata!.makerNote48), '--source-profile', metadata!.sourceProfile, '--source-transfer', metadata!.sourceTransfer, '--orientation', String(metadata!.orientation)];
		const at100 = frame(reference!, heic, args);
		const now = frame(current!, heic, args);
		expect(now.length).toBe(at100.length);
		let compared = 0;
		let worst = 0;
		// Every 97th sample: well-exposed values only, away from black (quantization) and the PQ ceiling.
		for (let i = 0; i < at100.length; i += 97) {
			const before = pqToNits(at100[i]);
			if (before < 1 || before > 4000) continue;
			worst = Math.max(worst, Math.abs(pqToNits(now[i]) / before - 2.03));
			compared += 1;
		}
		expect(compared).toBeGreaterThan(10_000);
		expect(worst).toBeLessThan(0.03);
	});
});
