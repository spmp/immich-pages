import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The HDR release-evidence scripts write a report about real conversions. Whatever they print or
// record must never include credentials or media, and a failed conversion must be reported as a
// fallback to the standard photo, never as success.
const scripts = ['scripts/verify-hdr-container.mjs', 'scripts/hdr-fixture-matrix.mjs'];

describe('HDR release evidence scripts', () => {
	it('never log secrets or media, and report failures as an SDR fallback', () => {
		for (const script of scripts) {
			const source = readFileSync(script, 'utf8');
			expect(source).not.toMatch(/console\.log\([^\n]*(?:password|cookie|authorization|raw stderr|raw media)/i);
			expect(source).toContain('sdr-fallback');
		}
	});
});
