import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';

// Tests that run the real HDR toolchain (compiled binaries, exiftool, ffmpeg, avifdec) skip on a
// machine without it -- but must never skip silently where the toolchain is supposed to be: the
// Dockerfile's `test` stage (npm run test:isolated, CI) sets HDR_NATIVE_TESTS=required, and a
// missing binary or tool then fails the run instead of quietly skipping every native HDR test.
export const nativeHdrRequired = process.env.HDR_NATIVE_TESTS === 'required';

/** Where the compiled HDR binaries live: the production image's /usr/local/bin by default. */
export const nativeBinDir = process.env.HDR_NATIVE_BIN_DIR ?? '/usr/local/bin';
export const nativeBinary = (name: string) => join(nativeBinDir, name);

export const onPath = (tool: string) => spawnSync('sh', ['-c', `command -v ${tool}`], { stdio: 'ignore' }).status === 0;

/**
 * `describe` for native HDR tests: runs when every binary and tool is present; otherwise skips --
 * or, when required, adds a failing test naming what is missing.
 */
export function describeNativeHdr(name: string, needs: { binaries?: string[]; tools?: string[] }, body: () => void) {
	const missing = [...(needs.binaries ?? []).map(nativeBinary).filter((path) => !existsSync(path)), ...(needs.tools ?? []).filter((tool) => !onPath(tool))];
	if (!missing.length) return describe(name, body);
	if (!nativeHdrRequired) return describe.skip(name, body);
	describe(name, () => {
		it('has the native HDR toolchain this test needs', () => { throw new Error(`missing: ${missing.join(', ')} (HDR_NATIVE_TESTS=required)`); });
	});
}
