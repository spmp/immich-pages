import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildHdrCacheKey, clearHdrCache, getCachedHdr, getHdrCacheBackendConfig, getOrCreateHdr, memoryHdrCacheBackend, withHdrConcurrency } from '../../src/lib/server/media/hdr-cache';

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

	// The video's SDR white moved from 100 to 203 nits: a video converted before (memory or disk
	// tier) must not be served as the new one, while AVIF conversions, unchanged, stay valid.
	it('does not reuse videos converted with the old 100-nit white', async () => {
		const { HDR_OUTPUT_CONTRACT } = await import('../../src/lib/server/media/hdr-prewarm');
		const common = { assetId: 'asset', sourceIdentity: 'etag', width: 10, height: 20 };
		expect(buildHdrCacheKey({ ...common, outputContract: HDR_OUTPUT_CONTRACT.video })).not.toBe(buildHdrCacheKey({ ...common, outputContract: 'mp4-hevc-main10-pq-bt2020' }));
		expect(HDR_OUTPUT_CONTRACT.avif).toBe('avif-gainmap-p3');
	});

	it('keeps video and AVIF cache identities independent', () => {
		const common = { assetId: 'asset', sourceIdentity: 'etag', width: 10, height: 20 };
		expect(buildHdrCacheKey({ ...common, outputContract: 'video' })).not.toBe(buildHdrCacheKey({ ...common, outputContract: 'avif' }));
	});

	it('is memory only, writing nothing to disk, unless a disk cache is configured', () => {
		const config = getHdrCacheBackendConfig();
		expect(config.backend).toBe('memory');
		expect(config.diskWrites).toBe(false);
		expect(memoryHdrCacheBackend.stats().entries).toBe(0);
	});

	// A photo someone has just opened must never be refused because background prewarm work has
	// filled the queue; background work alone is what the queue cap holds back.
	it('admits interactive work even when background work has filled the queue', async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => { release = resolve; });
		const background = Array.from({ length: 80 }, () => withHdrConcurrency(async () => { await gate; return 'bg'; }, { priority: 'background' }).catch((error: Error) => error.message));
		const interactive = withHdrConcurrency(async () => 'opened', { priority: 'interactive' });
		release();
		expect(await interactive).toBe('opened');
		expect((await Promise.all(background)).filter((value) => value === 'hdr-queue-full').length).toBeGreaterThan(0);
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
		let aborted = false;
		await expect(withHdrConcurrency((signal) => new Promise(() => signal?.addEventListener('abort', () => { aborted = true; })), { timeoutMs: 1 })).rejects.toThrow('hdr-scheduler-timeout');
		expect(aborted).toBe(true);
		await expect(withHdrConcurrency(async () => 'ready')).resolves.toBe('ready');
	});

	// hdr-caching-uat-20261010 finding 6a: the user explicitly asked for more client-side logging
	// pushed back to the server to properly debug this class of issue -- direct-share.hdr-cache-
	// miss/hit/store previously carried only aggregate cacheEntries/cacheBytes, with no way to tell
	// WHICH asset a given miss/hit/store was for. assetId + the full (already-sanitized) cache key
	// must be present on all three events.
	it('logs assetId and the full cache key on miss, store, and hit events', async () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => {});
		const create = vi.fn(async () => ({ body: new Uint8Array([1]), contentType: 'video/mp4' }));
		await getOrCreateHdr('asset-logged', create, Date.now(), 'background', 'photo-123');
		await getOrCreateHdr('asset-logged', create, Date.now(), 'background', 'photo-123');
		const events = info.mock.calls.map(([line]) => JSON.parse(line as string));
		expect(events.find((event) => event.event === 'direct-share.hdr-cache-miss')).toMatchObject({ assetId: 'photo-123', cacheKey: 'asset-logged' });
		expect(events.find((event) => event.event === 'direct-share.hdr-cache-store')).toMatchObject({ assetId: 'photo-123', cacheKey: 'asset-logged' });
		expect(events.find((event) => event.event === 'direct-share.hdr-cache-hit')).toMatchObject({ assetId: 'photo-123', cacheKey: 'asset-logged' });
		info.mockRestore();
	});

	it('expires entries based on the supplied clock', async () => {
		vi.setSystemTime(100);
		await getOrCreateHdr('asset', async () => ({ body: new Uint8Array([1]), contentType: 'image/jpeg' }));
		expect(getCachedHdr('asset', 100 + 10 * 60 * 1000)).toBeUndefined();
		vi.useRealTimers();
	});
});
