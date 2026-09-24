import { describe, expect, it } from 'vitest';
import { BrouterLruCache, BROUTER_CACHE_MAX_ENTRIES, BROUTER_CACHE_TTL_MS } from '../../src/lib/server/map/brouter-cache';

const route = { type: 'LineString' as const, coordinates: [[1, 2], [3, 4]] as Array<[number, number]> };

describe('BRouter LRU cache', () => {
	it('refreshes recency, expires entries, and bounds capacity', () => {
		const cache = new BrouterLruCache();
		cache.set('first', route, 0);
		cache.set('second', route, 0);
		expect(cache.get('first', 1)).toEqual(route);
		for (let index = 0; index < BROUTER_CACHE_MAX_ENTRIES - 1; index += 1) cache.set(`entry-${index}`, route, 1);
		expect(cache.get('second', 2)).toBeUndefined();
		expect(cache.get('first', 2)).toEqual(route);
		expect(cache.get('first', BROUTER_CACHE_TTL_MS + 1)).toBeUndefined();
	});
});
