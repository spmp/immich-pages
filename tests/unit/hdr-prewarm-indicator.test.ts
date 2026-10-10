import { describe, expect, it } from 'vitest';
import { parseHdrIndicator } from '../../src/routes/share/[kind]/[ref]/+page.server';

describe('HDR prewarm indicator configuration', () => {
	it.each([
		['on', { enabled: true, category: 'explicit' }],
		['off', { enabled: false, category: 'explicit' }],
		[undefined, { enabled: true, category: 'default' }],
		['', { enabled: true, category: 'invalid' }],
		[' ON ', { enabled: true, category: 'invalid' }],
		['unknown', { enabled: true, category: 'invalid' }]
	])('parses %s without exposing the raw value', (value, expected) => {
		expect(parseHdrIndicator(value)).toEqual(expected);
	});
});
