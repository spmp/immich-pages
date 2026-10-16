// Source-text contract: asserts on raw .svelte source, not rendered DOM/behavior. See tests/component/gallery-asset.render.test.ts for a real render-based example.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (name: string) => readFileSync(`src/lib/components/navigation/${name}.svelte`, 'utf8');

describe('share navigation components', () => {
	it('renders projected entries with safe same-origin links and desktop collapse', () => {
		const page = source('PageNavigation');
		expect(page).toContain('class="collapse"');
		expect(page).toContain("'Collapse journeys'");
		expect(page).toContain("'Expand journeys'");
		expect(page).toContain('NavigationEntry');
		expect(page).toContain('aria-expanded={navigationState.expanded}');
		expect(page).toContain('aria-current');
		expect(page).toContain('loading="lazy"');
		 expect(page).toContain('safeHref');
		expect(page).toContain('var(--theme-nav-bg)');
		expect(page).toContain('var(--theme-control-bg)');
		expect(page).toContain('safeThumbnail');
		expect(page).toContain('resolve(');
		expect(page).toContain('date.start');
		expect(page).toContain("href.startsWith('/')");
	});

	it('keeps the desktop navigation out of the mobile breakpoint', () => {
		const page = source('PageNavigation');
		expect(page).toContain('@media (max-width: 959px)');
		expect(page).toContain('@media (prefers-reduced-motion: reduce)');
	});

	it('uses the exact production theme selector and no exploratory surface', () => {
		const page = source('PageNavigation');
		expect(page).toContain('<label for="desktop-theme-choice">Theme</label>');
		expect(page).toContain('<option value="default">Default</option>');
		expect(page).toContain('<option value="light">Light</option>');
		expect(page).toContain('<option value="dark">Dark</option>');
		expect(page).not.toContain('THEME_KEYS');
		expect(page).not.toContain('ThemeExplorer');
		expect(page).toContain('theme.select(event.currentTarget.value)');
	});

	it('keeps the same theme state connected from the journal root', () => {
		const journal = readFileSync('src/lib/components/journal/JournalPage.svelte', 'utf8');
		const root = readFileSync('src/lib/components/journal/ThemeRoot.svelte', 'utf8');
		expect(journal).toContain('const theme = createThemeState()');
		expect(journal).toContain('<ThemeRoot {theme}');
		expect(journal).toContain('<PageNavigation entries={navigation.entries} activeHref={navigation.activeHref} {theme} />');
		expect(journal).toContain('<MobileDrawer entries={navigation?.entries} activeHref={navigation?.activeHref} {theme} />');
		expect(root).toContain('theme?: ThemeState');
		expect(root).toContain('theme?.effectiveKey');
	});
});
