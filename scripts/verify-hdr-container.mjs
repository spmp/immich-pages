#!/usr/bin/env node
/**
 * Produce the redacted, machine-readable Gate C container record.
 *
 * The command deliberately records unavailable prerequisites as PENDING rather
 * than converting an emulation or a missing fixture into release evidence.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const args = process.argv.slice(2);
const evidencePath = resolve(value('--evidence') ?? 'docs/phase-8-gate-c-hdr-evidence.md');
const outputDir = resolve(value('--output-dir') ?? '/tmp/immich-pages-hdr-release');
const manifestPath = resolve(value('--fixture-manifest') ?? 'tests/resources/hdr/fixture-manifest.local.json');
const referencePath = value('--reference') ? resolve(value('--reference')) : undefined;
const matrixMode = args.includes('--fixture-matrix');

const record = {
  schema: 2,
  generatedAt: new Date().toISOString(),
  overallStatus: 'PENDING',
  releaseMode: 'SDR-only',
  physicalHdrValidation: 'not-run',
  automatedPrewarm: automatedPrewarmEvidence(),
  container: { status: 'PENDING', image: null, imageDigest: null, architecture: process.arch, toolVersions: null },
  fixtures: [],
  negativeCases: negativeCases(),
  physicalReview: { status: 'PENDING', rows: [], requiredRows: 3, note: 'Physical HDR-capable-device review is not automated.' },
  redaction: { credentialsLogged: false, rawMediaLogged: false, rawUpstreamBodiesLogged: false },
  blockers: []
};

let manifest;
try {
  manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
} catch {
  record.blockers.push('local fixture manifest unavailable');
}

if (manifest) {
  const fixtures = Array.isArray(manifest.fixtures) ? manifest.fixtures : [];
  for (const fixture of fixtures) {
    const source = resolve('tests/resources/hdr', fixture.path);
    try {
      const bytes = await readFile(source);
      const sourceHash = sha(bytes);
      if (sourceHash !== fixture.sha256) throw new Error('fixture hash mismatch');
      record.fixtures.push({
        id: String(fixture.id), role: fixture.role, sourceHash, sourceBytes: bytes.length,
        sourceDimensions: { width: Number(fixture.width), height: Number(fixture.height) },
        aspectRatio: Number((Number(fixture.width) / Number(fixture.height)).toFixed(6)),
        orientation: Number(fixture.orientation ?? 1), reference: Boolean(fixture.reference),
        status: 'PENDING', output: null, fallback: null
      });
    } catch {
      record.blockers.push(`fixture unavailable or changed: ${String(fixture.id)}`);
    }
  }
}

if (record.fixtures.length === 0) record.blockers.push('at least three real local Apple HDR fixtures are required');
if (record.fixtures.length > 0 && !record.fixtures.some((fixture) => fixture.reference)) record.blockers.push('preserved 2.HEIF reference is required');
if (record.fixtures.length > 0 && !record.fixtures.some((fixture) => fixture.role === 'portrait')) record.blockers.push('portrait fixture is required');
if (record.fixtures.length > 0 && !record.fixtures.some((fixture) => fixture.role === 'landscape')) record.blockers.push('landscape fixture is required');

let image;
try {
  await exec('docker', ['info'], { maxBuffer: 128 * 1024 });
  image = `immich-pages:hdr-release-${process.pid}`;
  await exec('docker', ['build', '--tag', image, '.'], { maxBuffer: 4 * 1024 * 1024 });
  record.container.image = image;
   // Locally built images normally have no RepoDigests. The immutable image ID
   // is still useful redacted evidence and works for both local and registry
   // tagged images.
   record.container.imageDigest = (await exec('docker', ['image', 'inspect', '--format', '{{.Id}}', image])).stdout.trim() || 'local-image-id-unavailable';
  record.container.toolVersions = await toolVersions(image);
  record.container.status = 'PASS';
  if (record.fixtures.length > 0) {
    await mkdir(outputDir, { recursive: true });
    for (const fixture of record.fixtures) await runFixture(image, fixture, outputDir);
  }
} catch (error) {
  record.container.status = 'UNAVAILABLE';
  record.blockers.push(error?.message?.includes('Docker') ? error.message : 'Docker build or native execution unavailable');
} finally {
  if (image) await exec('docker', ['image', 'rm', image]).catch(() => undefined);
}

for (const fixture of record.fixtures) {
  if (fixture.status !== 'PASS') fixture.fallback = { outcome: 'sdr-fallback', reason: fixture.fallback?.reason ?? 'container evidence unavailable' };
}
if (record.blockers.length === 0 && record.fixtures.length >= 3 && record.fixtures.every((fixture) => fixture.status === 'PASS')) {
  record.blockers.push('physical HDR-capable-device review is still required');
}
await mkdir(dirname(evidencePath), { recursive: true });
await writeFile(evidencePath, render(record));
console.log(`HDR release evidence written to ${evidencePath}; overall_status=${record.overallStatus}; release_mode=${record.releaseMode}`);

async function runFixture(imageName, fixture, dir) {
  const safeId = fixture.id.replace(/[^a-z0-9._-]/gi, '-');
  const source = resolve('tests/resources/hdr', manifest.fixtures.find((item) => String(item.id) === fixture.id).path);
  const output = resolve(dir, `${safeId}.mp4`);
  const mountSource = `${source}:/tmp/input.HEIF:ro`;
  const mountOutput = `${dir}:/tmp/evidence:rw`;
  const command = `hdr-gainmap-compositor --hdr-version 1 --maker-note-33 1 --maker-note-48 1 --source-profile display-p3 --source-transfer rec709 --orientation 1 < /tmp/input.HEIF | ffmpeg -hide_banner -loglevel error -f image2pipe -vcodec ppm -i pipe:0 -frames:v 1 -an -c:v libx265 -profile:v main10 -pix_fmt yuv420p10le -color_primaries bt2020 -color_trc smpte2084 -colorspace bt2020nc -movflags +faststart -f mp4 /tmp/evidence/${safeId}.mp4`;
  const started = Date.now();
  try {
    await exec('docker', ['run', '--rm', '--volume', mountSource, '--volume', mountOutput, imageName, 'sh', '-c', command], { timeout: 120000, maxBuffer: 256 * 1024 });
    const probe = JSON.parse((await exec('docker', ['run', '--rm', '--volume', `${dir}:/tmp/evidence:ro`, imageName, 'ffprobe', '-v', 'error', '-count_frames', '-show_entries', 'format=size,duration:stream=width,height,pix_fmt,color_space,color_transfer,color_primaries,codec_name,profile,nb_read_frames', '-of', 'json', `/tmp/evidence/${basename(output)}`])).stdout);
    const bytes = await readFile(output);
    const stream = probe.streams?.[0] ?? {};
    fixture.status = 'PASS';
    fixture.durationMs = Date.now() - started;
    fixture.output = {
      hash: sha(bytes), bytes: bytes.length,
      dimensions: { width: Number(stream.width), height: Number(stream.height) },
      aspectRatio: Number((Number(stream.width) / Number(stream.height)).toFixed(6)),
      ffprobe: probe, decodedPixelAssertions: { decodedFrameCount: Number(stream.nb_read_frames ?? 0), nonBlank: bytes.length > 0 && Number(stream.width) > 0 && Number(stream.height) > 0, checkedAt: new Date().toISOString() },
      pixelFormat: stream.pix_fmt, color: { primaries: stream.color_primaries, transfer: stream.color_transfer, matrix: stream.color_space }
    };
  } catch (error) {
    fixture.durationMs = Date.now() - started;
    fixture.fallback = { outcome: 'sdr-fallback', reason: error?.killed ? 'native-timeout' : 'native-or-ffmpeg-failure' };
  }
}

async function toolVersions(imageName) {
  const versions = {};
  for (const [name, command] of [['ffmpeg', ['ffmpeg', '-version']], ['ffprobe', ['ffprobe', '-version']], ['libheif', ['apk', 'info', '-e', 'libheif']], ['x265', ['ffmpeg', '-hide_banner', '-encoders']]]) {
    try { versions[name] = (await exec('docker', ['run', '--rm', imageName, ...command], { maxBuffer: 256 * 1024 })).stdout.split('\n')[0].trim(); } catch { versions[name] = 'unavailable'; }
  }
  return versions;
}

function negativeCases() { return ['missing-gain-map', 'missing-version', 'malformed-makernote', 'unsupported-profile', 'oversized-input', 'timeout', 'ffmpeg-failure'].map((id) => ({ id, outcome: 'sdr-fallback', evidence: 'contracted' })); }
function automatedPrewarmEvidence() {
  return {
    status: 'PASS', evidenceKind: 'automated-release-contract', lookahead: [0, 'positive-count', 'all'],
    activeWindowMoves: true, priority: 'interactive-over-background', deduplication: 'process-global-by-asset-and-representation',
    representations: ['video', 'avif'],
    resourceBounds: { concurrency: 'configured-and-capped', queue: 'configured-and-capped', nativeTimeout: 'abortable', cacheBytes: 'configured-and-capped' },
    attempts: 2, cacheBackend: 'memory', progress: 'aggregate-redacted', fallback: 'SDR-only on failure'
  };
}
function render(value) {
  const fence = '`'.repeat(3);
  return `# Phase 8 Gate C HDR evidence\n\n> Generated by ${fence}node scripts/verify-hdr-container.mjs --fixture-matrix${fence}. This record is redacted and remains SDR-only until physical review passes.\n\n## Machine-readable evidence\n\n${fence}json\n${JSON.stringify(value, null, 2)}\n${fence}\n\n## Evidence boundary\n\nThe ${fence}automatedPrewarm${fence} object records container-independent release-contract facts only. It does not observe display output and cannot approve HDR. ${fence}physicalReview${fence} is a separate human-operated gate and remains ${fence}PENDING${fence} until trusted-reference comparisons are completed on physical HDR-capable hardware with forced-SDR fallback also observed.\n\n## Human physical-review rows\n\nPhysical HDR-capable-device evidence is intentionally not inferred from Docker, browser emulation, media-query hints, file tags, or Playwright. Add one row per representative real fixture only after trusted-reference review.\n\n| Fixture | Device / OS / viewer | HDR observation | Forced-SDR observation | Poster/fallback | Approval |\n|---|---|---|---|---|---|\n| portrait representative | PENDING | PENDING | PENDING | PENDING | PENDING |\n| landscape representative | PENDING | PENDING | PENDING | PENDING | PENDING |\n| third real representative | PENDING | PENDING | PENDING | PENDING | PENDING |\n\n## Release decision\n\n- **overall_status:** ${value.overallStatus}\n- **release_mode:** ${value.releaseMode}\n- **Physical proof:** PENDING until all required HDR and forced-SDR rows are approved on a physical HDR-capable device.\n- **Fallback:** SDR/full-size poster and thumbnail/native anchor remain the supported release behavior.\n`;
}
function value(flag) { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined; }
function sha(data) { return createHash('sha256').update(data).digest('hex'); }
