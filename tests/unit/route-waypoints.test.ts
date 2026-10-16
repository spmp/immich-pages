import { describe, expect, it } from 'vitest';
import { resolveWaypoints } from '../../src/lib/server/map/path-adapters';

describe('waypoint route adapter', () => {
	it('preserves order and repeated origins', () => {
		expect(resolveWaypoints([[20, 10], [21, 11], [20, 10]])).toEqual({ kind: 'resolved', route: { type: 'LineString', coordinates: [[20, 10], [21, 11], [20, 10]] }, warnings: [] });
	});

	it('rejects short, out-of-range, non-finite, and oversized input safely', () => {
		for (const input of [[], [[20, 10]], [[181, 10], [20, 10]], [[20, Number.NaN], [20, 10]], Array.from({ length: 501 }, () => [20, 10])]) {
			expect(resolveWaypoints(input).kind).toBe('unavailable');
		}
	});
});
