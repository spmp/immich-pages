import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildHdrMetadataCacheKey, clearHdrMetadataCache, getCachedHdrMetadata, getOrExtractHdrMetadata } from '../../src/lib/server/media/hdr-metadata-cache';

const metadata = { version: '1.0', auxiliaryType: 'urn:com:apple:photo:2020:aux:hdrgainmap' as const, makerNote33: 0.8, makerNote48: 0.4, headroom: 2, hdrGain: 0.4, sourceProfile: 'display-p3' as const, sourceTransfer: 'srgb' as const, orientation: 1 as const };

describe('HDR metadata cache', () => {
	beforeEach(() => clearHdrMetadataCache());

	it('caches a negative (no HDR metadata) result so repeat lookups skip re-extraction', async () => {
		const extract = vi.fn(async () => undefined);
		const key = buildHdrMetadataCacheKey({ assetId: 'asset-1', sourceIdentity: 'etag:one' });
		expect(await getOrExtractHdrMetadata(key, extract)).toBeUndefined();
		expect(await getOrExtractHdrMetadata(key, extract)).toBeUndefined();
		expect(extract).toHaveBeenCalledTimes(1);
		const cached = getCachedHdrMetadata(key);
		expect(cached).toEqual({ hit: true, value: undefined });
	});

	it('caches a positive result identically', async () => {
		const extract = vi.fn(async () => metadata);
		const key = buildHdrMetadataCacheKey({ assetId: 'asset-2', sourceIdentity: 'etag:two' });
		expect(await getOrExtractHdrMetadata(key, extract)).toEqual(metadata);
		expect(await getOrExtractHdrMetadata(key, extract)).toEqual(metadata);
		expect(extract).toHaveBeenCalledTimes(1);
	});

	it('coalesces concurrent extractions for the same key', async () => {
		let resolve!: (value: undefined) => void;
		const extract = vi.fn(() => new Promise<undefined>((done) => { resolve = done; }));
		const key = buildHdrMetadataCacheKey({ assetId: 'asset-3', sourceIdentity: 'etag:three' });
		const first = getOrExtractHdrMetadata(key, extract);
		const second = getOrExtractHdrMetadata(key, extract);
		expect(extract).toHaveBeenCalledTimes(1);
		resolve(undefined);
		await Promise.all([first, second]);
	});

	it('builds a bounded, sanitized key from realistic header-derived identity', () => {
		const key = buildHdrMetadataCacheKey({ assetId: 'asset/4', sourceIdentity: 'etag:"abc123"|Mon, 01 Jan 2026 00:00:00 GMT|12345' });
		expect(key).toBe('asset_4:etag:_abc123__Mon__01_Jan_2026_00:00:00_GMT_12345');
		expect(key.length).toBeLessThanOrEqual(200);
	});

	it('reports a miss for an unknown key without side effects', () => {
		expect(getCachedHdrMetadata('unknown')).toEqual({ hit: false });
	});

	it('expires entries after the TTL', async () => {
		vi.setSystemTime(1000);
		const key = buildHdrMetadataCacheKey({ assetId: 'asset-5', sourceIdentity: 'etag:five' });
		await getOrExtractHdrMetadata(key, async () => undefined);
		expect(getCachedHdrMetadata(key, 1000 + 30 * 60 * 1000)).toEqual({ hit: false });
		vi.useRealTimers();
	});
});
