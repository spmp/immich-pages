import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (name: string) => readFileSync(`src/lib/${name}`, 'utf8');

describe('temporary theme explorer contract', () => {
	it('exposes exactly the seven fixed choices and a reset action', () => {
		const explorer = source('theme/ThemeExplorer.svelte');
		const registry = source('theme/registry.ts');

		expect(registry).toContain("'studio-modern'");
		expect(registry).toContain("'studio'");
		expect(registry).toContain("'minimal'");
		expect(registry).toContain("'editorial'");
		expect(registry).toContain("'classic'");
		expect(registry).toContain("'noir'");
		expect(registry).toContain("'monograph'");
		expect(explorer).toContain('aria-label="Temporary theme explorer"');
		expect(explorer).toContain('<select');
		expect(explorer).toContain('Reset default');
		expect(explorer).toContain('theme.reset()');
	});

	it('normalizes interaction through state and emits only the fixed theme attribute', () => {
		const explorer = source('theme/ThemeExplorer.svelte');
		const state = source('theme/state.svelte.ts');
		const root = source('components/journal/ThemeRoot.svelte');

		expect(explorer).toContain('theme.select(value)');
		expect(state).toContain('normalizeThemeKey(value)');
		expect(state).toContain('normalizeThemeKey(storage()?.getItem(THEME_STORAGE_KEY))');
		expect(root).toContain('data-theme={normalizedKey}');
		expect(root).not.toContain('style=');
		expect(root).not.toContain('class={');
	});

	it('keeps theme selection in the presentation shell rather than route or auth inputs', () => {
		const page = source('components/journal/JournalPage.svelte');
		const root = source('components/journal/ThemeRoot.svelte');

		expect(page).toContain('ThemeRoot');
		expect(page).toContain('<ThemeRoot themeKey={theme.selectedKey}>');
		expect(page).not.toContain('themeKey={page.');
		expect(root).not.toContain('href=');
		expect(root).not.toContain('fetch(');
		expect(root).not.toContain('Authorization');
		expect(root).not.toContain('Cookie');
	});
});
