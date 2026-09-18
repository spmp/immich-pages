import { describe, expect, it } from 'vitest';
import { chooseResolution, requiredWidth, selectTargetResolution } from '../../src/lib/media/resolution';

describe('rendered-slot resolution policy', () => {
	it('caps DPR at two and rounds up required pixels', () => {
		expect(requiredWidth(400, 1.5)).toBe(600);
		expect(requiredWidth(400, 3)).toBe(800);
	});

	it.each([
		[400, 800, 2, 'thumbnail'],
		[400, 799, 2.01, 'fullsize'],
		[400, 799, 2, 'fullsize'],
		[400, 1200, 3, 'thumbnail'],
		[0, 0, 1, 'thumbnail'],
		[400, null, 1, 'thumbnail'],
		[Number.NaN, 100, 1, 'thumbnail']
	] as const)('chooses %s for css=%s intrinsic=%s dpr=%s', (cssWidth, intrinsicWidth, dpr, expected) => {
		expect(chooseResolution(cssWidth, intrinsicWidth, dpr)).toBe(expected);
	});

	it('preserves portrait and landscape aspect ratios under native bounds', () => {
		const portrait = selectTargetResolution(1200, 2400, 900, 1600);
		const landscape = selectTargetResolution(4000, 2000, 1600, 1600);
		expect(portrait).toMatchObject({ width: 800, height: 1600, bounded: true });
		expect(landscape).toMatchObject({ width: 1600, height: 800, bounded: true });
		expect((portrait!.width / portrait!.height)).toBeCloseTo(0.5);
		expect((landscape!.width / landscape!.height)).toBeCloseTo(2);
	});

	it('rejects unknown dimensions instead of inventing a source size', () => {
		expect(selectTargetResolution(null, 1000)).toBeNull();
		expect(selectTargetResolution(Number.NaN, 1000)).toBeNull();
	});
});
