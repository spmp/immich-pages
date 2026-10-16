#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const method = args.includes('-json')
	? 'extractAppleHdrMetadata'
	: args.includes('pipe:0')
		? 'encodeHdrMp4'
		: 'composeHdr';
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
} else if (method === 'composeHdr') {
	process.stdin.on('data', (chunk) => process.stdout.write(chunk));
} else {
	process.stdin.resume();
	const delayMs = Number(process.env.HDR_BRIDGE_ENCODE_DELAY_MS);
	if (Number.isFinite(delayMs) && delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
	const outputPath = args.at(-1);
	if (!outputPath) process.exit(2);
	writeFileSync(outputPath, readFileSync(fileURLToPath(new URL('../fixtures/video/chromium-2s-320x180-h264-aac.mp4', import.meta.url))));
}
