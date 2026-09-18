import { spawn } from 'node:child_process';

export const HDR_METADATA_TIMEOUT_MS = 2_000;
export const HDR_METADATA_MAX_OUTPUT_BYTES = 64 * 1024;
const APPLE_GAIN_MAP_TYPE = 'urn:com:apple:photo:2020:aux:hdrgainmap';

export type AppleHdrMetadata = {
	version: string;
	auxiliaryType: typeof APPLE_GAIN_MAP_TYPE;
	makerNote33: number;
	makerNote48: number;
	headroom: number;
	hdrGain: number;
	sourceProfile: 'display-p3' | 'rec709';
	sourceTransfer: 'srgb' | 'rec709';
	orientation: 1;
};

type ExifToolRecord = Record<string, unknown>;

export async function extractAppleHdrMetadata(
	input: Uint8Array,
	options: { executable?: string; timeoutMs?: number } = {}
): Promise<AppleHdrMetadata | undefined> {
	if (input.byteLength === 0) return undefined;
	const output = await runExifTool(options.executable ?? '/usr/bin/exiftool', input, options.timeoutMs ?? HDR_METADATA_TIMEOUT_MS);
	try {
		const parsed: unknown = JSON.parse(output);
		if (!Array.isArray(parsed) || parsed.length !== 1 || !parsed[0] || typeof parsed[0] !== 'object') return undefined;
		return normalizeAppleMetadata(parsed[0] as ExifToolRecord);
	} catch {
		return undefined;
	}
}

export function normalizeAppleMetadata(record: ExifToolRecord): AppleHdrMetadata | undefined {
	const auxiliaryType = findString(record, (key) => key === 'AuxiliaryImageType' || key.endsWith(':AuxiliaryImageType'));
	if (auxiliaryType !== APPLE_GAIN_MAP_TYPE) return undefined;
	const version = findString(record, (key) => key === 'HDRGainMapVersion' || key.endsWith(':HDRGainMapVersion'));
	if (!version || !/^\d+(?:\.\d+)?$/.test(version)) return undefined;
	const makerNote33 = findNumericKey(record, '33');
	const makerNote48 = findNumericKey(record, '48');
	if (!validMakerNote(makerNote33) || !validMakerNote(makerNote48)) return undefined;
	const sourceProfile = normalizeProfile(findString(record, (key) => key === 'ProfileName' || key.endsWith(':ProfileName')) ?? findString(record, (key) => key === 'ColorSpace' || key.endsWith(':ColorSpace')));
	if (!sourceProfile) return undefined;
	const sourceTransfer = normalizeTransfer(findString(record, (key) => key === 'TransferFunction' || key.endsWith(':TransferFunction')) ?? sourceProfile);
	if (!sourceTransfer) return undefined;
	const orientation = findNumericKey(record, 'Orientation') ?? findNumericKey(record, 'Orientation#');
	if (orientation !== 1) return undefined;
	const headroom = appleHeadroom(makerNote33, makerNote48);
	return { version, auxiliaryType: APPLE_GAIN_MAP_TYPE, makerNote33, makerNote48, headroom, hdrGain: makerNote48, sourceProfile, sourceTransfer, orientation };
}

export function appleHeadroom(makerNote33: number, makerNote48: number): number {
	const stops = makerNote33 < 1
		? makerNote48 <= 0.01 ? -20 * makerNote48 + 1.8 : -0.101 * makerNote48 + 1.601
		: makerNote48 <= 0.01 ? -70 * makerNote48 + 3 : -0.303 * makerNote48 + 2.303;
	return 2 ** Math.max(stops, 0);
}

function validMakerNote(value: number | undefined): value is number {
	return value !== undefined && Number.isFinite(value) && value >= 0 && value <= 1000;
}

function normalizeProfile(value: string | undefined): AppleHdrMetadata['sourceProfile'] | undefined {
	if (!value) return undefined;
	if (/display[- ]?p3|p3-d65/i.test(value)) return 'display-p3';
	if (/rec.?709|srgb|bt.?709/i.test(value)) return 'rec709';
	return undefined;
}

function normalizeTransfer(value: string | undefined): AppleHdrMetadata['sourceTransfer'] | undefined {
	if (!value) return undefined;
	if (/srgb|display[- ]?p3/i.test(value)) return 'srgb';
	if (/rec.?709|bt.?709/i.test(value)) return 'rec709';
	return undefined;
}

function findString(record: ExifToolRecord, match: (key: string) => boolean): string | undefined {
	const value = findValue(record, match);
	return typeof value === 'string' ? value : undefined;
}

function findNumericKey(record: ExifToolRecord, key: string): number | undefined {
	const value = findValue(record, (candidate) => candidate === key || candidate.endsWith(`:${key}`));
	return typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : undefined;
}

function findValue(value: unknown, match: (key: string) => boolean): unknown {
	if (!value || typeof value !== 'object') return undefined;
	for (const [key, nested] of Object.entries(value)) {
		if (match(key)) return nested;
		const found = findValue(nested, match);
		if (found !== undefined) return found;
	}
	return undefined;
}

function runExifTool(executable: string, input: Uint8Array, timeoutMs: number): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn(executable, ['-json', '-G1', '-s', '-n', '-HDRGainMapVersion', '-MakerNotes', '-AuxiliaryImageType', '-ProfileName', '-ColorSpace', '-TransferFunction', '-Orientation', '-'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false });
		const chunks: Buffer[] = [];
		let bytes = 0;
		let settled = false;
		const finish = (error?: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			if (error) reject(error); else resolve(Buffer.concat(chunks).toString('utf8'));
		};
		const timeout = setTimeout(() => { child.kill('SIGKILL'); finish(new Error('hdr-metadata-timeout')); }, timeoutMs);
		child.stdout.on('data', (chunk: Buffer) => {
			bytes += chunk.byteLength;
			if (bytes > HDR_METADATA_MAX_OUTPUT_BYTES) { child.kill('SIGKILL'); finish(new Error('hdr-metadata-output-limit')); return; }
			chunks.push(chunk);
		});
		child.on('error', (error) => finish(new Error(`hdr-metadata-spawn:${error.message}`)));
		child.on('close', (code) => code === 0 && bytes > 0 ? finish() : finish(new Error('hdr-metadata-failed')));
		child.stdin.on('error', (error) => finish(error));
		child.stdin.end(input);
	});
}
