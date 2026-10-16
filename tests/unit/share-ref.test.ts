import { describe, expect, it } from 'vitest';
import { operationScope, parseSharedLinkRef } from '../../src/lib/server/share/ref';

// hdr-caching-uat-20261010 Specialist Review finding 1: the prewarm route and the two interactive
// HDR media routes must compute the IDENTICAL scope string for the same share, or an interactive
// job silently lands in a different coordinator bucket than the background prewarm work for that
// same share and goes unreported by that share's own readiness snapshot. A single shared function
// (rather than copies in each route) is what keeps that guaranteed.
describe('operationScope', () => {
	it('is identical for the same share ref, computed independently', () => {
		const ref = parseSharedLinkRef('key', 'opaque-ref');
		expect(ref).not.toBeNull();
		if (!ref) return;
		expect(operationScope(ref)).toBe(operationScope({ kind: 'key', value: 'opaque-ref' }));
	});

	it('differs by kind and by value', () => {
		expect(operationScope({ kind: 'key', value: 'abc' })).not.toBe(operationScope({ kind: 'slug', value: 'abc' }));
		expect(operationScope({ kind: 'key', value: 'abc' })).not.toBe(operationScope({ kind: 'key', value: 'def' }));
	});

	it('is a bounded, filesystem/log-safe identifier', () => {
		const scope = operationScope({ kind: 'key', value: 'a'.repeat(500) });
		expect(scope.length).toBeLessThanOrEqual(160);
		expect(scope).toMatch(/^[A-Za-z0-9._:-]+$/);
	});
});
