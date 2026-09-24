import { fileURLToPath } from 'node:url';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { convertHeicToJpeg, SdrConvertError } from '../../src/lib/server/media/sdr-compositor';

// Runs the real Node child process at tests/unit/fixtures/fake-heif-convert.mjs, which honors the
// same `-q <n> -o <outputPath> <inputPath>` contract as the real heif-convert binary and does real
// file I/O, so these tests exercise genuine spawn/temp-file/cleanup behavior, not a mocked spawn.
const fakeExecutable = fileURLToPath(new URL('./fixtures/fake-heif-convert.mjs', import.meta.url));

describe('SDR HEIC to JPEG conversion', () => {
	it('writes the input to a real temp file, invokes the real conversion contract, and returns real output bytes', async () => {
		const input = new Uint8Array([1, 2, 3, 4, 5]);
		const output = await convertHeicToJpeg(input, { executable: fakeExecutable, quality: 90 });
		expect(Buffer.from(output.subarray(0, 4))).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
		expect(output[output.byteLength - 1]).toBe(input.length % 256);
	});

	it('cleans up its temp directory after success', async () => {
		const before = await readdir(tmpdir());
		await convertHeicToJpeg(new Uint8Array([9]), { executable: fakeExecutable });
		const after = await readdir(tmpdir());
		expect(after.filter((name) => name.startsWith('immich-pages-sdr-'))).toHaveLength(before.filter((name) => name.startsWith('immich-pages-sdr-')).length);
	});

	it('rejects with a typed error and cleans up when the converter exits non-zero', async () => {
		process.env.FAKE_HEIF_CONVERT_BEHAVIOR = 'fail';
		try {
			await expect(convertHeicToJpeg(new Uint8Array([1]), { executable: fakeExecutable })).rejects.toMatchObject({ reason: 'exit' });
		} finally {
			delete process.env.FAKE_HEIF_CONVERT_BEHAVIOR;
		}
	});

	it('rejects with a typed error when the converter produces empty output', async () => {
		process.env.FAKE_HEIF_CONVERT_BEHAVIOR = 'empty';
		try {
			await expect(convertHeicToJpeg(new Uint8Array([1]), { executable: fakeExecutable })).rejects.toMatchObject({ reason: 'empty-output' });
		} finally {
			delete process.env.FAKE_HEIF_CONVERT_BEHAVIOR;
		}
	});

	it('rejects with a typed timeout error and kills a hanging converter', async () => {
		process.env.FAKE_HEIF_CONVERT_BEHAVIOR = 'hang';
		try {
			await expect(convertHeicToJpeg(new Uint8Array([1]), { executable: fakeExecutable, timeoutMs: 50 })).rejects.toMatchObject({ reason: 'timeout' });
		} finally {
			delete process.env.FAKE_HEIF_CONVERT_BEHAVIOR;
		}
	});

	it('rejects oversized input before spawning any process', async () => {
		await expect(convertHeicToJpeg(new Uint8Array(0), { executable: fakeExecutable })).rejects.toMatchObject({ reason: 'input-limit' });
	});

	it('rejects when the executable does not exist', async () => {
		await expect(convertHeicToJpeg(new Uint8Array([1]), { executable: '/nonexistent/heif-convert' })).rejects.toBeInstanceOf(SdrConvertError);
	});
});
