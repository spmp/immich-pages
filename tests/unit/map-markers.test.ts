import { describe, expect, it } from 'vitest';
import { MAX_MARKERS, projectMapMarkers } from '../../src/lib/server/map/markers';

const id = (n: number) => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const asset = (n: number, date = `2024-01-${String(n + 1).padStart(2, '0')}T00:00:00Z`) => ({ id: id(n), type: 'IMAGE', localDateTime: date });
const marker = (n: number) => ({ id: id(n), lat: n % 90, lon: n % 180, city: null, state: null, country: null });

describe('permission-aware map markers', () => {
	it('keeps only valid markers belonging to authorized assets', () => {
		const result = projectMapMarkers([marker(1), marker(2), { ...marker(3), id: id(999) }, { ...marker(4), lat: 91 }, { ...marker(5), id: 'not-an-id' }], [asset(1), asset(2)]);
		expect(result.markers.map(({ id }) => id)).toEqual([id(1), id(2)]);
	});

	it('bounds input deterministically and warns about overflow', () => {
		const assets = Array.from({ length: MAX_MARKERS + 1 }, (_, n) => asset(n));
		const result = projectMapMarkers(assets.map((_, n) => marker(n)), assets);
		expect(result.markers).toHaveLength(MAX_MARKERS);
		expect(result.markers[0].id).toBe(id(0));
		expect(result.markers.at(-1)?.id).toBe(id(MAX_MARKERS - 1));
		expect(result.warnings).toContain('map-marker-limit');
	});
});
