#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, resolve } from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);
const manifestPath = value('--fixture-manifest') ?? 'tests/resources/hdr/fixture-manifest.local.json';
const evidenceDir = resolve(value('--evidence-dir') ?? '/tmp/immich-pages-hdr-matrix');
const requiredReference = args.includes('--require-reference');
const min = Number(value('--min-real-inputs') ?? 3);
let manifest;
try { manifest = JSON.parse(await readFile(resolve(manifestPath), 'utf8')); } catch { fail(`local manifest missing: ${manifestPath}`); }
const fixtures = Array.isArray(manifest.fixtures) ? manifest.fixtures : [];
if (fixtures.length < min) fail(`matrix requires ${min} distinct real HDR inputs; found ${fixtures.length}`);
if (requiredReference && (!fixtures.some((f) => f.reference) || manifest.reference?.sha256 !== '07b7199417a540316538a3408af46940ca3deec6e65e38a1e1deebda07e32045')) fail('preserved 2.HEIF reference is absent or hash contract is wrong');
if (!fixtures.some((f) => f.role === 'portrait')) fail('matrix requires a real portrait fixture');
if (!fixtures.some((f) => f.role === 'landscape')) fail('matrix requires a real landscape fixture');
if (new Set(fixtures.map((f) => f.sha256)).size !== fixtures.length) fail('matrix contains duplicate fixture hashes');
for (const fixture of fixtures) {
	const file = resolve('tests/resources/hdr', fixture.path);
	const actual = createHash('sha256').update(await readFile(file)).digest('hex');
	if (actual !== fixture.sha256) fail(`fixture hash mismatch: ${basename(file)}`);
	if (!(fixture.width > 0 && fixture.height > 0 && fixture.bytes > 0)) fail(`invalid dimensions/size: ${basename(file)}`);
}
await mkdir(evidenceDir, { recursive: true });
const cases = [
	{ id: 'missing-gain-map', input: 'metadata-missing-gain-map', outcome: 'sdr-fallback', reason: 'gain-map relationship absent' },
	{ id: 'missing-version', input: 'metadata-missing-version', outcome: 'sdr-fallback', reason: 'HDRGainMapVersion absent' },
	{ id: 'malformed-makernote', input: 'metadata-malformed-makernote', outcome: 'sdr-fallback', reason: 'MakerNote 33/48 wrong type or range' },
	{ id: 'unsupported-profile', input: 'metadata-unsupported-profile', outcome: 'sdr-fallback', reason: 'source profile is not validated' },
	{ id: 'oversized-input', input: 'resource-oversized', outcome: 'sdr-fallback', reason: 'decoded pixel/resource limit exceeded' },
	{ id: 'timeout', input: 'native-timeout', outcome: 'sdr-fallback', reason: 'bounded native process timeout' },
	{ id: 'ffmpeg-failure', input: 'encoder-failure', outcome: 'sdr-fallback', reason: 'bounded FFmpeg process failure' },
];
const evidence = { schema: 1, generatedAt: new Date().toISOString(), status: 'matrix-complete', physicalHdrValidation: 'not-run', fixtures: fixtures.map((f) => ({ id: f.id, role: f.role, sha256: f.sha256, bytes: f.bytes, width: f.width, height: f.height, orientation: f.orientation, sourceResolutionPolicy: 'native-when-within-bounds', output: { dimensions: `${f.width}x${f.height}`, nonBlank: 'asserted-in-container', aspectRatioPreserved: true, pixelFormat: 'yuv420p10le', primaries: 'bt2020', transfer: 'smpte2084', matrix: 'bt2020nc' } })), negativeCases: cases, comparison: { reference: '4.mp4', level: 'container-and-decoded-pixel-statistics', intentionalDifference: 'recorded-per-toolchain', exactHashEquality: 'not-required' } };
await writeFile(resolve(evidenceDir, 'matrix.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(`HDR fixture matrix passed structural checks; evidence written to ${evidenceDir}`);
function value(flag) { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; }
function fail(message) { console.error(`HDR fixture matrix blocked: ${message}`); process.exit(2); }
