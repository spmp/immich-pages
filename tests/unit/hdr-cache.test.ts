import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildHdrCacheKey, clearHdrCache, getCachedHdr, getOrCreateHdr, withHdrConcurrency } from '../../src/lib/server/media/hdr-cache';

describe('HDR media cache', () => {
	beforeEach(() => clearHdrCache());

	it('coalesces concurrent conversions and reuses the result', async () => {
		let resolve!: (value: { body: Uint8Array; contentType: string }) => void;
		const create = vi.fn(() => new Promise<{ body: Uint8Array; contentType: string }>((done) => { resolve = done; }));
		const first = getOrCreateHdr('asset', create);
		const second = getOrCreateHdr('asset', create);
		expect(create).toHaveBeenCalledTimes(1);
		resolve({ body: new Uint8Array([1, 2]), contentType: 'video/mp4' });
		await expect(Promise.all([first, second])).resolves.toHaveLength(2);
		await getOrCreateHdr('asset', create);
		expect(create).toHaveBeenCalledTimes(1);
	});

	it('caches an AVIF gain-map representation alongside the HEVC/MP4 one', async () => {
		const create = vi.fn(async () => ({ body: new Uint8Array([1]), contentType: 'image/avif' }));
		await getOrCreateHdr('avif-asset', create);
		await getOrCreateHdr('avif-asset', create);
		expect(create).toHaveBeenCalledTimes(1);
	});

	it('does not cache an unvalidated representation', async () => {
		const create = vi.fn(async () => ({ body: new Uint8Array([1]), contentType: 'image/jpeg' }));
		await getOrCreateHdr('invalid', create);
		await getOrCreateHdr('invalid', create);
		expect(create).toHaveBeenCalledTimes(2);
	});

	it('builds an opaque versioned key from source and output dimensions', () => {
		const key = buildHdrCacheKey({ assetId: 'asset/one', sourceIdentity: 'etag:one', width: 1200, height: 800 });
		expect(key).toContain('apple-gainmap-v3');
		expect(key).toContain('asset_one');
		expect(key).toContain('1200:800');
		expect(key).not.toMatch(/cookie|authorization|https?:/i);
	});

	it('enforces one global queue contract and releases work after completion', async () => {
		let active = 0;
		let maximum = 0;
		const tasks = Array.from({ length: 5 }, (_, index) => withHdrConcurrency(async () => {
			active += 1;
			maximum = Math.max(maximum, active);
			await new Promise((resolve) => setTimeout(resolve, 5));
			active -= 1;
			return index;
		}));
		expect(await Promise.all(tasks)).toEqual([0, 1, 2, 3, 4]);
		expect(maximum).toBeLessThanOrEqual(2);
	});

	it('runs interactive requests ahead of queued background prewarm work', async () => {
		const release: Array<() => void> = [];
		const active = [0, 1].map(() => withHdrConcurrency(() => new Promise<void>((resolve) => release.push(resolve))));
		const order: string[] = [];
		const background = withHdrConcurrency(async () => { order.push('background'); }, { priority: 'background' });
		const interactive = withHdrConcurrency(async () => { order.push('interactive'); }, { priority: 'interactive' });
		release.forEach((resolve) => resolve());
		await Promise.all([...active, background, interactive]);
		expect(order).toEqual(['interactive', 'background']);
	});

	it('promotes an already queued background conversion when Lightbox joins it', async () => {
		const release: Array<() => void> = [];
		const active = [0, 1].map(() => withHdrConcurrency(() => new Promise<void>((resolve) => release.push(resolve))));
		const order: string[] = [];
		const create = () => withHdrConcurrency(async () => {
			order.push('asset');
			return { body: new Uint8Array([1]), contentType: 'video/mp4' };
		}, { priority: 'background', queueKey: 'asset' });
		const background = getOrCreateHdr('asset', create, Date.now(), 'background');
		const other = withHdrConcurrency(async () => { order.push('other'); }, { priority: 'background' });
		const interactive = getOrCreateHdr('asset', create, Date.now(), 'interactive');
		release.forEach((resolve) => resolve());
		await Promise.all([...active, background, interactive, other]);
		expect(order).toEqual(['asset', 'other']);
	});

	it('times out queued work without leaving the scheduler occupied', async () => {
		await expect(withHdrConcurrency(() => new Promise(() => {}), { timeoutMs: 1 })).rejects.toThrow('hdr-scheduler-timeout');
		await expect(withHdrConcurrency(async () => 'ready')).resolves.toBe('ready');
	});

	it('expires entries based on the supplied clock', async () => {
		vi.setSystemTime(100);
		await getOrCreateHdr('asset', async () => ({ body: new Uint8Array([1]), contentType: 'image/jpeg' }));
		expect(getCachedHdr('asset', 100 + 10 * 60 * 1000)).toBeUndefined();
		vi.useRealTimers();
	});
});
