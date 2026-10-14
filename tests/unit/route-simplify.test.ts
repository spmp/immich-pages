import { describe, expect, it } from 'vitest';
import { simplifyLine } from '../../src/lib/server/map/geometry';

type Position = [number, number];
const wavy = (count: number): Position[] => Array.from({ length: count }, (_, index) => [index / 1000, Math.sin(index / 50) * 0.05]);

describe('route line simplification', () => {
	it('leaves a line that already fits untouched', () => {
		const line = wavy(100);
		expect(simplifyLine(line, 100)).toBe(line);
	});

	it('brings a line under the vertex budget, keeping both ends and the shape', () => {
		const line = wavy(50_000);
		const simplified = simplifyLine(line, 2_000);
		expect(simplified.length).toBeLessThanOrEqual(2_000);
		expect(simplified.length).toBeGreaterThan(200);
		expect(simplified[0]).toEqual(line[0]);
		expect(simplified.at(-1)).toEqual(line.at(-1));
		// Every kept vertex is one of the originals, in order -- nothing invented or reordered.
		let cursor = 0;
		for (const point of simplified) { cursor = line.indexOf(point, cursor); expect(cursor).toBeGreaterThanOrEqual(0); }
		// The crests of the wave survive: the shape is thinned, not flattened.
		expect(Math.max(...simplified.map(([, lat]) => lat))).toBeGreaterThan(0.049);
	});

	it('drops redundant points on a straight road before anything that carries shape', () => {
		const line: Position[] = [...Array.from({ length: 5_000 }, (_, index): Position => [index / 1000, 0]), [5, 1], [5, 2]];
		const simplified = simplifyLine(line, 10);
		expect(simplified).toContainEqual([4.999, 0]);
		expect(simplified.length).toBeLessThanOrEqual(10);
	});

	it('always terminates within budget, even for a line that zigzags at every vertex', () => {
		const line: Position[] = Array.from({ length: 300_000 }, (_, index) => [index / 10_000, index % 2]);
		const simplified = simplifyLine(line, 1_000);
		expect(simplified.length).toBeLessThanOrEqual(1_000);
		expect(simplified[0]).toEqual(line[0]);
		expect(simplified.at(-1)).toEqual(line.at(-1));
	});
});
