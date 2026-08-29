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
		expect(component('JournalHero')).toContain('Explore the gallery');
		expect(source).toContain('aria-labelledby="gallery-title"');
	});

	it('keeps the map seam empty and the narrative server-rendered', () => {
		const seam = component('JourneyMapSlot');
		expect(seam).not.toMatch(/maplibre|<canvas|<iframe|tile layer/i);
		expect(seam).toContain('data-phase="3-map-seam"');
		expect(seam).toContain('height: 0');
		expect(seam).toContain('overflow: hidden');
		expect(seam).not.toMatch(/Journey map extension point/);
		expect(component('JournalNarrative')).toContain('{@html html}');
		expect(route()).toContain('<JournalPage');
		expect(route()).not.toContain('fetch(');
	});

	it('keeps only the no-hero fallback label and the locked gallery CTA', () => {
		const hero = component('JournalHero');
		expect(hero).not.toContain('<p class="eyebrow">Journey gallery</p>');
		expect(hero).toContain('{#if !hero}');
		expect(hero).toContain('Journey gallery');
		expect(hero).toContain('Explore the gallery');
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
});
