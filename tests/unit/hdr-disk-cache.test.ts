import { chmodSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HdrDiskCache } from '../../src/lib/server/media/hdr-disk-cache';

const directories: string[] = [];
const freshDirectory = () => { const directory = mkdtempSync(join(tmpdir(), 'hdr-disk-cache-')); directories.push(directory); return directory; };
afterEach(() => { for (const directory of directories.splice(0)) { try { chmodSync(directory, 0o700); } catch { /* already gone */ } rmSync(directory, { recursive: true, force: true }); } });

const media = (size: number, contentType = 'video/mp4') => ({ body: new Uint8Array(size).fill(7), contentType, width: 4032, height: 3024 });

describe('HDR disk cache', () => {
	it('keeps generated media across a restart', async () => {
		const directory = freshDirectory();
		const first = new HdrDiskCache({ directory, maxBytes: 10_000 });
		expect(await first.init()).toBe(true);
		await first.write('apple-gainmap-v3:asset:etag:auto:auto:mp4', media(100));
		const restarted = new HdrDiskCache({ directory, maxBytes: 10_000 });
		await restarted.init();
		const value = await restarted.read('apple-gainmap-v3:asset:etag:auto:auto:mp4');
		expect(value?.contentType).toBe('video/mp4');
		expect(value?.body.byteLength).toBe(100);
		expect(value?.body[0]).toBe(7);
		expect([value?.width, value?.height]).toEqual([4032, 3024]);
		expect(restarted.stats()).toEqual({ entries: 1, bytes: 100 });
	});

	it('stores only finished HDR media types, never anything empty', async () => {
		const cache = new HdrDiskCache({ directory: freshDirectory(), maxBytes: 10_000 });
		await cache.init();
		await cache.write('jpeg', media(10, 'image/jpeg'));
		await cache.write('empty', media(0));
		await cache.write('avif', media(10, 'image/avif'));
		expect(await cache.read('jpeg')).toBeUndefined();
		expect(await cache.read('empty')).toBeUndefined();
		expect(await cache.read('avif')).toBeDefined();
	});

	it('stays within its size budget, giving up the least recently used first', async () => {
		const directory = freshDirectory();
		const cache = new HdrDiskCache({ directory, maxBytes: 250 });
		await cache.init();
		await cache.write('a', media(100));
		await cache.write('b', media(100));
		await cache.read('a');
		await cache.write('c', media(100));
		expect(await cache.read('b')).toBeUndefined();
		expect(await cache.read('a')).toBeDefined();
		expect(await cache.read('c')).toBeDefined();
		expect(cache.stats().bytes).toBeLessThanOrEqual(250);
		// Something larger than the whole budget is not kept at all.
		await cache.write('huge', media(300));
		expect(await cache.read('huge')).toBeUndefined();
		// Evicted files are actually gone from the directory, not just forgotten.
		expect(readdirSync(directory).filter((name) => name.endsWith('.media'))).toHaveLength(2);
	});

	it('discards damaged or half-written entries instead of serving them', async () => {
		const directory = freshDirectory();
		const cache = new HdrDiskCache({ directory, maxBytes: 10_000 });
		await cache.init();
		await cache.write('truncated', media(100));
		const [file] = readdirSync(directory).filter((name) => name.endsWith('.media'));
		writeFileSync(join(directory, file), new Uint8Array(40));
		writeFileSync(join(directory, 'leftover.tmp'), 'partial');
		const restarted = new HdrDiskCache({ directory, maxBytes: 10_000 });
		await restarted.init();
		expect(await restarted.read('truncated')).toBeUndefined();
		expect(readdirSync(directory)).toEqual([]);
	});

	it('never lets a cache key choose where a file goes', async () => {
		const directory = freshDirectory();
		const cache = new HdrDiskCache({ directory, maxBytes: 10_000 });
		await cache.init();
		await cache.write('../../escape/../../etc/passwd', media(10));
		const names = readdirSync(directory);
		expect(names.every((name) => /^[0-9a-f]{64}\.(media|json)$/.test(name))).toBe(true);
		expect(await cache.read('../../escape/../../etc/passwd')).toBeDefined();
	});

	it('reports itself unavailable, without throwing, when the directory cannot be written', async () => {
		const directory = freshDirectory();
		chmodSync(directory, 0o500);
		const cache = new HdrDiskCache({ directory: join(directory, 'nested'), maxBytes: 10_000 });
		expect(await cache.init()).toBe(false);
		await expect(cache.write('a', media(10))).resolves.toBeUndefined();
		expect(await cache.read('a')).toBeUndefined();
	});
});
