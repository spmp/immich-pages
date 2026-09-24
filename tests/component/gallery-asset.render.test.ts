// Real DOM render test (not a source-text contract): renders GalleryAsset with @testing-library/svelte
// and drives it through actual browser events, so it proves the fullsize->thumbnail fallback behavior
// central to the "SDR clients can't get full-size images" bug, not just that certain strings exist in source.
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NormalizedAsset } from '../../src/lib/server/presentation/model';

// SvelteKit's $env/dynamic/public virtual module is only populated inside the real dev/build
// pipeline; stub it so importing journal-debug.ts (a GalleryAsset dependency) doesn't crash here.
vi.mock('$env/dynamic/public', () => ({ env: {} }));
const { default: GalleryAsset } = await import('../../src/lib/components/journal/GalleryAsset.svelte');

afterEach(cleanup);

function makeAsset(overrides: Partial<NormalizedAsset> = {}): NormalizedAsset {
	return {
		id: 'a1111111-1111-4111-8111-111111111111',
		type: 'IMAGE',
		thumbnail: '/share/key/ref/media/a1111111-1111-4111-8111-111111111111/thumbnail',
		fullsize: '/share/key/ref/media/a1111111-1111-4111-8111-111111111111/image/fullsize',
		caption: null,
		width: null,
		height: null,
		...overrides
	} as NormalizedAsset;
}

describe('GalleryAsset rendered behavior', () => {
	it('starts on the thumbnail source before layout measurement completes', () => {
		const { container } = render(GalleryAsset, { asset: makeAsset(), layoutWidth: 400, layoutHeight: 300, layoutMeasured: false });
		const img = container.querySelector('img');
		expect(img).not.toBeNull();
		expect(img?.getAttribute('src')).toBe('/share/key/ref/media/a1111111-1111-4111-8111-111111111111/thumbnail');
		expect(img?.dataset.mediaSource).toBe('thumbnail');
		expect(container.querySelector('figure')?.dataset.resolutionPolicy).toBe('thumbnail-baseline');
	});

	it('falls back to the thumbnail and marks the figure failed when the only source errors', async () => {
		const { container } = render(GalleryAsset, { asset: makeAsset({ fullsize: undefined }), layoutWidth: 400, layoutHeight: 300, layoutMeasured: true });
		const img = container.querySelector('img') as HTMLImageElement;
		expect(img.getAttribute('src')).toBe('/share/key/ref/media/a1111111-1111-4111-8111-111111111111/thumbnail');
		await fireEvent.error(img);
		expect(container.querySelector('.unavailable')).not.toBeNull();
		expect(container.querySelector('.unavailable')?.textContent).toContain('Media unavailable');
	});

	it('promotes to the fullsize source once measured, then falls back to the thumbnail if that source fails to decode', async () => {
		const { container } = render(GalleryAsset, { asset: makeAsset(), layoutWidth: 100, layoutHeight: 100, layoutMeasured: true });
		const thumbnailImg = container.querySelector('img') as HTMLImageElement;
		expect(thumbnailImg.dataset.mediaSource).toBe('thumbnail');

		// A small decoded thumbnail (below the required CSS*DPR width) triggers promotion to the fullsize source.
		Object.defineProperty(thumbnailImg, 'naturalWidth', { value: 40, configurable: true });
		await fireEvent.load(thumbnailImg);

		const promotedImg = container.querySelector('img') as HTMLImageElement;
		expect(promotedImg.dataset.mediaSource).toBe('fullsize');
		expect(promotedImg.getAttribute('src')).toBe('/share/key/ref/media/a1111111-1111-4111-8111-111111111111/image/fullsize');

		// This is the real-world failure mode for a non-Safari browser handed raw HEIC bytes: the <img> can't decode it.
		await fireEvent.error(promotedImg);

		const fallbackImg = container.querySelector('img') as HTMLImageElement;
		expect(fallbackImg.dataset.mediaSource).toBe('thumbnail');
		expect(fallbackImg.getAttribute('src')).toBe('/share/key/ref/media/a1111111-1111-4111-8111-111111111111/thumbnail');
	});
});
