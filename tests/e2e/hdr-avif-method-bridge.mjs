#!/usr/bin/env node
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const method = args.includes('-json')
  ? 'extractAppleHdrMetadata'
  : args.includes('--mode')
    ? 'decodeHdrAvif'
    : 'encodeHdrAvif';
const logPath = process.env.HDR_BRIDGE_LOG;
if (logPath) appendFileSync(logPath, `${JSON.stringify({ method, assetId: process.env.HDR_BRIDGE_ASSET_ID ?? null })}\n`);

if (method === 'extractAppleHdrMetadata') {
	process.stdin.resume();
	process.stdout.write(JSON.stringify([{
		AuxiliaryImageType: 'urn:com:apple:photo:2020:aux:hdrgainmap',
		HDRGainMapVersion: '1.0',
		MakerNotes: { '33': 0.5, '48': 0.5 },
		ProfileName: 'Display P3',
		TransferFunction: 'sRGB',
		Orientation: 1
	}]));
} else if (method === 'decodeHdrAvif') {
	// The encode contract is tested end-to-end; this is a tiny valid RGBA stream with the same
	// 16-byte header as hdr-avif-decode. The browser-visible output is generated below by avifenc.
	const width = 2;
	const height = 2;
	const header = Buffer.alloc(16);
	header.writeUInt32LE(width, 0);
	header.writeUInt32LE(height, 4);
	header.writeUInt32LE(0, 8);
	header.writeUInt32LE(0, 12);
	const pixel = Buffer.from([
		255, 80, 40, 255, 255, 80, 40, 255,
		255, 80, 40, 255, 255, 80, 40, 255
	]);
	process.stdin.resume();
	process.stdout.write(Buffer.concat([header, pixel]));
} else {
	const workspace = mkdtempSync(join(tmpdir(), 'immich-pages-avif-'));
	const input = fileURLToPath(new URL('../fixtures/images/landscape-1200x800.png', import.meta.url));
	const output = join(workspace, 'output.avif');
	const result = spawnSync('avifenc', ['--lossless', input, output], { stdio: ['ignore', 'ignore', 'pipe'] });
	if (result.status !== 0) {
		process.stderr.write(result.stderr?.toString() ?? 'avifenc failed');
		process.exit(result.status ?? 1);
	}
	process.stdout.write(readFileSync(output));
	rmSync(workspace, { recursive: true, force: true });
}
