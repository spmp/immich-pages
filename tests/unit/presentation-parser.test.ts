import { describe, expect, it, vi } from 'vitest';
import { parsePresentationDocument } from '../../src/lib/server/presentation/frontmatter';

const prefix = (gradient: string) => `---\nimmich-presentation:\n  type: journey\n  version: 1\n${gradient}\n---`;

describe('presentation frontmatter', () => {
	it('accepts and normalizes a strict gradient', () => {
		const result = parsePresentationDocument(prefix('  gradient:\n    direction: 135deg\n    top: "#ABCDEF"\n    bottom: "#123456"'));
		expect(result.kind).toBe('valid');
	if (result.kind === 'valid') expect(result.config.gradient).toEqual({ auto: false, direction: '135deg', top: '#abcdef', bottom: '#123456' });
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

	it('activates with full defaults from an empty or bare immich-presentation key', () => {
		const empty = parsePresentationDocument('---\nimmich-presentation: {}\n---\nStory');
		expect(empty).toMatchObject({ kind: 'valid', markdown: 'Story' });
		if (empty.kind === 'valid') expect(empty.config).toMatchObject({ type: 'journey', version: 1, template: 'journal', map: { enabled: true, source: 'auto', styleName: 'quiet-atlas' } });

		// A bare key (YAML null) is the same as an empty mapping -- only a genuinely wrong type
		// (a string, number, or array where a mapping belongs) should still be invalid-schema.
		const bare = parsePresentationDocument('---\nimmich-presentation:\n---\nStory');
		expect(bare).toMatchObject({ kind: 'valid' });
		expect(parsePresentationDocument('---\nimmich-presentation: "not a mapping"\n---')).toMatchObject({ kind: 'invalid', reason: 'invalid-schema' });
		expect(parsePresentationDocument('---\nimmich-presentation:\n  - not\n  - a\n  - mapping\n---')).toMatchObject({ kind: 'invalid', reason: 'invalid-schema' });
	});

	describe('PAGES_ALL_ALBUMS_ARE_PAGES', () => {
		it('defaults to false: albums without relevant frontmatter stay non-pages', () => {
			expect(parsePresentationDocument(null)).toMatchObject({ kind: 'absent' });
			expect(parsePresentationDocument('---\nsome: other\nfrontmatter: here\n---')).toMatchObject({ kind: 'unrelated' });
		});

		it('when true, activates albums with no frontmatter, or unrelated frontmatter, using full defaults', () => {
			vi.stubEnv('PAGES_ALL_ALBUMS_ARE_PAGES', 'true');
			try {
				const noFrontmatter = parsePresentationDocument('Just a plain album description.');
				expect(noFrontmatter).toMatchObject({ kind: 'valid', markdown: 'Just a plain album description.' });
				if (noFrontmatter.kind === 'valid') expect(noFrontmatter.config).toMatchObject({ type: 'journey', version: 1, map: { enabled: true, source: 'auto' } });

				const nullDescription = parsePresentationDocument(null);
				expect(nullDescription).toMatchObject({ kind: 'valid' });

				const unrelated = parsePresentationDocument('---\nsome: other\nfrontmatter: here\n---\nNarrative');
				expect(unrelated).toMatchObject({ kind: 'valid', markdown: 'Narrative' });
			} finally {
				vi.unstubAllEnvs();
			}
		});

		it('when true, still surfaces genuinely malformed immich-presentation config as an error rather than silently defaulting it', () => {
			vi.stubEnv('PAGES_ALL_ALBUMS_ARE_PAGES', 'true');
			try {
				expect(parsePresentationDocument('---\nimmich-presentation:\n  type: journey\n  version: 2\n---')).toMatchObject({ kind: 'invalid', reason: 'invalid-schema' });
			} finally {
				vi.unstubAllEnvs();
			}
		});
	});
});
