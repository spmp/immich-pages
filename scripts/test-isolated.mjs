#!/usr/bin/env node
// Run the whole test suite the way a clean machine would, with the real HDR toolchain.
//
//   npm run test:isolated                 # the working tree: tracked + untracked, not ignored files
//   npm run test:isolated -- --committed  # exactly HEAD, as CI checks it out
//   npm run test:isolated -- --repeat 5   # run the suite 5 times, to shake out flaky tests
//
// The repository is exported to a temporary directory (so nothing outside git -- a sibling Immich
// checkout, .cache/, a local .env -- can leak in), built with the Dockerfile's `test` stage (same
// Alpine base, libheif, libavif, ffmpeg and compiled HDR binaries as production, plus exiftool),
// and the suite runs there as an unprivileged user, as in CI.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const committed = args.includes('--committed');
const repeatAt = args.indexOf('--repeat');
const repeat = repeatAt >= 0 ? Number(args[repeatAt + 1]) : 1;
if (!Number.isInteger(repeat) || repeat < 1) { console.error('--repeat needs a positive whole number'); process.exit(2); }

const run = (command, commandArgs, options = {}) => {
	const result = spawnSync(command, commandArgs, { stdio: 'inherit', ...options });
	if (result.error) throw result.error;
	return result.status ?? 1;
};
const git = (...gitArgs) => {
	const result = spawnSync('git', gitArgs, { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 });
	if (result.status !== 0) throw new Error(`git ${gitArgs.join(' ')} failed: ${result.stderr}`);
	return result.stdout;
};

const root = git('rev-parse', '--show-toplevel').toString().trim();
const work = mkdtempSync(join(tmpdir(), 'pages-isolated-'));
const image = 'immich-pages-test:isolated';
let status = 1;
try {
	console.log(`[isolated] exporting ${committed ? 'HEAD' : 'the working tree'} to ${work}`);
	if (committed) {
		status = run('sh', ['-c', 'git archive HEAD | tar -x -C "$1"', 'sh', work], { cwd: root });
	} else {
		// Files present on disk only: a tracked file deleted in the working tree is left out.
		const files = git('-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard');
		status = run('sh', ['-c', 'tar --null --ignore-failed-read -T - -c 2>/dev/null | tar -x -C "$1"', 'sh', work], { cwd: root, input: files, stdio: ['pipe', 'inherit', 'inherit'] });
	}
	if (status !== 0) throw new Error('export failed');

	console.log('[isolated] building the test image (Dockerfile target "test")');
	status = run('docker', ['build', '--target', 'test', '--build-context', `tests=${join(work, 'tests')}`, '-t', image, work]);
	if (status !== 0) throw new Error('image build failed (this includes npm run check and npm run build)');

	for (let round = 1; round <= repeat && status === 0; round += 1) {
		if (repeat > 1) console.log(`[isolated] run ${round} of ${repeat}`);
		status = run('docker', ['run', '--rm', '--network', 'none', image]);
	}
} catch (error) {
	console.error(`[isolated] ${error instanceof Error ? error.message : error}`);
	if (status === 0) status = 1;
} finally {
	rmSync(work, { recursive: true, force: true });
}
console.log(status === 0 ? '[isolated] all passed' : '[isolated] FAILED');
process.exit(status);
