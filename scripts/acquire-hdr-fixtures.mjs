#!/usr/bin/env node
/** Build the ignored, operator-owned HDR fixture manifest. Never writes media to git. */
import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const args = process.argv.slice(2);
const sourceDir = required('--source-dir');
const reference = resolve(required('--reference'));
const manifest = resolve(required('--manifest'));
const minInputs = Number(value('--min-real-inputs') ?? 3);
const requirePortrait = args.includes('--require-portrait');
const requireLandscape = args.includes('--require-landscape');
const expectedReference = '07b7199417a540316538a3408af46940ca3deec6e65e38a1e1deebda07e32045';

const referenceHash = await hash(reference);
if (referenceHash !== expectedReference) fail(`preserved 2.HEIF hash mismatch: expected ${expectedReference}`);
const files = (await readdir(resolve(sourceDir), { withFileTypes: true }))
  .filter((entry) => entry.isFile() && /\.(heif|heic)$/i.test(entry.name))
  .map((entry) => resolve(sourceDir, entry.name));
if (!files.some((file) => file === reference)) fail('source directory does not contain the preserved reference fixture');

const entries = [];
for (const file of files) {
	const sidecar = `${file}.json`;
	let provenance;
	try { provenance = JSON.parse(await readFile(sidecar, 'utf8')); } catch { fail(`missing provenance sidecar for ${basename(file)} (${sidecar})`); }
	if (!provenance.device || !provenance.export || !provenance.role || !['portrait', 'landscape'].includes(provenance.role)) fail(`provenance must include device, export, and portrait/landscape role for ${basename(file)}`);
	const bytes = await readFile(file);
	const dimensions = await probeDimensions(file);
	entries.push({
		id: provenance.id ?? basename(file, extname(file)).toLowerCase().replace(/[^a-z0-9]+/g, '-'),
		path: basename(file), role: provenance.role, sourceDevice: String(provenance.device),
		exportProvenance: String(provenance.export), acquiredAt: provenance.acquiredAt ?? new Date().toISOString(),
		bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), ...dimensions,
		orientation: Number(provenance.orientation ?? 1), reference: file === reference,
	} );
}
const hashes = new Set(entries.map((entry) => entry.sha256));
if (hashes.size !== entries.length) fail('duplicate fixture hashes are not real distinct inputs');
if (entries.length < minInputs) fail(`need at least ${minInputs} distinct real HDR inputs; found ${entries.length}`);
if (requirePortrait && !entries.some((entry) => entry.role === 'portrait')) fail('portrait fixture is required');
if (requireLandscape && !entries.some((entry) => entry.role === 'landscape')) fail('landscape fixture is required');
if (!entries.every((entry) => entry.bytes > 0 && entry.width > 0 && entry.height > 0)) fail('empty or dimensionless fixture rejected');
await writeFile(manifest, JSON.stringify({ schema: 1, generatedAt: new Date().toISOString(), reference: { file: basename(reference), sha256: expectedReference }, fixtures: entries }, null, 2) + '\n', { mode: 0o600 });
console.log(`wrote local-only manifest with ${entries.length} real Apple HDR fixtures: ${manifest}`);

async function probeDimensions(file) {
	try {
		const { stdout } = await exec('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', file], { maxBuffer: 64 * 1024 });
		const stream = JSON.parse(stdout).streams?.[0];
		return { width: Number(stream?.width), height: Number(stream?.height) };
	} catch { fail(`ffprobe is required to measure ${basename(file)}; no guessed dimensions are accepted`); }
}
function value(flag) { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; }
function required(flag) { const result = value(flag); if (!result) fail(`missing ${flag}`); return result; }
function fail(message) { console.error(`HDR fixture acquisition blocked: ${message}`); process.exit(2); }
async function hash(file) { try { return createHash('sha256').update(await readFile(file)).digest('hex'); } catch { fail(`missing fixture: ${file}`); } }
