import { describe, expect, it } from 'vitest';
import { resolveMapStyle } from '$server/map/style-registry';

describe('resolveMapStyle', () => {
	const env = { MAP_STYLE_URL_QUIET_ATLAS: 'https://maps.example.test/styles/quiet-atlas.json' };

	it('resolves the approved quiet-atlas name from deployment configuration', () => {
		expect(resolveMapStyle({ styleName: 'quiet-atlas' }, env)).toEqual({
			kind: 'resolved',
			name: 'quiet-atlas',
			url: env.MAP_STYLE_URL_QUIET_ATLAS
		});
	});

	it.each([
		['unknown name', { styleName: 'custom' }, 'unknown-style'],
		['missing configuration', { styleName: 'quiet-atlas' }, 'missing-style-url'],
		['malformed URL', { styleName: 'quiet-atlas' }, 'invalid-style-url'],
		['non-http URL', { styleName: 'quiet-atlas' }, 'invalid-style-url']
	])('fails closed for %s', (_label, input, warning) => {
		const inputEnv = _label === 'missing configuration'
			? {}
			: _label === 'malformed URL'
				? { MAP_STYLE_URL_QUIET_ATLAS: 'not-a-url' }
				: _label === 'non-http URL'
					? { MAP_STYLE_URL_QUIET_ATLAS: 'file:///tmp/style.json' }
					: env;
		expect(resolveMapStyle(input, inputEnv)).toEqual({ kind: 'warning', warning });
	});

	it('rejects a content-controlled style URL', () => {
		expect(resolveMapStyle({ styleName: 'quiet-atlas', styleUrl: 'https://attacker.example/style.json' }, env)).toEqual({
			kind: 'warning',
			warning: 'content-controlled-style-url'
		});
	});

	it('returns only the approved name and resolved URL', () => {
		const result = resolveMapStyle({ styleName: 'quiet-atlas' }, env);
		if (result.kind !== 'resolved') throw new Error('expected resolved style');
		expect(Object.keys(result).sort()).toEqual(['kind', 'name', 'url']);
		expect(result).not.toHaveProperty('env');
	});
});
