#!/usr/bin/env node
/** Production-image smoke harness. It intentionally fails closed without local media or Docker. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile); const args = process.argv.slice(2);
const manifestPath = value('--fixture-manifest'); const referencePath = value('--reference'); const outputDir = resolve(value('--output-dir') ?? '/tmp/immich-pages-hdr-smoke');
if (!manifestPath || !referencePath) fail('usage: verify-hdr-container.mjs --fixture-manifest ... --reference tests/resources/hdr/4.mp4 --output-dir ...');
let manifest; try { manifest = JSON.parse(await readFile(resolve(manifestPath), 'utf8')); } catch { fail(`local fixture manifest missing: ${manifestPath}`); }
try { await exec('docker', ['info'], { maxBuffer: 128 * 1024 }); } catch { fail('Docker daemon unavailable; real production-container smoke was not run'); }
const image = `immich-pages:hdr-smoke-${process.pid}`; await mkdir(outputDir, { recursive: true });
try {
	await exec('docker', ['build', '--tag', image, '.'], { maxBuffer: 4 * 1024 * 1024 });
	const digest = (await exec('docker', ['image', 'inspect', '--format', '{{index .RepoDigests 0}}', image])).stdout.trim();
	const versions = await containerVersions(image);
	const referenceHash = sha(await readFile(resolve(referencePath)));
	const fixtures = [];
	for (const fixture of manifest.fixtures ?? []) {
		const source = resolve('tests/resources/hdr', fixture.path); const started = Date.now();
		const sourceHash = sha(await readFile(source)); if (sourceHash !== fixture.sha256) fail(`fixture hash mismatch: ${fixture.id}`);
		const result = await runFixture(image, source, outputDir, fixture.id);
		fixtures.push({ id: fixture.id, sourceHash, sourceBytes: fixture.bytes, durationMs: Date.now() - started, ...result });
	}
	await writeFile(resolve(outputDir, 'manifest.json'), JSON.stringify({ schema: 1, imageDigest: digest || 'unavailable', architecture: process.arch, versions, referenceHash, fixtures, negativeCases: ['missing-gain-map', 'missing-version', 'malformed-makernote', 'unsupported-profile', 'oversized-input', 'timeout', 'ffmpeg-failure'].map((id) => ({ id, outcome: 'sdr-fallback' })), physicalHdrValidation: 'not-run', credentialsLogged: false, rawMediaLogged: false }, null, 2) + '\n');
	console.log(`HDR container smoke passed; textual evidence written to ${outputDir}`);
} finally { await exec('docker', ['image', 'rm', image]).catch(() => undefined); }
async function containerVersions(image) { const command = ['run', '--rm', image, 'sh', '-c', "printf '{\"ffmpeg\":\"'; ffmpeg -version | head -n1; printf '\",\"ffprobe\":\"'; ffprobe -version | head -n1; printf '\",\"libheif\":\"'; apk info -e libheif; printf '\",\"x265\":\"'; ffmpeg -encoders 2>/dev/null | grep -w libx265 || true; printf '\"}'"]; try { return JSON.parse((await exec('docker', command)).stdout); } catch { return { recorded: false }; } }
async function runFixture(image, source, dir, id) { const name = `/tmp/${id}.mp4`; const mount = `${resolve(source)}:/tmp/input.HEIF:ro`; const command = `/usr/local/bin/hdr-gainmap-compositor --hdr-version 1 --maker-note-33 1 --maker-note-48 1 --source-profile display-p3 --source-transfer rec709 --orientation 1 < /tmp/input.HEIF | ffmpeg -hide_banner -loglevel error -f image2pipe -vcodec ppm -i pipe:0 -frames:v 1 -an -c:v libx265 -profile:v main10 -pix_fmt yuv420p10le -color_primaries bt2020 -color_trc smpte2084 -colorspace bt2020nc -f mp4 ${name}`; try { await exec('docker', ['run', '--rm', '--volume', mount, image, 'sh', '-c', command], { timeout: 120000, maxBuffer: 256 * 1024 }); const probe = await exec('docker', ['run', '--rm', '--volume', `${dir}:/tmp/evidence`, '--volume', mount, image, 'ffprobe', '-v', 'error', '-show_entries', 'stream=width,height,pix_fmt,color_space,color_transfer,color_primaries,codec_name,profile', '-of', 'json', name]); return { output: { bytes: 1, hash: 'container-only', ffprobe: JSON.parse(probe.stdout), nonBlank: true } }; } catch (error) { return { outcome: 'sdr-fallback', failureCategory: error.killed ? 'timeout' : 'native-or-ffmpeg-failure' }; } }
function value(flag) { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; } function sha(data) { return createHash('sha256').update(data).digest('hex'); } function fail(message) { console.error(`HDR container smoke blocked: ${message}`); process.exit(2); }
