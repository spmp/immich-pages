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
	{ slug: 'jxl-hdr.jxl', contentType: 'image/jxl', tag: 'img', label: 'JPEG XL, Rec.2100 PQ, intensity_target 1000 nits -- Safari-only decode, no known SDR fallback' },
	{ slug: 'ultrahdr.jpg', contentType: 'image/jpeg', tag: 'img', label: 'Ultra HDR JPEG (ISO 21496-1 gain-map), built via libultrahdr -- real gain map, graceful SDR fallback by design; see spike 002' },
	{ slug: 'avif-sdr-p3.avif', contentType: 'image/avif', tag: 'img', label: 'AVIF, plain SDR, Display P3 preserved (no BT.2020 conversion), no gain map -- control image for the pair below' },
	{ slug: 'avif-gainmap-p3.avif', contentType: 'image/avif', tag: 'img', label: 'AVIF with real ISO 21496-1 gain map via libavif, Display P3 preserved -- should match avif-sdr-p3 exactly where unsupported; see spike 005 for an open question about the headroom metadata field' }
] as const;
export type SpikeFormatSlug = (typeof SPIKE_FORMATS)[number]['slug'];

const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const TIMEOUT_MS = 60_000;

export type SpikeStillFormat = 'avif-hdr' | 'jxl-hdr';

/** Spike 004: bounded, opt-in overrides for live tuning against real screens. Both default to
 * the exact unmodified Apple-derived behavior when undefined -- see
 * hdr-gainmap-compositor-tunable.cpp's header comment for why these exist and why they're a
 * separate binary from the production compositor rather than new flags on it. */
export type GainMapOverrides = { headroom?: number; gamma?: number };

export function parseGainMapOverrides(searchParams: URLSearchParams): GainMapOverrides {
	const headroomRaw = Number(searchParams.get('headroom'));
	const gammaRaw = Number(searchParams.get('gamma'));
	const overrides: GainMapOverrides = {};
	if (Number.isFinite(headroomRaw) && headroomRaw >= 1 && headroomRaw <= 16) overrides.headroom = headroomRaw;
	if (Number.isFinite(gammaRaw) && gammaRaw >= 0.1 && gammaRaw <= 10) overrides.gamma = gammaRaw;
	return overrides;
}

function overrideArgs(overrides: GainMapOverrides): string[] {
	const args: string[] = [];
	if (overrides.headroom !== undefined) args.push('--headroom-override', String(overrides.headroom));
	if (overrides.gamma !== undefined) args.push('--gain-gamma', String(overrides.gamma));
	return args;
}

/** PPM carries no color tags; ffmpeg's own HDR mp4 path already treats these pixels as PQ/BT.2020 (see hdr-compositor.ts encodeHdrMp4), so every still candidate below tags the same primaries/transfer rather than guessing a different one. */
export async function composeHdrPpm(input: Uint8Array, metadata: AppleHdrMetadata): Promise<Uint8Array> {
	return composeHdr(input, metadata);
}

/** scripts/hdr-gainmap-compositor-tunable.cpp: a spike-only fork used only when the request asks
 * for a headroom/gamma override, so the default (no query params) path keeps using the real,
 * unmodified production compositor via composeHdrPpm above. */
export async function composeHdrPpmTunable(input: Uint8Array, metadata: AppleHdrMetadata, overrides: GainMapOverrides): Promise<Uint8Array> {
	const executable = process.env.SPIKE_TUNABLE_COMPOSITOR_PATH ?? '/usr/local/bin/hdr-gainmap-compositor-tunable';
	const args = ['--hdr-version', metadata.version, '--maker-note-33', String(metadata.makerNote33), '--maker-note-48', String(metadata.makerNote48), '--source-profile', metadata.sourceProfile, '--source-transfer', metadata.sourceTransfer, '--orientation', String(metadata.orientation), ...overrideArgs(overrides)];
	return runPipedProcess(executable, args, input, TIMEOUT_MS);
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

/** scripts/hdr-test-chart.cpp: two synthetic, deterministic chart designs, neither depending on
 * a real photo or Apple metadata.
 * 'ladder' (spike 003): a no-boost control patch beside a 1.5x-6x boost ladder -- a flat result
 *   means the decoder ignored the gain map outright, a graduated one tells you how many steps
 *   actually render.
 * 'text' (spike 004): bold block letters "HDR" at a fixed 4x boost against a flat mid-gray
 *   background with no ladder to read -- an abrupt, binary, spatial reveal of whether (and where)
 *   the gain map got applied at all.
 * --mode *-ppm matches composeHdr's PQ-encoded PPM contract (feeds the same avif/jxl/video
 * pipeline as the real fixtures); --mode *-ultrahdr emits the Ultra HDR JPEG directly via
 * libultrahdr. */
export type SyntheticChartKind = 'ladder' | 'text';

export async function composeTestChartPpm(kind: SyntheticChartKind): Promise<Uint8Array> {
	return runPipedProcess(process.env.SPIKE_TEST_CHART_PATH ?? '/usr/local/bin/hdr-test-chart', ['--mode', kind === 'text' ? 'text-ppm' : 'ppm'], new Uint8Array(0), TIMEOUT_MS);
}

export async function encodeTestChartUltraHdrJpeg(kind: SyntheticChartKind): Promise<Uint8Array> {
	return runPipedProcess(process.env.SPIKE_TEST_CHART_PATH ?? '/usr/local/bin/hdr-test-chart', ['--mode', kind === 'text' ? 'text-ultrahdr' : 'ultrahdr'], new Uint8Array(0), TIMEOUT_MS);
}

export async function encodeTestChartSdrJpeg(kind: SyntheticChartKind): Promise<Uint8Array> {
	const chartPath = process.env.SPIKE_TEST_CHART_PATH ?? '/usr/local/bin/hdr-test-chart';
	const ppm = await runPipedProcess(chartPath, ['--mode', kind === 'text' ? 'text-sdr-ppm' : 'sdr-ppm'], new Uint8Array(0), TIMEOUT_MS);
	return runPipedProcess(process.env.SPIKE_FFMPEG_PATH ?? '/usr/bin/ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-vcodec', 'ppm', '-i', 'pipe:0', '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', '2', 'pipe:1'], ppm);
}

/** scripts/hdr-ultrahdr-compositor.cpp reuses the exact same Apple gain-map reconstruction as
 * composeHdr (see its header comment), then hands libultrahdr a linear HDR buffer and the plain
 * SDR buffer directly and lets the reference encoder compute the ISO 21496-1 gain map and emit
 * the finished JPEG -- so, unlike the other still candidates, this needs no separate PPM/PNG
 * conversion step; the native program's stdout is already the final JPEG bytes. */
export async function encodeUltraHdrJpeg(input: Uint8Array, metadata: AppleHdrMetadata, overrides: GainMapOverrides = {}): Promise<Uint8Array> {
	const executable = process.env.SPIKE_ULTRAHDR_COMPOSITOR_PATH ?? '/usr/local/bin/hdr-ultrahdr-compositor';
	const args = ['--hdr-version', metadata.version, '--maker-note-33', String(metadata.makerNote33), '--maker-note-48', String(metadata.makerNote48), '--source-profile', metadata.sourceProfile, '--source-transfer', metadata.sourceTransfer, '--orientation', String(metadata.orientation), ...overrideArgs(overrides)];
	return runPipedProcess(executable, args, input, TIMEOUT_MS);
}

/** scripts/hdr-avif-gainmap-compositor.cpp (spike 005): unlike avif-hdr.avif (spike 001, raw
 * PQ, no gain map, forced BT.2020), this preserves the source's real color primaries (Display P3
 * or Rec.709, never converted) and offers two modes sharing the same decode: --mode sdr emits a
 * plain no-HDR-claim AVIF as a control image, --mode gainmap attaches a real ISO 21496-1 gain map
 * via libavif's avifRGBImageComputeGainMap. Both should look identical on any decoder that
 * doesn't apply the gain map -- that's the actual test. */
export async function encodeAvifSdrP3(input: Uint8Array, metadata: AppleHdrMetadata): Promise<Uint8Array> {
	const executable = process.env.SPIKE_AVIF_GAINMAP_COMPOSITOR_PATH ?? '/usr/local/bin/hdr-avif-gainmap-compositor';
	const args = ['--mode', 'sdr', '--hdr-version', metadata.version, '--maker-note-33', String(metadata.makerNote33), '--maker-note-48', String(metadata.makerNote48), '--source-profile', metadata.sourceProfile, '--source-transfer', metadata.sourceTransfer, '--orientation', String(metadata.orientation)];
	return runPipedProcess(executable, args, input, TIMEOUT_MS);
}

export async function encodeAvifGainmapP3(input: Uint8Array, metadata: AppleHdrMetadata): Promise<Uint8Array> {
	const executable = process.env.SPIKE_AVIF_GAINMAP_COMPOSITOR_PATH ?? '/usr/local/bin/hdr-avif-gainmap-compositor';
	const args = ['--mode', 'gainmap', '--hdr-version', metadata.version, '--maker-note-33', String(metadata.makerNote33), '--maker-note-48', String(metadata.makerNote48), '--source-profile', metadata.sourceProfile, '--source-transfer', metadata.sourceTransfer, '--orientation', String(metadata.orientation)];
	return runPipedProcess(executable, args, input, TIMEOUT_MS);
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
