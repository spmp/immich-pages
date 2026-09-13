import { describe, expect, it } from 'vitest';
import { parsePresentationDocument } from '../../src/lib/server/presentation/frontmatter';

const prefix = (gradient: string) => `---\nimmich-presentation:\n  type: journey\n  version: 1\n${gradient}\n---`;

describe('presentation frontmatter', () => {
	it('accepts and normalizes a strict gradient', () => {
		const result = parsePresentationDocument(prefix('  gradient:\n    direction: 135deg\n    top: "#ABCDEF"\n    bottom: "#123456"'));
		expect(result.kind).toBe('valid');
		if (result.kind === 'valid') expect(result.config.gradient).toEqual({ direction: '135deg', top: '#abcdef', bottom: '#123456' });
	});

	it.each([
		'  gradient:\n    direction: "to right"\n    top: "#abcdef"\n    bottom: "#123456"',
		'  gradient:\n    direction: "to bottom"\n    top: "#fff"\n    bottom: "#123456"',
		'  gradient:\n    direction: "to bottom"\n    top: "rgba(0,0,0,1)"\n    bottom: "#123456"',
		'  gradient:\n    direction: "to bottom"\n    top: "#abcdef"\n    bottom: "#123456"\n    extra: true'
	])('rejects malformed gradient input: %s', (gradient) => {
		expect(parsePresentationDocument(prefix(gradient))).toMatchObject({ kind: 'invalid', reason: 'invalid-schema' });
	});

	it('does not classify valid gradient metadata as unknown fields', () => {
		const result = parsePresentationDocument(prefix('  gradient:\n    direction: to bottom\n    top: "#abcdef"\n    bottom: "#123456"'));
		expect(result).toMatchObject({ kind: 'valid', warnings: [] });
	});

	it('retains safe parser boundaries for duplicate keys and aliases', () => {
		expect(parsePresentationDocument('---\nimmich-presentation:\n  type: journey\n  type: journey\n  version: 1\n---')).toMatchObject({ kind: 'invalid', reason: 'duplicate-key' });
		expect(parsePresentationDocument('---\na: &a [one]\nb: *a\nimmich-presentation:\n  type: journey\n  version: 1\n---')).toMatchObject({ kind: 'invalid', reason: 'alias-not-allowed' });
	});
});
