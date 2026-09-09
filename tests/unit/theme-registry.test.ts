import { describe, expect, it } from 'vitest';
import { BASELINE_THEME_KEY, THEME_KEYS, THEME_REGISTRY, normalizeThemeKey, resetThemeKey } from '$lib/theme/registry';
import { readStoredThemeKey } from '$lib/theme/state.svelte';

describe('temporary theme registry', () => {
	it('contains exactly the seven fixed candidates with a documented baseline', () => {
		expect(THEME_KEYS).toEqual(['studio-modern', 'studio', 'minimal', 'editorial', 'classic', 'noir', 'monograph']);
		expect(BASELINE_THEME_KEY).toBe('studio-modern');
		expect(Object.keys(THEME_REGISTRY)).toEqual([...THEME_KEYS]);
	});

	it.each(THEME_KEYS)('normalizes the allowlisted key %s', (key) => {
		expect(normalizeThemeKey(key)).toBe(key);
	});

	it.each([undefined, null, '', 'custom', 'body { color: red }', 42, {}])('falls back for untrusted value %s', (value) => {
		expect(normalizeThemeKey(value)).toBe(BASELINE_THEME_KEY);
	});

	it('reset always returns the baseline', () => {
		expect(resetThemeKey()).toBe(BASELINE_THEME_KEY);
	});

	it('does not read browser-local state during SSR', () => {
		expect(readStoredThemeKey()).toBe(BASELINE_THEME_KEY);
	});
});
