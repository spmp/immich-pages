import { describe, expect, it } from 'vitest';
import { PathSourceRegistry } from '../../src/lib/server/map/path-adapters';

const context = { markers: [{ id: 'a', lon: 1, lat: 2 }, { id: 'b', lon: 3, lat: 4 }], assets: [] };

describe('path source precedence', () => {
	it.each([
		['auto', undefined, 'unavailable'],
		['waypoints', [[10, 20], [30, 40]], 'LineString'],
		['geojson', JSON.stringify({ type: 'MultiLineString', coordinates: [[[10, 20], [30, 40]], [[50, 60], [70, 80]]] }), 'MultiLineString']
	] as const)('dispatches %s through the registry', async (source, input, geometry) => {
		const result = await new PathSourceRegistry().resolve({ source, ...(source === 'waypoints' ? { waypoints: input } : source === 'geojson' ? { geojson: input } : {}) }, context);
		expect(result.kind).toBe(geometry === 'unavailable' ? 'unavailable' : 'resolved');
		if (result.kind === 'resolved') expect(result.route.type).toBe(geometry);
	});

	it('does not replace an invalid explicit source with auto GPS', async () => {
		const result = await new PathSourceRegistry().resolve({ source: 'waypoints', waypoints: [[10, 20]] }, context);
		expect(result).toEqual({ kind: 'unavailable', warnings: ['map-route-invalid'] });
	});

	it('keeps exact MultiLineString segments intact', async () => {
		const route = { type: 'MultiLineString' as const, coordinates: [[[10, 20], [30, 40]], [[50, 60], [70, 80]]] };
		const result = await new PathSourceRegistry().resolve({ source: 'geojson', geojson: route }, context);
		expect(result).toEqual({ kind: 'resolved', route, warnings: [] });
	});
});
