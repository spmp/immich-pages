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

	it('keeps interactive surface focus and fallback styling on shared tokens', () => {
		const hero = read('src/lib/components/journal/JournalHero.svelte');
		const narrative = read('src/lib/components/journal/JournalNarrative.svelte');
		expect(hero).toContain('background: var(--theme-gradient)');
		expect(narrative).toContain(':global(a):focus-visible');
		expect(narrative).toContain('var(--theme-focus)');
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
		expect(styles).toContain(".theme-root[data-theme='dark']");
		expect(styles).not.toMatch(/\[data-theme=\{\{/);
	});

	it('passes only normalized gradient and authorized hero representation into ThemeRoot', () => {
		const page = read('src/lib/components/journal/JournalPage.svelte');
		const root = read('src/lib/components/journal/ThemeRoot.svelte');
		expect(page).toContain('gradient={page.presentation.gradient}');
		expect(page).toContain('heroSource={page.hero?.thumbnail}');
		expect(root).toContain('sampleHeroGradient(heroSource)');
		expect(root).toContain("onMount(() =>");
		expect(root).not.toMatch(/authorization|cookie|original|download/i);
	});

	it('keeps gradient precedence explicit, automatic, then theme fallback', () => {
		const root = read('src/lib/components/journal/ThemeRoot.svelte');
		expect(root).toContain('explicitGradient ?? automaticGradient');
		expect(root).toContain("data-gradient-mode={explicitGradient ? 'explicit' : automaticGradient ? 'automatic' : 'theme'}");
		const styles = read('src/lib/styles/theme.css');
		expect(styles).toContain('linear-gradient(var(--theme-gradient-direction), var(--theme-gradient-top) 0%, var(--theme-gradient-bottom) 100%)');
	});
});
