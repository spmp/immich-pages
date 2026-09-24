import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

function positiveEnv(name: string, fallback: number, maximum: number): number {
	const value = Number(process.env[name]);
	return Number.isFinite(value) && value > 0 ? Math.min(Math.trunc(value), maximum) : fallback;
}

export const SDR_CONVERT_TIMEOUT_MS = positiveEnv('SDR_CONVERT_TIMEOUT_MS', 8_000, 60_000);
export const SDR_CONVERT_MAX_INPUT_BYTES = 100 * 1024 * 1024;
export const SDR_CONVERT_MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
export const SDR_CONVERT_QUALITY = positiveEnv('SDR_CONVERT_QUALITY', 88, 100);

export type SdrConvertFailureReason = 'input-limit' | 'spawn' | 'timeout' | 'exit' | 'empty-output' | 'output-limit';

export class SdrConvertError extends Error {
	reason: SdrConvertFailureReason;
	constructor(reason: SdrConvertFailureReason, message: string) {
		super(message);
		this.name = 'SdrConvertError';
		this.reason = reason;
	}
}

/**
 * Converts a decodable HEIC/HEIF original into a browser-displayable JPEG via libheif's
 * heif-convert. Unlike the HDR native tools, heif-convert only accepts real filesystem paths
 * (no stdio piping), so this writes to a per-call random temp directory and always removes it.
 */
export async function convertHeicToJpeg(input: Uint8Array, options: { executable?: string; timeoutMs?: number; quality?: number } = {}): Promise<Uint8Array> {
	if (input.byteLength === 0 || input.byteLength > SDR_CONVERT_MAX_INPUT_BYTES) throw new SdrConvertError('input-limit', 'sdr-convert-input-limit');
	const executable = options.executable ?? process.env.SDR_HEIC_CONVERTER_PATH ?? '/usr/bin/heif-convert';
	const quality = String(Math.min(100, Math.max(1, Math.trunc(options.quality ?? SDR_CONVERT_QUALITY))));
	const timeoutMs = options.timeoutMs ?? SDR_CONVERT_TIMEOUT_MS;
	const dir = await mkdtemp(join(tmpdir(), 'immich-pages-sdr-'));
	const inputPath = join(dir, `${randomUUID()}.heic`);
	const outputPath = join(dir, `${randomUUID()}.jpg`);
	try {
		await writeFile(inputPath, input);
		await runHeifConvert(executable, ['-q', quality, '-o', outputPath, inputPath], timeoutMs);
		const output = await readFile(outputPath).catch(() => null);
		if (!output || output.byteLength === 0) throw new SdrConvertError('empty-output', 'sdr-convert-empty-output');
		if (output.byteLength > SDR_CONVERT_MAX_OUTPUT_BYTES) throw new SdrConvertError('output-limit', 'sdr-convert-output-limit');
		return output;
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

function runHeifConvert(executable: string, args: string[], timeoutMs: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(executable, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true, shell: false });
		let stderr = '';
		let settled = false;
		const finish = (error?: Error) => { if (settled) return; settled = true; clearTimeout(timeout); if (error) reject(error); else resolve(); };
		const timeout = setTimeout(() => { child.kill('SIGKILL'); finish(new SdrConvertError('timeout', 'sdr-convert-timeout')); }, timeoutMs);
		child.stderr.on('data', (chunk: Buffer) => { if (stderr.length < 4 * 1024) stderr += chunk.toString('utf8').slice(0, 4 * 1024 - stderr.length); });
		child.on('error', (error) => finish(new SdrConvertError('spawn', `sdr-convert-spawn:${error.message}`)));
		child.on('close', (code) => (code === 0 ? finish() : finish(new SdrConvertError('exit', `sdr-convert-exit:${code}:${safeDetail(stderr)}`))));
	});
}

function safeDetail(stderr: string): string {
	return stderr.replace(/[^A-Za-z0-9 .,_()[\]-]/g, '?').replace(/\s+/g, ' ').trim().slice(0, 160);
}
