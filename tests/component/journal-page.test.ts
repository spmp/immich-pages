// Source-text contract: asserts on raw .svelte source, not rendered DOM/behavior. See tests/component/gallery-asset.render.test.ts for a real render-based example.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const component = (name: string) => readFileSync(`src/lib/components/journal/${name}.svelte`, 'utf8');
const route = () => readFileSync('src/routes/share/[kind]/[ref]/+page.svelte', 'utf8');

describe('journal presentation contract', () => {
	 it('composes the story in the promised semantic order', () => {
		const source = component('JournalPage');
		expect(source.indexOf('<JournalHero')).toBeLessThan(source.indexOf('<JourneyMapSlot'));
		expect(source.indexOf('<JourneyMapSlot')).toBeLessThan(source.indexOf('<JournalNarrative'));
		expect(source.indexOf('<JournalNarrative')).toBeLessThan(source.indexOf('<section class="gallery"'));
		expect(component('JournalHero')).not.toContain('Explore the gallery');
		expect(component('JournalGallery')).toContain('aria-label="Gallery"');
	});

	it('keeps the map seam empty and the narrative server-rendered', () => {
		const seam = component('JourneyMapSlot');
		expect(seam).toMatch(/import\('maplibre-gl'\)/);
		expect(seam).toContain('data-phase="3-map-seam"');
		expect(seam).toContain('height: 0');
		expect(seam).toContain('overflow: hidden');
		expect(seam).not.toMatch(/Journey map extension point/);
		expect(component('JournalNarrative')).toContain('{@html html}');
		expect(route()).toContain('<JournalPage');
		expect(route()).not.toContain('fetch(');
	});

	it('keeps only the no-hero fallback label without the removed gallery CTA', () => {
		const hero = component('JournalHero');
		expect(hero).not.toMatch(/<p class="eyebrow">Journey gallery<\/p>\s*<h1/);
		expect(hero).toContain('{#if !hero}');
		expect(hero).toContain('Journey gallery');
		expect(hero).not.toContain('Explore the gallery');
	});

	it('declares responsive layout and accessible gallery targets', () => {
		const source = component('JournalPage');
		expect(source).toContain('id={\'asset-\' + asset.id}');
		expect(source).toContain('loading="lazy"');
		expect(source).toContain('prefers-reduced-motion');
		expect(source).toContain('@media (min-width: 640px)');
		expect(source).toContain('@media (min-width: 960px)');
		expect(source).toContain('overflow-wrap: anywhere');
	});

	it('formats date-only values after mount without changing the SSR contract', () => {
		const source = component('JournalHero');
		expect(source).toContain("onMount(() =>");
		expect(source).toContain("Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long', day: 'numeric' })");
		expect(source).toContain('data-date-iso');
		expect(source).toContain('date-value');
		expect(source).not.toContain('toLocaleString');
	});

	it('routes invalid presentation outcomes through the branded state', () => {
		const source = route();
		expect(source).toContain("outcome.kind === 'presentation-error'");
		expect(source).toContain('<PresentationState state={outcome.state} retryHref="." />');
		expect(source).toContain('PresentationState');
		expect(source).not.toContain('This journey is unavailable right now. Please check the link and try again.');
		expect(source).not.toMatch(/metadataReason|requestId|cookie|authorization|immich\.example/i);
		const copy = readFileSync('src/lib/components/journal/presentation-copy.ts', 'utf8');
		expect(copy).toContain("invalid:");
		expect(copy).toContain('This page needs a small correction before it can be shown.');
		expect(copy).toContain('Return to the album');
	});

	it('passes the redacted navigation model into direct-share composition', () => {
		const source = component('JournalPage');
		const direct = route();
		const library = readFileSync('src/routes/library/+page.svelte', 'utf8');
		expect(source).toContain('navigation?');
		expect(source).toContain('PageNavigation');
		expect(source).toContain('MobileDrawer');
		expect(direct).toContain('navigation={data.navigation}');
		expect(direct).not.toMatch(/authorization|cookie|token|album\.id/);
		expect(library).toContain('library.kind === \'ready\'');
		expect(library).toContain('PageNavigation entries={library.entries}');
	});
});
