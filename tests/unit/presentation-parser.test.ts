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

	it('bounds deep and oversized documents and reports unknown fields safely', () => {
		const deep = 'immich-presentation:\n  type: journey\n  version: 1\n  hero:\n    x:\n      x:\n        x:\n          x:\n            x:\n              x:\n                x:\n                  x:\n                    x: value';
		expect(parsePresentationDocument(`---\n${deep}\n---`).kind).toBe('invalid');
		const unknown = parsePresentationDocument('---\nimmich-presentation:\n  type: journey\n  version: 1\n  future-option: secret\n---');
		expect(unknown).toMatchObject({ kind: 'valid', warnings: ['unknown-fields'] });
		expect(JSON.stringify(unknown)).not.toContain('secret');
	});

	it('defaults map activation off and accepts only named presentation settings', () => {
		const defaultMap = parsePresentationDocument('---\nimmich-presentation:\n  type: journey\n  version: 1\n---');
		expect(defaultMap.kind).toBe('valid');
		if (defaultMap.kind === 'valid') expect(defaultMap.config.map).toEqual({ enabled: false, source: 'auto', styleName: 'quiet-atlas', markerActivation: 'gallery' });
		const enabled = parsePresentationDocument('---\nimmich-presentation:\n  type: journey\n  version: 1\n  map:\n    enabled: true\n    source: waypoints\n    styleName: quiet-atlas\n    markerActivation: lightbox\n---');
		expect(enabled.kind).toBe('valid');
		if (enabled.kind === 'valid') expect(enabled.config.map).toMatchObject({ enabled: true, source: 'waypoints', markerActivation: 'lightbox' });
	});

	it('does not permit arbitrary style URLs to become schema values', () => {
		const result = parsePresentationDocument('---\nimmich-presentation:\n  type: journey\n  version: 1\n  map:\n    enabled: true\n    styleUrl: https://evil.example/style.json\n---');
		expect(result.kind).toBe('valid');
		if (result.kind === 'valid') {
			expect(result.config.map).not.toHaveProperty('styleUrl');
			expect(result.warnings).toContain('unknown-fields');
		}
	});
});
