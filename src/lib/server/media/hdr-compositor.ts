import { spawn } from 'node:child_process';
import type { AppleHdrMetadata } from './hdr-metadata';

function positiveEnv(name: string, fallback: number, maximum: number): number {
	const value = Number(process.env[name]);
	return Number.isFinite(value) && value > 0 ? Math.min(Math.trunc(value), maximum) : fallback;
}

export const HDR_COMPOSITOR_TIMEOUT_MS = positiveEnv('HDR_COMPOSITOR_TIMEOUT_MS', 8_000, 120_000);
export const HDR_COMPOSITOR_MAX_INPUT_BYTES = 100 * 1024 * 1024;
export const HDR_COMPOSITOR_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
export const HDR_FFMPEG_TIMEOUT_MS = positiveEnv('HDR_FFMPEG_TIMEOUT_MS', 8_000, 120_000);
export const HDR_FFMPEG_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
export const HDR_AVIF_DECODE_TIMEOUT_MS = positiveEnv('HDR_AVIF_DECODE_TIMEOUT_MS', 8_000, 120_000);
// The decode stage's output is an uncompressed intermediate (SDR 8-bit RGBA + HDR 16-bit
// half-float RGBA, ~109MB for a 4032x2268 photo) piped straight into the encode stage, never
// stored or cached -- a generous bound here is fine.
export const HDR_AVIF_DECODE_MAX_OUTPUT_BYTES = 256 * 1024 * 1024;
export const HDR_AVIF_ENCODE_TIMEOUT_MS = positiveEnv('HDR_AVIF_ENCODE_TIMEOUT_MS', 8_000, 120_000);
export const HDR_AVIF_ENCODE_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
export type NativeFailureReason = 'read' | 'primary-decode' | 'gain-map-missing' | 'gain-map-decode' | 'metadata-invalid' | 'ffmpeg' | 'compositor-timeout' | 'ffmpeg-timeout' | 'compositor-spawn' | 'ffmpeg-spawn' | 'compositor-exit' | 'ffmpeg-exit' | 'avif-decode-timeout' | 'avif-encode-timeout' | 'avif-decode-spawn' | 'avif-encode-spawn' | 'avif-decode-exit' | 'avif-encode-exit' | 'unknown';

export async function composeHdr(input: Uint8Array, metadata: AppleHdrMetadata, options: { executable?: string; timeoutMs?: number; invocationId?: string } = {}): Promise<Uint8Array> {
	if (input.byteLength === 0 || input.byteLength > HDR_COMPOSITOR_MAX_INPUT_BYTES) throw new Error('hdr-input-limit');
	if (!metadata || metadata.auxiliaryType !== 'urn:com:apple:photo:2020:aux:hdrgainmap' || !Number.isFinite(metadata.makerNote33) || !Number.isFinite(metadata.makerNote48)) throw new Error('hdr-metadata-invalid');
	const executable = options.executable ?? process.env.HDR_COMPOSITOR_PATH ?? '/usr/local/bin/hdr-gainmap-compositor';
	const args = ['--hdr-version', metadata.version, '--maker-note-33', String(metadata.makerNote33), '--maker-note-48', String(metadata.makerNote48), '--source-profile', metadata.sourceProfile, '--source-transfer', metadata.sourceTransfer, '--orientation', String(metadata.orientation)];
	return runBoundedProcess(executable, args, input, HDR_COMPOSITOR_MAX_OUTPUT_BYTES, options.timeoutMs ?? HDR_COMPOSITOR_TIMEOUT_MS, 'hdr-compositor', options.invocationId);
}

export async function encodeHdrMp4(input: Uint8Array, options: { executable?: string; timeoutMs?: number; invocationId?: string } = {}): Promise<Uint8Array> {
	if (input.byteLength === 0 || input.byteLength > HDR_COMPOSITOR_MAX_OUTPUT_BYTES) throw new Error('hdr-input-limit');
	const executable = options.executable ?? process.env.HDR_FFMPEG_PATH ?? '/usr/bin/ffmpeg';
	// This is one still frame standing in for a full-size photo, not streaming video -- file size
	// from a lower CRF is negligible (one frame), but the default CRF 28 (tuned for multi-frame
	// streaming bitrate budgets) was visibly lossy once anyone looked closely/zoomed in. crf 16
	// measured ~QP 18 either way; preset slow (~2.5-5s under load) cut it too close against
	// HDR_FFMPEG_TIMEOUT_MS's 8s default on a loaded host -- preset medium hits the same QP/quality
	// in roughly half the time, so it's the safer choice for the same visual result.
	const args = ['-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-vcodec', 'ppm', '-i', 'pipe:0', '-frames:v', '1', '-an', '-c:v', 'libx265', '-preset', 'medium', '-crf', '16', '-profile:v', 'main10', '-pix_fmt', 'yuv420p10le', '-color_primaries', 'bt2020', '-color_trc', 'smpte2084', '-colorspace', 'bt2020nc', '-x265-params', 'colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc', '-tag:v', 'hvc1', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', 'pipe:1'];
	return runBoundedProcess(executable, args, input, HDR_FFMPEG_MAX_OUTPUT_BYTES, options.timeoutMs ?? HDR_FFMPEG_TIMEOUT_MS, 'hdr-ffmpeg', options.invocationId);
}

/** Decode stage of the two-process AVIF gain-map pipeline (see scripts/hdr-avif-decode.cpp):
 * reads the source HEIC directly (independent of composeHdr's PPM path) and Apple's gain-map
 * metadata, and emits a raw RGBA(+half-float) stream for hdr-avif-encode to consume. Links only
 * libheif; the encode stage links only libavif -- kept as two single-library binaries for the
 * same one-native-contract-per-concern reason composeHdr/encodeHdrMp4 already are. */
export async function decodeHdrAvifStream(input: Uint8Array, metadata: AppleHdrMetadata, options: { executable?: string; timeoutMs?: number; invocationId?: string } = {}): Promise<Uint8Array> {
	if (input.byteLength === 0 || input.byteLength > HDR_COMPOSITOR_MAX_INPUT_BYTES) throw new Error('hdr-input-limit');
	if (!metadata || metadata.auxiliaryType !== 'urn:com:apple:photo:2020:aux:hdrgainmap' || !Number.isFinite(metadata.makerNote33) || !Number.isFinite(metadata.makerNote48)) throw new Error('hdr-metadata-invalid');
	const executable = options.executable ?? process.env.HDR_AVIF_DECODE_PATH ?? '/usr/local/bin/hdr-avif-decode';
	const args = ['--mode', 'gainmap', '--hdr-version', metadata.version, '--maker-note-33', String(metadata.makerNote33), '--maker-note-48', String(metadata.makerNote48), '--source-profile', metadata.sourceProfile, '--source-transfer', metadata.sourceTransfer, '--orientation', String(metadata.orientation)];
	return runBoundedProcess(executable, args, input, HDR_AVIF_DECODE_MAX_OUTPUT_BYTES, options.timeoutMs ?? HDR_AVIF_DECODE_TIMEOUT_MS, 'hdr-avif-decode', options.invocationId);
}

/** Encode stage: consumes hdr-avif-decode's stream and produces a single Display-P3-preserving
 * AVIF with a real ISO 21496-1-style gain map, gracefully SDR-degrading on any decoder that
 * doesn't understand the gain map (see scripts/hdr-avif-encode.cpp header comment). */
export async function encodeHdrAvif(stream: Uint8Array, metadata: AppleHdrMetadata, options: { executable?: string; timeoutMs?: number; invocationId?: string } = {}): Promise<Uint8Array> {
	if (stream.byteLength === 0 || stream.byteLength > HDR_AVIF_DECODE_MAX_OUTPUT_BYTES) throw new Error('hdr-input-limit');
	const executable = options.executable ?? process.env.HDR_AVIF_ENCODE_PATH ?? '/usr/local/bin/hdr-avif-encode';
	const args = ['--source-profile', metadata.sourceProfile, '--source-transfer', metadata.sourceTransfer];
	return runBoundedProcess(executable, args, stream, HDR_AVIF_ENCODE_MAX_OUTPUT_BYTES, options.timeoutMs ?? HDR_AVIF_ENCODE_TIMEOUT_MS, 'hdr-avif-encode', options.invocationId);
}

function runBoundedProcess(executable: string, args: string[], input: Uint8Array, maxOutputBytes: number, timeoutMs: number, failurePrefix: string, invocationId?: string): Promise<Uint8Array> {
	return new Promise((resolve, reject) => {
		const child = spawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false, env: invocationId ? { ...process.env, HDR_BRIDGE_ASSET_ID: invocationId } : process.env });
		const chunks: Buffer[] = [];
		let bytes = 0;
		let stderr = '';
		let stderrBytes = 0;
		let settled = false;
		const finish = (error?: Error) => { if (settled) return; settled = true; clearTimeout(timeout); if (error) reject(error); else resolve(Buffer.concat(chunks)); };
		const timeout = setTimeout(() => { child.kill('SIGKILL'); finish(new Error(`${failurePrefix}-timeout`)); }, timeoutMs);
		child.stdout.on('data', (chunk: Buffer) => { bytes += chunk.byteLength; if (bytes > maxOutputBytes) { child.kill('SIGKILL'); finish(new Error(`${failurePrefix}-output-limit`)); return; } chunks.push(chunk); });
		child.stderr.on('data', (chunk: Buffer) => { stderrBytes += chunk.byteLength; if (stderr.length < 16 * 1024) stderr += chunk.toString('utf8').slice(0, 16 * 1024 - stderr.length); if (stderrBytes > 16 * 1024) child.stderr.destroy(); });
		child.on('error', (error) => finish(new Error(`${failurePrefix}-spawn:${error.message}`)));
		child.on('close', (code, signal) => code === 0 && bytes > 0 ? finish() : finish(new Error(`${failurePrefix}-failed:${classifyNativeFailure(stderr, failurePrefix, code, signal)}:${safeNativeDetail(stderr) || `exit-${code ?? signal ?? 'unknown'}`}`)));
		child.stdin.on('error', (error) => finish(error));
		child.stdin.end(input);
	});
}

export function nativeFailureReason(error: unknown): NativeFailureReason {
	if (!(error instanceof Error)) return 'unknown';
	if (error.message.startsWith('hdr-compositor-timeout')) return 'compositor-timeout';
	if (error.message.startsWith('hdr-ffmpeg-timeout')) return 'ffmpeg-timeout';
	if (error.message.startsWith('hdr-compositor-spawn')) return 'compositor-spawn';
	if (error.message.startsWith('hdr-ffmpeg-spawn')) return 'ffmpeg-spawn';
	if (error.message.startsWith('hdr-avif-decode-timeout')) return 'avif-decode-timeout';
	if (error.message.startsWith('hdr-avif-encode-timeout')) return 'avif-encode-timeout';
	if (error.message.startsWith('hdr-avif-decode-spawn')) return 'avif-decode-spawn';
	if (error.message.startsWith('hdr-avif-encode-spawn')) return 'avif-encode-spawn';
	const reason = error.message.match(/failed:([a-z-]+):/)?.[1];
	return reason && ['read', 'primary-decode', 'gain-map-missing', 'gain-map-decode', 'metadata-invalid', 'ffmpeg', 'compositor-timeout', 'ffmpeg-timeout', 'compositor-spawn', 'ffmpeg-spawn', 'compositor-exit', 'ffmpeg-exit', 'avif-decode-timeout', 'avif-encode-timeout', 'avif-decode-spawn', 'avif-encode-spawn', 'avif-decode-exit', 'avif-encode-exit', 'unknown'].includes(reason) ? reason as NativeFailureReason : 'unknown';
}

export function nativeFailureDetail(error: unknown): string | undefined {
	if (!(error instanceof Error)) return undefined;
	return error.message.match(/failed:[a-z-]+:(.*)$/)?.[1] || undefined;
}

function safeNativeDetail(stderr: string): string { return stderr.replace(/[^A-Za-z0-9 .,_()\[\]-]/g, '?').replace(/\s+/g, ' ').trim().slice(0, 160); }
function classifyNativeFailure(stderr: string, processName: string, code: number | null, signal: NodeJS.Signals | null): NativeFailureReason {
	if (processName === 'hdr-ffmpeg') return 'ffmpeg';
	if (/read HEIF/i.test(stderr)) return 'read';
	if (/decode primary image/i.test(stderr)) return 'primary-decode';
	if (/gain map auxiliary image not found/i.test(stderr)) return 'gain-map-missing';
	if (/decode gain map/i.test(stderr)) return 'gain-map-decode';
	if (/metadata|version|profile|orientation/i.test(stderr)) return 'metadata-invalid';
	if (processName === 'hdr-avif-decode') return 'avif-decode-exit';
	if (processName === 'hdr-avif-encode') return 'avif-encode-exit';
	return signal ? 'compositor-exit' : code === 0 ? 'unknown' : 'compositor-exit';
}
