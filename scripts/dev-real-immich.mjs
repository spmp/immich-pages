#!/usr/bin/env node
// One command for a fully working local Pages: the disposable real-Immich fixture
// (tests/e2e/real-immich), its seeded demo albums, the native HDR binaries, a map style, and
// the Vite dev server -- with the server's output kept in a log file as well as the terminal.
//
//   npm run dev:real-immich                 # http://0.0.0.0:8080
//   PORT=5173 npm run dev:real-immich
//   npm run dev:real-immich -- --down       # also stop the fixture containers on exit
//
// Every setting below can be overridden from the environment. Like the fixture itself, this is
// local-only and must never be pointed at real user data.
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fixtureDir = join(root, 'tests/e2e/real-immich');
const cacheDir = join(root, '.cache');
const binDir = join(cacheDir, 'hdr-bin');
const logPath = process.env.PAGES_DEV_LOG ?? join(cacheDir, 'pages-dev.log');
const port = process.env.PORT ?? '8080';
const immichBaseUrl = process.env.IMMICH_BASE_URL ?? 'http://127.0.0.1:4101';
const stopContainersOnExit = process.argv.includes('--down');

const step = (message) => console.log(`\n[dev] ${message}`);
const warn = (message) => console.warn(`[dev] warning: ${message}`);

function run(command, args, options = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: 'inherit', ...options });
		child.once('error', reject);
		child.once('exit', (code, signal) => (code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} exited with ${code ?? signal}`))));
	});
}

async function waitForHttp(url, timeout = 180_000) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ }
		await new Promise((resolve) => setTimeout(resolve, 1_000));
	}
	throw new Error(`timed out waiting for ${url}`);
}

const onPath = (command) => spawnSync('sh', ['-c', `command -v ${command}`], { stdio: 'ignore' }).status === 0;

// The production image builds these from scripts/*.cpp (see Dockerfile); a bare-host dev
// server has no HDR at all without them (docs/hdr-media.md). Rebuilt only when the source changes.
function buildHdrBinaries() {
	const binaries = [
		['hdr-gainmap-compositor', 'scripts/hdr-gainmap-compositor.cpp', '-lheif'],
		['hdr-avif-decode', 'scripts/hdr-avif-decode.cpp', '-lheif'],
		['hdr-avif-encode', 'scripts/hdr-avif-encode.cpp', '-lavif']
	];
	if (!onPath('g++')) { warn('g++ not found: HDR conversion will be unavailable (needs g++, libheif-dev, libavif-dev)'); return {}; }
	mkdirSync(binDir, { recursive: true });
	const paths = {};
	for (const [name, source, library] of binaries) {
		const output = join(binDir, name);
		const sourcePath = join(root, source);
		if (!existsSync(output) || statSync(output).mtimeMs < statSync(sourcePath).mtimeMs) {
			const result = spawnSync('g++', ['-O2', '-std=c++17', sourcePath, library, '-o', output], { encoding: 'utf8' });
			if (result.status !== 0) { warn(`could not build ${name} (missing ${library === '-lavif' ? 'libavif-dev' : 'libheif-dev'}?): ${result.stderr.split('\n')[0]}`); continue; }
			console.log(`[dev] built ${name}`);
		}
		paths[name] = output;
	}
	for (const tool of ['ffmpeg', 'exiftool', 'heif-convert']) if (!onPath(tool)) warn(`${tool} not found: some HDR or HEIC conversions will fail`);
	return paths;
}

let pages;
let shuttingDown = false;
async function shutdown(code = 0) {
	if (shuttingDown) return;
	shuttingDown = true;
	if (pages && pages.exitCode === null) {
		pages.kill('SIGTERM');
		await new Promise((resolve) => { const timer = setTimeout(resolve, 5_000); pages.once('exit', () => { clearTimeout(timer); resolve(); }); });
	}
	if (stopContainersOnExit) {
		step('stopping the Immich fixture containers');
		await run('docker', ['compose', 'down'], { cwd: fixtureDir }).catch((error) => warn(error.message));
	} else console.log('\n[dev] Immich fixture containers left running (fast restart). Stop them with:\n      (cd tests/e2e/real-immich && docker compose down)');
	process.exit(code);
}
process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));

try {
	step('starting the real-Immich fixture (Postgres, Redis, immich-server)');
	await run('docker', ['compose', 'up', '-d'], { cwd: fixtureDir });
	await waitForHttp(`${immichBaseUrl}/api/server/ping`);

	step('seeding demo albums (idempotent)');
	await run(process.execPath, [join(fixtureDir, 'seed.mjs')], { env: { ...process.env, IMMICH_BASE_URL: immichBaseUrl } });

	step('checking native HDR tooling');
	const hdr = buildHdrBinaries();

	const env = {
		...process.env,
		IMMICH_BASE_URL: immichBaseUrl,
		// Throwaway secrets for this disposable stack only.
		PAGES_LOCATOR_SECRET: process.env.PAGES_LOCATOR_SECRET ?? 'fixture-locator-secret-0123456789012345',
		PAGES_VISITED_SHARES_SECRET: process.env.PAGES_VISITED_SHARES_SECRET ?? 'fixture-visited-shares-secret-0123456789012345',
		PAGES_SESSION_SECRET: process.env.PAGES_SESSION_SECRET ?? 'fixture-session-secret-0123456789012345678',
		PUBLIC_PAGES_DEBUG: process.env.PUBLIC_PAGES_DEBUG ?? 'true',
		// Without a style the map renders nothing but a warning. OpenFreeMap needs no API key.
		MAP_STYLE_URL_QUIET_ATLAS: process.env.MAP_STYLE_URL_QUIET_ATLAS ?? 'https://tiles.openfreemap.org/styles/liberty',
		...(hdr['hdr-gainmap-compositor'] && !process.env.HDR_COMPOSITOR_PATH ? { HDR_COMPOSITOR_PATH: hdr['hdr-gainmap-compositor'] } : {}),
		...(hdr['hdr-avif-decode'] && !process.env.HDR_AVIF_DECODE_PATH ? { HDR_AVIF_DECODE_PATH: hdr['hdr-avif-decode'] } : {}),
		...(hdr['hdr-avif-encode'] && !process.env.HDR_AVIF_ENCODE_PATH ? { HDR_AVIF_ENCODE_PATH: hdr['hdr-avif-encode'] } : {})
	};

	step(`starting Pages on 0.0.0.0:${port}; log: ${logPath}`);
	mkdirSync(dirname(logPath), { recursive: true });
	const log = createWriteStream(logPath, { flags: 'a' });
	log.write(`\n===== dev:real-immich started ${new Date().toISOString()} =====\n`);
	pages = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', 'dev', '--host', '0.0.0.0', '--port', port, '--strictPort'], { cwd: root, env, stdio: ['inherit', 'pipe', 'pipe'] });
	for (const stream of [pages.stdout, pages.stderr]) stream.on('data', (chunk) => { process.stdout.write(chunk); log.write(chunk); });
	pages.once('exit', (code) => { if (!shuttingDown) { warn(`Pages dev server exited (${code})`); void shutdown(code ?? 1); } });

	await waitForHttp(`http://127.0.0.1:${port}/health`, 120_000);
	const seeded = JSON.parse(readFileSync(join(fixtureDir, 'seed-output.json'), 'utf8'));
	console.log(`\n[dev] ready. Demo journeys:`);
	for (const slug of Object.keys(seeded.slugs ?? {})) console.log(`      http://localhost:${port}/share/slug/${slug}`);
	console.log(`      library: http://localhost:${port}/library\n[dev] Ctrl-C to stop.`);
} catch (error) {
	console.error(`[dev] ${error.message}`);
	await shutdown(1);
}
