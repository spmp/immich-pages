import { describe, expect, it } from 'vitest';
import { BASELINE_THEME_KEY, SSR_THEME_KEY, THEME_KEYS, THEME_REGISTRY, normalizeThemeKey, resetThemeKey, resolveThemeKey } from '$lib/theme/registry';
import { readStoredThemeKey } from '$lib/theme/state.svelte';

describe('production theme registry', () => {
	it('exports exactly the three production keys and a dark SSR baseline', () => {
		expect(THEME_KEYS).toEqual(['default', 'light', 'dark']);
		expect(Object.keys(THEME_REGISTRY)).toEqual(['default', 'light', 'dark']);
		expect(BASELINE_THEME_KEY).toBe('default');
		expect(SSR_THEME_KEY).toBe('dark');
	});

	it.each(THEME_KEYS)('normalizes the allowlisted key %s', (key) => {
		expect(normalizeThemeKey(key)).toBe(key);
	});

	it.each([undefined, null, '', 'system', 'studio-modern', 'noir', 'body { color: red }', 42, {}])('resets legacy or untrusted value %s to default', (value) => {
		expect(normalizeThemeKey(value)).toBe('default');
	});

	it('resolves default to light or dark only after the OS preference is known', () => {
		expect(resolveThemeKey('default', false)).toBe('light');
		expect(resolveThemeKey('default', true)).toBe('dark');
		expect(resolveThemeKey('light', true)).toBe('light');
		expect(resolveThemeKey('dark', false)).toBe('dark');
	});

	it('resets the browser-local selection to default and does not read storage during SSR', () => {
		expect(resetThemeKey()).toBe('default');
		expect(readStoredThemeKey()).toBe('default');
	});

	it('does not throw when browser storage access fails', () => {
		const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
		Object.defineProperty(globalThis, 'window', { configurable: true, value: { get localStorage() { throw new Error('blocked'); } } });
		expect(readStoredThemeKey()).toBe('default');
		if (previous) Object.defineProperty(globalThis, 'window', previous);
		else delete (globalThis as { window?: unknown }).window;
	});
});
