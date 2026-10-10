import { describe, expect, it } from 'vitest';
import { HdrMediaCache } from '../../src/lib/media/hdr-media-cache';

describe('promoted HDR media cache', () => {
	it('returns the same promoted element for a recreated PhotoSwipe content item', () => {
		const cache = new HdrMediaCache();
		const media = {} as HTMLImageElement;

		cache.set('/hdr/asset.avif', media);

		expect(cache.get('/hdr/asset.avif')).toBe(media);
		expect(cache.get('/hdr/other.avif')).toBeUndefined();
	});

	it('clears entries when the owning lightbox is destroyed', () => {
		const cache = new HdrMediaCache();
		cache.set('/hdr/asset.mp4', {} as HTMLVideoElement);

		cache.clear();

		expect(cache.get('/hdr/asset.mp4')).toBeUndefined();
	});
});
