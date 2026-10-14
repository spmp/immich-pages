import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// HDR_CACHE_BACKEND=disk: generated HDR media is also kept on disk, so a restarted Pages serves
// it again without converting. Memory stays the fast tier; the directory is an optimization only
// -- deleting it costs a reconversion, never correctness.
const directories: string[] = [];
async function freshModule(env: Record<string, string>) {
	vi.resetModules();
	for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
	const module = await import('../../src/lib/server/media/hdr-cache');
	await module.hdrDiskCacheReady();
	return module;
}
afterEach(() => { vi.unstubAllEnvs(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

const converted = () => ({ body: new Uint8Array(64).fill(3), contentType: 'video/mp4', width: 10, height: 20 });

describe('HDR disk cache across a restart', () => {
	it('serves media converted before the restart without converting it again', async () => {
		const directory = mkdtempSync(join(tmpdir(), 'hdr-restart-'));
		directories.push(directory);
		const env = { HDR_CACHE_BACKEND: 'disk', HDR_CACHE_DIRECTORY: directory };
		const before = await freshModule(env);
		expect(before.getHdrCacheBackendConfig()).toMatchObject({ backend: 'disk', diskWrites: true, directory });
		const create = vi.fn(async () => converted());
		await before.getOrCreateHdr('key-1', create);
		await before.hdrDiskWritesSettled();
		expect(readdirSync(directory).some((name) => name.endsWith('.media'))).toBe(true);

		const after = await freshModule(env);
		expect(after.getCachedHdr('key-1')).toBeUndefined();
		const again = vi.fn(async () => converted());
		const value = await after.getOrCreateHdr('key-1', again);
		expect(again).not.toHaveBeenCalled();
		expect(value.body.byteLength).toBe(64);
		// Now back in the memory tier, for the synchronous fast paths.
		expect(after.getCachedHdr('key-1')?.contentType).toBe('video/mp4');
	});

	it('lets a media route check disk before downloading the original', async () => {
		const directory = mkdtempSync(join(tmpdir(), 'hdr-restart-'));
		directories.push(directory);
		const env = { HDR_CACHE_BACKEND: 'disk', HDR_CACHE_DIRECTORY: directory };
		const before = await freshModule(env);
		await before.getOrCreateHdr('key-2', async () => converted());
		await before.hdrDiskWritesSettled();
		const after = await freshModule(env);
		expect((await after.lookupCachedHdr('key-2'))?.body.byteLength).toBe(64);
		expect(await after.lookupCachedHdr('missing')).toBeUndefined();
	});

	it('falls back to memory only when disk is requested without a usable directory', async () => {
		const module = await freshModule({ HDR_CACHE_BACKEND: 'disk', HDR_CACHE_DIRECTORY: '' });
		expect(module.getHdrCacheBackendConfig()).toMatchObject({ backend: 'memory', diskWrites: false });
		const value = await module.getOrCreateHdr('key-3', async () => converted());
		expect(value.body.byteLength).toBe(64);
	});
});
