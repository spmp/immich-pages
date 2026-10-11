#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const exec = promisify(execFile); const args = process.argv.slice(2);
const image = value('--image') ?? 'immich-pages:hdr-check'; const context = value('--context') ?? '.';
try { await exec('docker', ['info'], { maxBuffer: 128 * 1024 }); } catch { fail('Docker daemon unavailable; fixture-content inspection was not run'); }
try { await exec('docker', ['build', '--tag', image, context], { maxBuffer: 2 * 1024 * 1024 }); } catch (error) { fail(`docker build failed: ${redact(error.message)}`); }
const listing = (await exec('docker', ['run', '--rm', image, 'sh', '-c', "find /app/build /usr/local/bin -type f -print"])).stdout;
if (/tests\/resources\/(?:hdr|heic-test-set)|fixture-manifest\.local|(?:^|\/)(?:2\.HEIF|4\.mp4)$/im.test(listing)) fail('runtime image contains local HDR fixture content');

// BuildKit does not print the complete context. A temporary Dockerfile makes
// an ignored fixture directory observable without copying any fixture locally.
const probeDir = await mkdtemp(join(tmpdir(), 'immich-pages-docker-probe-'));
const probeFile = join(probeDir, 'Dockerfile');
try {
  await writeFile(probeFile, 'FROM alpine\nCOPY tests/resources/hdr /probe\n');
  try {
    await exec('docker', ['build', '--file', probeFile, '--tag', `${image}-context-probe`, context], { maxBuffer: 512 * 1024 });
    fail('build context exposed ignored HDR fixture bytes');
  } catch (error) {
    if (String(error?.stdout ?? '').includes('Successfully built') || String(error?.stderr ?? '').includes('Successfully tagged')) fail('build context exposed ignored HDR fixture bytes');
  }
} finally {
  await rm(probeDir, { recursive: true, force: true });
}
console.log(`Docker fixture-content guard passed for ${image}`);
function value(flag) { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; }
function redact(value) { return String(value).replace(/(?:\/[^\s]+|[A-Za-z0-9+/]{24,})/g, '[redacted]'); }
function fail(message) { console.error(`Docker fixture guard blocked: ${message}`); process.exit(2); }
