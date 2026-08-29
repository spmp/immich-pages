import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (name: string) => readFileSync(`src/lib/components/journal/${name}.svelte`, 'utf8');

describe('journal gallery contract', () => {
	 it('has ordered, lazy, mixed-media presentation components', () => {
		const gallery = source('JournalGallery');
		const asset = source('GalleryAsset');
		expect(gallery).toContain('aria-labelledby="gallery-title"');
		expect(asset).toContain('loading="lazy"');
		expect(asset).toContain("'asset-' + asset.id");
		expect(asset).toContain('Play video');
		expect(asset).toContain('Media unavailable');
		expect(asset).toContain('width={asset.width}');
		expect(asset).toContain('height={asset.height}');
	});

	 it('keeps PhotoSwipe browser-only and preserves ordinary anchors', () => {
		const lightbox = source('Lightbox');
		expect(lightbox).toContain('onMount');
		expect(lightbox).toContain("import('photoswipe/lightbox')");
		expect(lightbox).toContain("import('photoswipe')");
		expect(lightbox).toContain('Close full-screen viewer');
		expect(lightbox).not.toMatch(/original|download|127\.0\.0\.1/);
		expect(lightbox).toContain('focus');
		expect(lightbox).toContain('overflow');
		expect(lightbox).toContain('prefers-reduced-motion');
	});

	it('reports only redacted media failure diagnostics when explicitly enabled', () => {
		const asset = source('GalleryAsset');
		const debug = readFileSync('src/lib/components/journal/journal-debug.ts', 'utf8');
		expect(asset).toContain("reportJournalDebug('media-failure'");
		expect(debug).toContain("env.PUBLIC_PAGES_DEBUG !== 'false'");
		expect(debug).toContain("console.info('[immich-pages-debug]'");
		expect(debug).toContain("'page-model-load'");
		expect(debug).toContain("'lightbox'");
		expect(debug).toContain("'media-failure'");
		expect(debug).toContain("'image' | 'video' | 'hero' | 'gallery'");
		expect(debug).toContain("'unavailable' | 'empty' | 'fallback'");
		expect(debug).not.toMatch(/asset\.id|thumbnail|videoHref|description|cookie|authorization|URL|origin|requestId|response/i);
	});

	it('reports safe lifecycle fields only', () => {
		const debug = readFileSync('src/lib/components/journal/journal-debug.ts', 'utf8');
		expect(debug).toContain('assetCount');
		expect(debug).toContain('heroPresent');
		expect(debug).toContain('template');
		expect(debug).not.toMatch(/thumbnail|videoHref|description|cookie|authorization|requestId|response/i);
	});
});
