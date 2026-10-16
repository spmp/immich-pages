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

	it('honours a per-entry lifetime and holds values other than routes', () => {
		const cache = new BrouterLruCache<string>();
		cache.set('brief', 'value', 0, 1_000);
		cache.set('default', 'value', 0);
		expect(cache.get('brief', 999)).toBe('value');
		expect(cache.get('brief', 1_000)).toBeUndefined();
		expect(cache.get('default', 1_000)).toBe('value');
	});

	// Entries are whole road geometries of very different sizes, so a count alone does not bound
	// memory: a few hundred cross-country legs would dwarf thousands of city ones.
	it('bounds the total weight it holds, evicting least-recently-used first', () => {
		const cache = new BrouterLruCache<number[]>({ maxWeight: 10, weigh: (value) => value.length });
		cache.set('a', [1, 2, 3, 4], 0);
		cache.set('b', [1, 2, 3, 4], 0);
		expect(cache.get('a', 1)).toHaveLength(4);
		cache.set('c', [1, 2, 3, 4], 1);
		expect(cache.get('b', 2)).toBeUndefined();
		expect(cache.get('a', 2)).toHaveLength(4);
		expect(cache.get('c', 2)).toHaveLength(4);
		// Something heavier than the whole budget is simply not kept.
		cache.set('huge', Array.from({ length: 11 }, () => 0), 2);
		expect(cache.get('huge', 3)).toBeUndefined();
		expect(cache.get('c', 3)).toHaveLength(4);
	});
});
