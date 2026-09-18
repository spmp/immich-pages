#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
const exec = promisify(execFile); const args = process.argv.slice(2);
const image = value('--image') ?? 'immich-pages:hdr-check'; const context = value('--context') ?? '.';
try { await exec('docker', ['info'], { maxBuffer: 128 * 1024 }); } catch { fail('Docker daemon unavailable; fixture-content inspection was not run'); }
try { await exec('docker', ['build', '--tag', image, context], { maxBuffer: 2 * 1024 * 1024 }); } catch (error) { fail(`docker build failed: ${redact(error.message)}`); }
const listing = (await exec('docker', ['run', '--rm', image, 'sh', '-c', "find /app /usr/local/bin -type f -print"])).stdout;
if (/tests\/resources\/hdr|\.(heif|heic|jpe?g|mov|mp4|png)$/im.test(listing)) fail('runtime image contains fixture path or media extension');
const contextListing = (await exec('docker', ['build', '--no-cache', '--progress=plain', '--tag', `${image}-context`, context], { maxBuffer: 2 * 1024 * 1024 })).stdout;
if (/tests\/resources\/hdr\/(?:[^\s]*\.(?:heif|heic|jpe?g|mov|mp4|png))/i.test(contextListing)) fail('build context exposed ignored HDR fixture bytes');
console.log(`Docker fixture-content guard passed for ${image}`);
function value(flag) { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; }
function redact(value) { return String(value).replace(/(?:\/[^\s]+|[A-Za-z0-9+/]{24,})/g, '[redacted]'); }
function fail(message) { console.error(`Docker fixture guard blocked: ${message}`); process.exit(2); }
