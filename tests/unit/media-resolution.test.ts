import { describe, expect, it } from 'vitest';
import { chooseResolution, requiredWidth } from '../../src/lib/media/resolution';

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
});
