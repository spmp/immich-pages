import { describe, expect, it } from 'vitest';
import { HdrMediaCache } from '../../src/lib/media/hdr-media-cache';

describe('promoted HDR media cache', () => {
	it('returns the same promoted element for a recreated PhotoSwipe content item', () => {
		const cache = new HdrMediaCache();
		const media = {} as HTMLImageElement;

		cache.set('avif', '/hdr/asset.avif', media);

		expect(cache.get('avif', '/hdr/asset.avif')).toBe(media);
		expect(cache.get('avif', '/hdr/other.avif')).toBeUndefined();
		expect(cache.get('video', '/hdr/asset.avif')).toBeUndefined();
	});

	it('clears entries when the owning lightbox is destroyed', () => {
		const cache = new HdrMediaCache();
		cache.set('video', '/hdr/asset.mp4', {} as HTMLVideoElement);

		cache.clear();

		expect(cache.get('video', '/hdr/asset.mp4')).toBeUndefined();
	});
});

// lightbox-mobile-crash: on a real phone the lightbox held every HDR video it had ever promoted
// (15 and 19 of them at the two recorded tab kills). The cache is what kept them alive past
// PhotoSwipe's own slide eviction, so the cache is what has to bound them.
describe('promoted HDR media cache retention', () => {
	const media = (name: string) => ({ name }) as unknown as HTMLVideoElement;
	const setup = (maxIdle: number) => {
		const released: unknown[] = [];
		const cache = new HdrMediaCache({ maxIdle, release: (item) => released.push(item) });
		return { cache, released };
	};

	it('releases the oldest media no slide is using once more than maxIdle are idle', () => {
		const { cache, released } = setup(1);
		const [a, b, c] = [media('a'), media('b'), media('c')];
		cache.set('video', '/a', a);
		cache.set('video', '/b', b);
		cache.set('video', '/c', c);
		cache.idle(a);
		expect(released).toEqual([]);
		cache.idle(b);
		expect(released).toEqual([a]);
		expect(cache.get('video', '/a')).toBeUndefined();
		expect(cache.values()).toEqual([b, c]);
	});

	it('never releases media a slide is still using, however many there are', () => {
		const { cache, released } = setup(0);
		for (const name of ['a', 'b', 'c', 'd', 'e', 'f']) cache.set('video', `/${name}`, media(name));
		expect(released).toEqual([]);
		expect(cache.values()).toHaveLength(6);
	});

	it('hands idle media back to a recreated slide and stops counting it as idle', () => {
		const { cache, released } = setup(1);
		const [a, b] = [media('a'), media('b')];
		cache.set('video', '/a', a);
		cache.set('video', '/b', b);
		cache.idle(a);
		expect(cache.get('video', '/a')).toBe(a);
		cache.idle(b);
		expect(released).toEqual([]);
		cache.idle(a);
		expect(released).toEqual([b]);
	});

	it('keeps media in use until every slide that took it has let go', () => {
		const { cache, released } = setup(0);
		const a = media('a');
		cache.set('video', '/a', a);
		expect(cache.get('video', '/a')).toBe(a);
		cache.idle(a);
		expect(released).toEqual([]);
		cache.idle(a);
		expect(released).toEqual([a]);
	});

	it('releases everything when cleared, and ignores media it does not hold', () => {
		const { cache, released } = setup(2);
		const [a, b] = [media('a'), media('b')];
		cache.set('video', '/a', a);
		cache.set('avif', '/b', b);
		cache.idle(a);
		expect(() => cache.idle(media('stranger'))).not.toThrow();
		cache.clear();
		expect(released).toEqual([a, b]);
		expect(cache.values()).toEqual([]);
	});
});
