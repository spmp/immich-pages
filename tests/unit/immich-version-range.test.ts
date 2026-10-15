import { describe, expect, it } from 'vitest';
import { DEFAULT_SUPPORTED_IMMICH_VERSIONS, satisfiesVersionRange } from '../../src/lib/server/immich/version-range';

// /health/immich used to report every Immich release other than exactly 3.3.1 as unsupported.
// The setting is now a range of releases known to work.
describe('Immich version range', () => {
	it('defaults to the Immich 3.x releases Pages has been tested against', () => {
		expect(DEFAULT_SUPPORTED_IMMICH_VERSIONS).toBe('>=3.1.0 <4.0.0');
		for (const version of ['3.1.0', '3.3.1', 'v3.4.2']) expect(satisfiesVersionRange(version, DEFAULT_SUPPORTED_IMMICH_VERSIONS)).toBe(true);
		for (const version of ['3.0.9', '4.0.0', '2.7.5']) expect(satisfiesVersionRange(version, DEFAULT_SUPPORTED_IMMICH_VERSIONS)).toBe(false);
	});

	it('still accepts a single exact version, as before', () => {
		expect(satisfiesVersionRange('3.3.1', '3.3.1')).toBe(true);
		expect(satisfiesVersionRange('3.3.2', '3.3.1')).toBe(false);
		expect(satisfiesVersionRange('3.3.1', 'v3.3.1')).toBe(true);
	});

	it('supports each comparison, combined with spaces as "and"', () => {
		expect(satisfiesVersionRange('3.5.0', '>3.4.9 <=3.5.0')).toBe(true);
		expect(satisfiesVersionRange('3.5.1', '>3.4.9 <=3.5.0')).toBe(false);
		expect(satisfiesVersionRange('3.2.0', '=3.2.0')).toBe(true);
	});

	it('treats an unreadable version or range as not supported', () => {
		expect(satisfiesVersionRange('nightly', '>=3.1.0')).toBe(false);
		expect(satisfiesVersionRange('3.3.1', '>=banana')).toBe(false);
		expect(satisfiesVersionRange('3.3.1', '')).toBe(false);
	});
});
