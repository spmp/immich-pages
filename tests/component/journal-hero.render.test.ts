// Real DOM render test: the hero must appear at once from the small thumbnail and then show the
// full-size image -- only once that has actually loaded, and never at the cost of the thumbnail
// if it fails.
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/public', () => ({ env: {} }));
const { default: JournalHero } = await import('../../src/lib/components/journal/JournalHero.svelte');

afterEach(cleanup);

const hero = { id: 'a1111111-1111-4111-8111-111111111111', thumbnail: '/share/key/ref/media/a1/thumbnail', fullsize: '/share/key/ref/media/a1/image/fullsize' };

describe('JournalHero rendered behavior', () => {
	it('shows the thumbnail immediately and loads the full-size image above it, hidden until ready', () => {
		const { container } = render(JournalHero, { title: 'Trip', hero });
		const thumbnail = container.querySelector('img.hero-image');
		const full = container.querySelector('img.hero-image-full');
		expect(thumbnail?.getAttribute('src')).toBe(hero.thumbnail);
		expect(full?.getAttribute('src')).toBe(hero.fullsize);
		expect(full?.classList.contains('loaded')).toBe(false);
	});

	it('reveals the full-size image once it has loaded', async () => {
		const { container } = render(JournalHero, { title: 'Trip', hero });
		const full = container.querySelector('img.hero-image-full') as HTMLImageElement;
		await fireEvent.load(full);
		expect(full.classList.contains('loaded')).toBe(true);
		expect(container.querySelector('img.hero-image')?.getAttribute('src')).toBe(hero.thumbnail);
	});

	it('stays on the thumbnail when the full-size image fails', async () => {
		const { container } = render(JournalHero, { title: 'Trip', hero });
		await fireEvent.error(container.querySelector('img.hero-image-full') as HTMLImageElement);
		expect(container.querySelector('img.hero-image-full')).toBeNull();
		expect(container.querySelector('img.hero-image')?.getAttribute('src')).toBe(hero.thumbnail);
	});

	it('uses the thumbnail alone when there is no full-size image (a video hero)', () => {
		const { container } = render(JournalHero, { title: 'Trip', hero: { id: hero.id, thumbnail: hero.thumbnail } });
		expect(container.querySelector('img.hero-image-full')).toBeNull();
		expect(container.querySelector('img.hero-image')?.getAttribute('src')).toBe(hero.thumbnail);
	});
});
