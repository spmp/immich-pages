import { describe, expect, it } from 'vitest';
import { deriveAutoRoute } from '../../src/lib/server/map/auto-route';

const asset = (id: string, localDateTime?: string, createdAt?: string) => ({ id, type: 'IMAGE', localDateTime, createdAt });
const marker = (id: string, lat: number, lon: number) => ({ id, lat, lon });

describe('automatic map route', () => {
	it('sorts by local date, then created date, preserving album-index ties', () => {
		const assets = [asset('a', '2024-01-02'), asset('b', undefined, '2024-01-01'), asset('c', '2024-01-01')];
		const result = deriveAutoRoute([marker('a', 3, 3), marker('b', 1, 1), marker('c', 2, 2)], assets);
		expect(result.routeData?.coordinates).toEqual([[1, 1], [2, 2], [3, 3]]);
	});

	it('suppresses exact and near consecutive duplicates but retains a later point', () => {
		const assets = [asset('a', '2024-01-01'), asset('b', '2024-01-02'), asset('c', '2024-01-03'), asset('d', '2024-01-04')];
		const result = deriveAutoRoute([marker('a', 0, 0), marker('b', 0, 0), marker('c', 0.0001, 0.0001), marker('d', 1, 1)], assets);
		expect(result.routeData?.coordinates).toHaveLength(2);
	});

	it('does not draw a line for zero or one retained point', () => {
		expect(deriveAutoRoute([], []).routeData).toBeNull();
		expect(deriveAutoRoute([marker('a', 0, 0)], [asset('a', '2024-01-01')]).routeData).toBeNull();
	});
});
