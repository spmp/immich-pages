import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('shared theme surface contract', () => {
	 it('wires the journal navigation inside the themed subtree', () => {
		const page = read('src/lib/components/journal/JournalPage.svelte');
		const themeStart = page.indexOf('<ThemeRoot');
		const themeEnd = page.indexOf('</ThemeRoot>');
		expect(themeStart).toBeGreaterThanOrEqual(0);
		expect(themeEnd).toBeGreaterThan(themeStart);
		expect(page.slice(themeStart, themeEnd)).toContain('<PageNavigation');
		expect(page.slice(themeStart, themeEnd)).toContain('mobileNavigation');
	});

	it('uses named variables across every required presentation surface', () => {
		for (const file of [
			'JournalHero.svelte',
			'JournalNarrative.svelte',
			'JournalGallery.svelte',
			'GalleryAsset.svelte',
			'JourneyMapSlot.svelte',
			'PresentationState.svelte',
			'Lightbox.svelte'
		]) {
			expect(read(`src/lib/components/journal/${file}`)).toMatch(/var\(--theme-/);
		}
	});

	it('wraps the library route in ThemeRoot and styles library-specific surfaces', () => {
		const library = read('src/routes/library/+page.svelte');
		expect(library).toContain("import ThemeRoot from '$lib/components/journal/ThemeRoot.svelte'");
		expect(library).toContain('<ThemeRoot themeKey={theme.effectiveKey}>');
		expect(library).toMatch(/\.journey-card[^}]*var\(--theme-/);
		expect(library).toMatch(/\.notice[^}]*var\(--theme-/);
		expect(library).toContain('var(--theme-card)');
	});

	it('keeps fixed preset selectors in the shared stylesheet', () => {
		const styles = read('src/lib/styles/theme.css');
		expect(styles).toContain(".theme-root[data-theme='noir']");
		expect(styles).not.toMatch(/\[data-theme=\{\{/);
	});
});
