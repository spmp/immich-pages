import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { composeHdr } from './hdr-compositor';
import type { AppleHdrMetadata } from './hdr-metadata';

/**
 * Throwaway spike module (see .planning/spikes/ for the write-up). Not part of the production
 * HDR contract: reuses the existing Apple gain-map PPM reconstruction and re-encodes it into
 * still-image candidates to find out, with real devices, whether any of them can replace the
 * single-frame HDR video for a zoomable full-size view. Disabled unless SPIKE_HDR_COMPARE=true.
 */
/** Intentionally always on, no env var required -- this whole route is a short-lived debug
 * surface the user plans to delete outright once device testing is done (see
 * .planning/spikes/001-hdr-still-image-formats/README.md), not a production feature flag. */
export const SPIKE_HDR_ENABLED = true;

/** Shared by the index page (which tag/label to render) and the media route (content-type). */
export const SPIKE_FORMATS = [
	{ slug: 'sdr.jpg', contentType: 'image/jpeg', tag: 'img', label: 'SDR baseline (converted JPEG, existing fullsize path)' },
	{ slug: 'hdr-video.mp4', contentType: 'video/mp4', tag: 'video', label: 'Current production candidate: HEVC Main10/PQ/BT.2020 video, single frame' },
	{ slug: 'heic-original.heic', contentType: 'image/heic', tag: 'img', label: 'Original HEIC bytes, zero transcoding (Safari/WebKit may render its own gain map natively)' },
	{ slug: 'avif-hdr.avif', contentType: 'image/avif', tag: 'img', label: 'AVIF, CICP 9/16/9 (BT.2020 / PQ / BT.2020-NCL), no gain map -- no known SDR fallback' },
	{ slug: 'jxl-hdr.jxl', contentType: 'image/jxl', tag: 'img', label: 'JPEG XL, Rec.2100 PQ, intensity_target 1000 nits -- Safari-only decode, no known SDR fallback' }
] as const;
export type SpikeFormatSlug = (typeof SPIKE_FORMATS)[number]['slug'];

const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const TIMEOUT_MS = 60_000;

export type SpikeStillFormat = 'avif-hdr' | 'jxl-hdr';

/** PPM carries no color tags; ffmpeg's own HDR mp4 path already treats these pixels as PQ/BT.2020 (see hdr-compositor.ts encodeHdrMp4), so every still candidate below tags the same primaries/transfer rather than guessing a different one. */
export async function composeHdrPpm(input: Uint8Array, metadata: AppleHdrMetadata): Promise<Uint8Array> {
	return composeHdr(input, metadata);
}

export async function ppmToPng16(ppm: Uint8Array): Promise<Uint8Array> {
	return runPipedProcess(process.env.SPIKE_FFMPEG_PATH ?? '/usr/bin/ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-vcodec', 'ppm', '-i', 'pipe:0', '-frames:v', '1', '-pix_fmt', 'rgb48be', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1'], ppm);
}

/** avifenc has no stdio piping for PNG input (only raw y4m via --stdin), so this writes real temp files and always removes them, same pattern as convertHeicToJpeg in sdr-compositor.ts. */
export async function encodeAvifHdr(png16: Uint8Array): Promise<Uint8Array> {
	const dir = await mkdtemp(join(tmpdir(), 'immich-pages-spike-avif-'));
	const inputPath = join(dir, `${randomUUID()}.png`);
	const outputPath = join(dir, `${randomUUID()}.avif`);
	try {
		await writeFile(inputPath, png16);
		await runFileProcess(process.env.SPIKE_AVIFENC_PATH ?? '/usr/bin/avifenc', ['--cicp', '9/16/9', '-d', '10', '-y', '420', '-r', 'full', '-q', '80', inputPath, outputPath], TIMEOUT_MS);
		return await readOutput(outputPath);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

/** cjxl accepts PPM directly but PPM carries no color metadata, so the PQ/Rec.2100 tagging has to be supplied as an explicit decode hint -- otherwise cjxl would silently assume sRGB and every HDR claim below would be fabricated. */
export async function encodeJxlHdr(ppm: Uint8Array): Promise<Uint8Array> {
	const dir = await mkdtemp(join(tmpdir(), 'immich-pages-spike-jxl-'));
	const inputPath = join(dir, `${randomUUID()}.ppm`);
	const outputPath = join(dir, `${randomUUID()}.jxl`);
	try {
		await writeFile(inputPath, ppm);
		await runFileProcess(process.env.SPIKE_CJXL_PATH ?? '/usr/bin/cjxl', [inputPath, outputPath, '-d', '1.0', '-x', 'color_space=RGB_D65_202_Rel_PeQ', '--intensity_target=1000'], TIMEOUT_MS);
		return await readOutput(outputPath);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

async function readOutput(path: string): Promise<Uint8Array> {
	const output = await readFile(path).catch(() => null);
	if (!output || output.byteLength === 0) throw new Error('spike-hdr-empty-output');
	if (output.byteLength > MAX_OUTPUT_BYTES) throw new Error('spike-hdr-output-limit');
	return output;
}

function runFileProcess(executable: string, args: string[], timeoutMs: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(executable, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true, shell: false });
		let stderr = '';
		let settled = false;
		const finish = (error?: Error) => { if (settled) return; settled = true; clearTimeout(timeout); if (error) reject(error); else resolve(); };
		const timeout = setTimeout(() => { child.kill('SIGKILL'); finish(new Error('spike-hdr-timeout')); }, timeoutMs);
		child.stderr.on('data', (chunk: Buffer) => { if (stderr.length < 4 * 1024) stderr += chunk.toString('utf8').slice(0, 4 * 1024 - stderr.length); });
		child.on('error', (error) => finish(new Error(`spike-hdr-spawn:${error.message}`)));
		child.on('close', (code) => code === 0 ? finish() : finish(new Error(`spike-hdr-exit:${code}:${stderr.slice(0, 200)}`)));
	});
}

function runPipedProcess(executable: string, args: string[], input: Uint8Array, timeoutMs = TIMEOUT_MS): Promise<Uint8Array> {
	return new Promise((resolve, reject) => {
		const child = spawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false });
		const chunks: Buffer[] = [];
		let bytes = 0;
		let stderr = '';
		let settled = false;
		const finish = (error?: Error) => { if (settled) return; settled = true; clearTimeout(timeout); if (error) reject(error); else resolve(Buffer.concat(chunks)); };
		const timeout = setTimeout(() => { child.kill('SIGKILL'); finish(new Error('spike-hdr-timeout')); }, timeoutMs);
		child.stdout.on('data', (chunk: Buffer) => { bytes += chunk.byteLength; if (bytes > MAX_OUTPUT_BYTES) { child.kill('SIGKILL'); finish(new Error('spike-hdr-output-limit')); return; } chunks.push(chunk); });
		child.stderr.on('data', (chunk: Buffer) => { if (stderr.length < 4 * 1024) stderr += chunk.toString('utf8').slice(0, 4 * 1024 - stderr.length); });
		child.on('error', (error) => finish(new Error(`spike-hdr-spawn:${error.message}`)));
		child.on('close', (code) => code === 0 && bytes > 0 ? finish() : finish(new Error(`spike-hdr-exit:${code}:${stderr.slice(0, 200)}`)));
		child.stdin.on('error', (error) => finish(error));
		child.stdin.end(input);
	});
}
