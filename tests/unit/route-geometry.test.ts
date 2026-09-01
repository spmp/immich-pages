import { describe, expect, it } from 'vitest';
import { normalizeRouteGeometry } from '../../src/lib/server/map/geometry';

describe('bounded route geometry', () => {
	it('preserves exact LineString and MultiLineString values through supported wrappers', () => {
		const line = { type: 'LineString', coordinates: [[20.123456, 10.654321], [21, 11]] };
		const multi = { type: 'MultiLineString', coordinates: [[[20, 10], [21, 11]], [[30, 12], [31, 13]]] };
		expect(normalizeRouteGeometry(line)).toMatchObject({ kind: 'resolved', route: line });
		expect(normalizeRouteGeometry({ type: 'Feature', geometry: multi })).toMatchObject({ kind: 'resolved', route: multi });
		expect(normalizeRouteGeometry({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: line }, { type: 'Feature', geometry: multi }] })).toMatchObject({ kind: 'resolved', route: { type: 'MultiLineString', coordinates: [line.coordinates, ...multi.coordinates] } });
	});

	it('rejects unsupported, malformed, and unsafe geometry as a safe unavailable result', () => {
		for (const value of [{ type: 'Point', coordinates: [1, 2] }, { type: 'LineString', coordinates: [[1, 2]] }, { type: 'LineString', coordinates: [[Infinity, 2], [1, 2]] }, '{bad json', null]) {
			const result = normalizeRouteGeometry(value);
			expect(result.kind).toBe('unavailable');
			expect(result.warnings).toEqual(['map-route-invalid']);
		}
	});
});
