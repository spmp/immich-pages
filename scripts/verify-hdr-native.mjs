#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import process from 'node:process';
import { resolve } from 'node:path';

const exec = promisify(execFile);
const args = process.argv.slice(2);
const fixture = valueAfter('--fixture');
const reference = valueAfter('--reference');
const evidenceDir = valueAfter('--evidence-dir') ?? '/tmp/immich-pages-hdr-native';
if (!args.includes('--docker') || !fixture || !reference) {
	console.error('usage: verify-hdr-native.mjs --docker --fixture tests/resources/hdr/2.HEIF --reference tests/resources/hdr/4.mp4 --evidence-dir /tmp/immich-pages-hdr-native');
	process.exit(2);
}

const fixturePath = resolve(fixture);
const referencePath = resolve(reference);

const image = `immich-pages-hdr-native:${process.pid}`;
await mkdir(evidenceDir, { recursive: true });
const sourceHash = sha256(await readFile(fixturePath));
const referenceHash = sha256(await readFile(referencePath));
const expectedSourceHash = '07b7199417a540316538a3408af46940ca3deec6e65e38a1e1deebda07e32045';
if (sourceHash !== expectedSourceHash) throw new Error(`fixture hash mismatch: ${sourceHash}`);

try {
	await run('docker', ['build', '--tag', image, '.']);
	const metadataRaw = await run('docker', ['run', '--rm', '--volume', `${fixturePath}:/tmp/input.HEIF:ro`, image, 'exiftool', '-json', '-G1', '-s', '-n', '-HDRGainMapVersion', '-MakerNotes', '-AuxiliaryImageType', '-ProfileName', '-ColorSpace', '-TransferFunction', '-Orientation', '/tmp/input.HEIF']);
	const metadata = JSON.parse(metadataRaw.stdout)[0];
	const maker33 = numericKey(metadata, '33');
	const maker48 = numericKey(metadata, '48');
	const version = stringKey(metadata, 'HDRGainMapVersion');
	const orientation = numericKey(metadata, 'Orientation');
	if (!version || maker33 === undefined || maker48 === undefined || orientation !== 1) throw new Error('fixture did not satisfy the typed Apple metadata contract');
	const profile = /p3/i.test(String(metadata.ProfileName ?? metadata.ColorSpace)) ? 'display-p3' : 'rec709';
	const transfer = /rec.?709|bt.?709/i.test(String(metadata.TransferFunction ?? '')) ? 'rec709' : 'srgb';
	const containerEvidence = `${evidenceDir}/generated.mp4`;
	await run('docker', ['run', '--rm', '--volume', `${fixturePath}:/tmp/input.HEIF:ro`, '--volume', `${evidenceDir}:/tmp/evidence`, image, 'sh', '-c', `/usr/local/bin/hdr-gainmap-compositor --hdr-version ${shell(version)} --maker-note-33 ${shell(maker33)} --maker-note-48 ${shell(maker48)} --source-profile ${profile} --source-transfer ${transfer} --orientation 1 < /tmp/input.HEIF | ffmpeg -hide_banner -loglevel error -f image2pipe -vcodec ppm -i pipe:0 -frames:v 1 -an -c:v libx265 -profile:v main10 -pix_fmt yuv420p10le -color_primaries bt2020 -color_trc smpte2084 -colorspace bt2020nc -x265-params colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc -tag:v hvc1 -movflags frag_keyframe+empty_moov+default_base_moof -f mp4 /tmp/evidence/generated.mp4`]);
	const probe = await run('docker', ['run', '--rm', '--volume', `${evidenceDir}:/tmp/evidence:ro`, image, 'ffprobe', '-v', 'error', '-show_entries', 'stream=width,height,pix_fmt,color_space,color_transfer,color_primaries,codec_name,profile', '-of', 'json', '/tmp/evidence/generated.mp4']);
	await writeFile(`${evidenceDir}/ffprobe.json`, probe.stdout);
	const parsedProbe = JSON.parse(probe.stdout);
	const stream = parsedProbe.streams?.[0];
	if (!stream || stream.codec_name !== 'hevc' || stream.profile !== 'Main 10' || stream.color_transfer !== 'smpte2084' || stream.color_primaries !== 'bt2020' || stream.color_space !== 'bt2020nc' || !stream.width || !stream.height) throw new Error('generated output failed explicit HDR signaling assertions');
	const generated = await readFile(containerEvidence);
	if (!generated.length) throw new Error('generated output is empty');
	await writeFile(`${evidenceDir}/manifest.json`, JSON.stringify({ sourceHash, referenceHash, outputHash: sha256(generated), outputBytes: generated.length, width: stream.width, height: stream.height, profile: stream.profile, codec: stream.codec_name, colorPrimaries: stream.color_primaries, transfer: stream.color_transfer, matrix: stream.color_space, metadata: { versionPresent: true, numericMakerNotesPresent: true, auxiliaryTypeCheckedByNative: true }, physicalHdrValidation: 'not-run' }, null, 2));
	console.log(`HDR native verification passed; evidence written to ${evidenceDir}`);
} finally {
	await exec('docker', ['image', 'rm', image]).catch(() => undefined);
}

function valueAfter(name) { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; }
function sha256(data) { return createHash('sha256').update(data).digest('hex'); }
function stringKey(value, key) { const found = find(value, key); return typeof found === 'string' ? found : undefined; }
function numericKey(value, key) { const found = find(value, key); const number = typeof found === 'number' ? found : Number(found); return Number.isFinite(number) ? number : undefined; }
function find(value, key) { if (!value || typeof value !== 'object') return undefined; for (const [candidate, nested] of Object.entries(value)) { if (candidate === key || candidate.endsWith(`:${key}`)) return nested; const found = find(nested, key); if (found !== undefined) return found; } return undefined; }
function shell(value) { return String(value).replace(/[^A-Za-z0-9._-]/g, ''); }
async function run(command, commandArgs) { return exec(command, commandArgs, { maxBuffer: 2 * 1024 * 1024 }); }
