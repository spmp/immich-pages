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
		expect(component('JourneyMapSlot')).not.toMatch(/maplibre|<canvas|<iframe|tile layer/i);
		expect(component('JournalNarrative')).toContain('{@html html}');
		expect(route()).toContain('<JournalPage');
		expect(route()).not.toContain('fetch(');
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
});
