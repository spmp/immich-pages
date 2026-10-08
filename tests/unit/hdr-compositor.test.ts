import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn }));
const { readFile, rm } = vi.hoisted(() => ({ readFile: vi.fn(), rm: vi.fn() }));
vi.mock('node:fs/promises', () => ({ readFile, rm }));

import { composeHdr, decodeHdrAvifStream, encodeHdrAvif, encodeHdrMp4 } from '../../src/lib/server/media/hdr-compositor';

function childFor(output: string) {
	const child = new EventEmitter() as EventEmitter & { stdin: EventEmitter & { end: (input: Uint8Array) => void }; stdout: EventEmitter; stderr: EventEmitter; kill: ReturnType<typeof vi.fn> };
	child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = vi.fn();
	child.stdin = Object.assign(new EventEmitter(), { end: vi.fn(() => { child.stdout.emit('data', Buffer.from(output)); child.emit('close', 0); }) });
	return child;
}

const metadata = { version: '1.0', auxiliaryType: 'urn:com:apple:photo:2020:aux:hdrgainmap' as const, makerNote33: 0.8, makerNote48: 0.4, headroom: 2, hdrGain: 0.4, sourceProfile: 'display-p3' as const, sourceTransfer: 'srgb' as const, orientation: 1 as const };

describe('HDR native process contracts', () => {
	beforeEach(() => { spawn.mockReset(); readFile.mockReset(); rm.mockReset().mockResolvedValue(undefined); });

	it('passes bounded metadata through the fixed native CLI contract', async () => {
		spawn.mockReturnValue(childFor('P6\n1 1\n65535\n'));
		await expect(composeHdr(new Uint8Array([1]), metadata)).resolves.toEqual(Buffer.from('P6\n1 1\n65535\n'));
		const [executable, args, options] = spawn.mock.calls[0];
		expect(executable).toBe('/usr/local/bin/hdr-gainmap-compositor');
		expect(args).toEqual(['--hdr-version', '1.0', '--maker-note-33', '0.8', '--maker-note-48', '0.4', '--source-profile', 'display-p3', '--source-transfer', 'srgb', '--orientation', '1']);
		expect(options).toMatchObject({ shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
	});

	it('uses one-frame HEVC Main10/PQ/BT.2020 faststart MP4, written to a real seekable file', async () => {
		// A true pipe (pipe:1) can't be seeked back to move the moov box to the front after
		// muxing, so this used to use a fragmented/empty-moov structure instead -- designed for
		// MSE-style incremental consumption, not a plain <video src>. Real server logs showed the
		// server succeeding and delivering the exact right bytes every time (zero failures, zero
		// timeouts, correct byte count) while WebKit's <video> element still fired its error event
		// outright -- it never got far enough to even try playing it, consistent with rejecting
		// the container structure itself. Fix: write to a real file so ffmpeg can produce a
		// standard +faststart (moov up front) file, the universally-compatible structure.
		spawn.mockReturnValue(childFor(''));
		readFile.mockResolvedValue(Buffer.from('mp4'));
		await expect(encodeHdrMp4(new Uint8Array([1, 2, 3]))).resolves.toEqual(Buffer.from('mp4'));
		const [, args] = spawn.mock.calls[0];
		expect(args).toEqual(expect.arrayContaining(['-frames:v', '1', '-c:v', 'libx265', '-profile:v', 'main10', '-pix_fmt', 'yuv420p10le', '-color_primaries', 'bt2020', '-color_trc', 'smpte2084', '-colorspace', 'bt2020nc', '-movflags', '+faststart', '-f', 'mp4']));
		expect(args.join(' ')).not.toContain('h=-2');
		expect(args.join(' ')).not.toContain('frag_keyframe');
		expect(args).not.toContain('pipe:1');
		// The output path is a real temp file passed as the last ffmpeg arg, not a pipe -- and it
		// must be deleted once read, regardless of success, to avoid leaking temp files.
		const outputPath = args[args.length - 1];
		expect(outputPath).toMatch(/hdr-.+\.mp4$/);
		expect(readFile).toHaveBeenCalledWith(outputPath);
		expect(rm).toHaveBeenCalledWith(outputPath, { force: true });
	});

	it('tags mastering-display luminance and content light level, not just pixel format/colr', async () => {
		// WebKit's native HDR video path (confirmed on iOS Safari < WebKit 26) silently renders a
		// technically-correct-but-flat/SDR-looking video without MDCV/CLL SEI data -- color
		// primaries/transfer/matrix tags alone aren't enough for it to actually tone-map as HDR.
		spawn.mockReturnValue(childFor(''));
		readFile.mockResolvedValue(Buffer.from('mp4'));
		await encodeHdrMp4(new Uint8Array([1, 2, 3]));
		const [, args] = spawn.mock.calls[0];
		const x265Params = args[args.indexOf('-x265-params') + 1];
		expect(x265Params).toContain('master-display=G(8500,39850)B(6550,2300)R(35400,14600)WP(15635,16450)L(10000000,1)');
		expect(x265Params).toContain('max-cll=1000,400');
	});

	it('deletes the temp MP4 file even when ffmpeg fails', async () => {
		const child = childFor('');
		child.stdin.end = vi.fn(() => child.emit('close', 1));
		spawn.mockReturnValue(child);
		await expect(encodeHdrMp4(new Uint8Array([1, 2, 3]))).rejects.toThrow();
		expect(rm).toHaveBeenCalledWith(expect.stringMatching(/hdr-.+\.mp4$/), { force: true });
		expect(readFile).not.toHaveBeenCalled();
	});

	it('decodes to a gain-map stream with the fixed Apple metadata CLI contract', async () => {
		spawn.mockReturnValue(childFor('stream'));
		await expect(decodeHdrAvifStream(new Uint8Array([1]), metadata)).resolves.toEqual(Buffer.from('stream'));
		const [executable, args] = spawn.mock.calls[0];
		expect(executable).toBe('/usr/local/bin/hdr-avif-decode');
		expect(args).toEqual(['--mode', 'gainmap', '--hdr-version', '1.0', '--maker-note-33', '0.8', '--maker-note-48', '0.4', '--source-profile', 'display-p3', '--source-transfer', 'srgb', '--orientation', '1']);
	});

	it('encodes the decoded stream with only the source color contract, preserving P3', async () => {
		spawn.mockReturnValue(childFor('avif'));
		await expect(encodeHdrAvif(new Uint8Array([1, 2, 3]), metadata)).resolves.toEqual(Buffer.from('avif'));
		const [executable, args] = spawn.mock.calls[0];
		expect(executable).toBe('/usr/local/bin/hdr-avif-encode');
		expect(args).toEqual(['--source-profile', 'display-p3', '--source-transfer', 'srgb']);
	});

	it('keeps Apple metadata and native pixel invariants visible in source', () => {
		const source = readFileSync(new URL('../../scripts/hdr-gainmap-compositor.cpp', import.meta.url), 'utf8');
		expect(source).toContain('urn:com:apple:photo:2020:aux:hdrgainmap');
		expect(source).toContain('apple_headroom');
		expect(source).toContain('rec709_to_linear');
		expect(source).toContain('static_cast<char>(value >> 8)');
		expect(source).not.toContain('3.4816322');
	});
});
