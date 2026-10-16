import { describe, expect, it } from 'vitest';
import { normalizeRouteGeometry } from '../../src/lib/server/map/geometry';

describe('geojson route adapter', () => {
	it('accepts a bounded JSON string and ignores foreign members', () => {
		const value = JSON.stringify({ type: 'Feature', properties: { secret: 'ignored' }, geometry: { type: 'LineString', coordinates: [[-105.27, 40.01], [-109.54, 38.57]] }, foreign: { nested: true } });
		expect(normalizeRouteGeometry(value)).toEqual({ kind: 'resolved', route: { type: 'LineString', coordinates: [[-105.27, 40.01], [-109.54, 38.57]] }, warnings: [] });
	});

	it('rejects oversized JSON before parsing', () => {
		const result = normalizeRouteGeometry(`{"type":"LineString","coordinates":${' '.repeat(64 * 1024)}}`);
		expect(result).toEqual({ kind: 'unavailable', warnings: ['map-route-invalid'] });
	});
});
