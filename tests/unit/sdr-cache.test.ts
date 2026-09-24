import { describe, expect, it, beforeEach, vi } from 'vitest';
import { buildSdrCacheKey, clearSdrCache, getCachedSdr, getOrCreateSdr, withSdrConcurrency } from '../../src/lib/server/media/sdr-cache';

describe('SDR media cache', () => {
	beforeEach(() => clearSdrCache());

	it('coalesces concurrent conversions and reuses the result', async () => {
		let resolve!: (value: { body: Uint8Array; contentType: string }) => void;
		const create = vi.fn(() => new Promise<{ body: Uint8Array; contentType: string }>((done) => { resolve = done; }));
		const first = getOrCreateSdr('asset', create);
		const second = getOrCreateSdr('asset', create);
		expect(create).toHaveBeenCalledTimes(1);
		resolve({ body: new Uint8Array([1, 2]), contentType: 'image/jpeg' });
		await expect(Promise.all([first, second])).resolves.toHaveLength(2);
		await getOrCreateSdr('asset', create);
		expect(create).toHaveBeenCalledTimes(1);
	});

	it('does not cache an unvalidated representation', async () => {
		const create = vi.fn(async () => ({ body: new Uint8Array([1]), contentType: 'video/mp4' }));
		await getOrCreateSdr('invalid', create);
		await getOrCreateSdr('invalid', create);
		expect(create).toHaveBeenCalledTimes(2);
	});

	it('builds an opaque versioned key from asset and source identity, never auth material', () => {
		const key = buildSdrCacheKey({ assetId: 'asset/one', sourceIdentity: 'etag:one' });
		expect(key).toContain('heic-jpeg-v1');
		expect(key).toContain('asset_one');
		expect(key).not.toMatch(/cookie|authorization|https?:/i);
	});

	it('enforces a bounded concurrency queue and releases work after completion', async () => {
		let active = 0;
		let maximum = 0;
		const tasks = Array.from({ length: 8 }, (_, index) => withSdrConcurrency(async () => {
			active += 1;
			maximum = Math.max(maximum, active);
			await new Promise((resolve) => setTimeout(resolve, 5));
			active -= 1;
			return index;
		}));
		expect(await Promise.all(tasks)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
		expect(maximum).toBeLessThanOrEqual(4);
	});

	it('expires entries based on the supplied clock', async () => {
		vi.setSystemTime(100);
		await getOrCreateSdr('asset', async () => ({ body: new Uint8Array([1]), contentType: 'image/jpeg' }));
		expect(getCachedSdr('asset', 100 + 30 * 60 * 1000)).toBeUndefined();
		vi.useRealTimers();
	});
});
