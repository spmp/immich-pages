import { describe, expect, it } from 'vitest';
import { presentationCopy, routeErrorCopy } from '../../src/lib/components/journal/presentation-copy';
import { readFileSync } from 'node:fs';

describe('branded presentation states', () => {
	it('uses the approved calm copy for invalid, empty, and temporary states', () => {
		expect(presentationCopy('empty').heading).toBe('No photographs to show yet');
		expect(presentationCopy('empty').body).toContain('Return to the album');
		expect(presentationCopy('invalid').body).toContain('Ask the album owner');
		expect(presentationCopy('temporary').body).toBe('Please check the link and try again.');
	});

	it('maps only safe status classes and ignores hostile error details', () => {
		const hostile = { message: 'stack request-id https://internal cookie upstream body' };
		for (const status of [404, 401, 403, 503, 500, 418]) {
			const copy = routeErrorCopy(status);
			expect(JSON.stringify(copy)).not.toContain(hostile.message);
		}
		const source = readFileSync('src/routes/share/[kind]/[ref]/+error.svelte', 'utf8');
		expect(source).not.toMatch(/error\.message|\{error\}/);
		expect(source).toContain('routeErrorCopy');
		expect(source).toContain('<PresentationState copy={copy}');
	});
});
