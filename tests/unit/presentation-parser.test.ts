import { describe, expect, it } from 'vitest';
import { parsePresentationDocument } from '../../src/lib/server/presentation/frontmatter';

describe('presentation frontmatter', () => {
	it('classifies absent, unrelated, valid, and invalid documents', () => {
		expect(parsePresentationDocument('plain story').kind).toBe('absent');
		expect(parsePresentationDocument('---\nother: value\n---\nstory').kind).toBe('unrelated');
		const valid = parsePresentationDocument('---\nimmich-presentation:\n  type: journey\n  version: 1\n---\n# Story');
		expect(valid.kind).toBe('valid');
		if (valid.kind === 'valid') expect(valid.config.template).toBe('journal');
		expect(parsePresentationDocument('---\nimmich-presentation:\n  type: no\n  version: 1\n---').kind).toBe('invalid');
	});

	it('rejects duplicate keys, aliases, and non-object roots without leaking input', () => {
		const duplicate = parsePresentationDocument('---\nimmich-presentation:\n  type: journey\n  type: journey\n  version: 1\n---');
		expect(duplicate).toMatchObject({ kind: 'invalid', reason: 'duplicate-key' });
		const alias = parsePresentationDocument('---\na: &a [one]\nb: *a\nimmich-presentation:\n  type: journey\n  version: 1\n---');
		expect(alias.kind).toBe('invalid');
		const scalar = parsePresentationDocument('---\n- one\n- two\n---');
		expect(scalar).toMatchObject({ kind: 'invalid', reason: 'non-object-root' });
		expect(JSON.stringify(duplicate)).not.toContain('journey');
	});
});
