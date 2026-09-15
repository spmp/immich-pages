import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { calculateJustifiedRows } from '../../src/lib/components/journal/justified-layout';

const source = (name: string) => readFileSync(`src/lib/components/journal/${name}.svelte`, 'utf8');

describe('journal gallery contract', () => {
	 it('has ordered, lazy, mixed-media presentation components', () => {
		const gallery = source('JournalGallery');
		const asset = source('GalleryAsset');
		expect(gallery).toContain('aria-label="Gallery"');
		expect(gallery).not.toContain('>Gallery<');
		expect(gallery).not.toContain('class="rule"');
		expect(asset).toContain('loading="lazy"');
		expect(asset).toContain("'asset-' + asset.id");
		expect(asset).not.toContain('Play video');
		expect(asset).toContain('Media unavailable');
		 expect(asset).toContain('width={lightboxWidth}');
		expect(asset).toContain('height={lightboxHeight}');
		expect(asset).toContain('data-pswp-src={resolution === \'fullsize\' ? resolvedFullsizeSource : undefined}');
		expect(asset).not.toMatch(/original|download/);
	});

	it('calculates mixed intrinsic-ratio rows and full-width breaks deterministically', () => {
		const rows = calculateJustifiedRows([
			{ id: 'portrait', width: 800, height: 1200 },
			{ id: 'landscape', width: 1600, height: 900 },
			{ id: 'wide', width: 2400, height: 1200, fullWidth: true },
			{ id: 'last', width: 1200, height: 1200 }
		], 1000, { gap: 16, targetRowHeight: 240, maxItemsPerRow: 5 });
		expect(rows).toHaveLength(3);
		expect(rows[0].items.map((item) => item.id)).toEqual(['portrait', 'landscape']);
		expect(rows[0].items[0].layoutWidth / rows[0].items[0].layoutHeight).toBeCloseTo(2 / 3);
		expect(rows[1].fullWidth).toBe(true);
		expect(rows[1].items[0].layoutWidth).toBe(1000);
		expect(rows[2].items[0].layoutWidth).toBe(rows[2].items[0].layoutHeight);
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
		expect(lightbox).toContain('bgOpacity: 1');
		expect(lightbox).toContain('--pswp-bg-opacity: 1');
	});

	it('marks the thumbnail anchor as the non-JavaScript lightbox fallback', () => {
		const asset = source('GalleryAsset');
		expect(asset).toContain('data-lightbox-fallback="native-anchor"');
		expect(asset).toContain('data-media-source="thumbnail"');
		expect(asset).not.toMatch(/\/original|\/download/);
	});

	it('defines the complete lightbox lifecycle and safe fallback contract', () => {
		const lightbox = source('Lightbox');
		const asset = source('GalleryAsset');
		expect(lightbox).toContain("import 'photoswipe/style.css'");
		expect(lightbox).toContain('data-pswp-modal');
		expect(lightbox).toContain('popstate');
		expect(lightbox).toContain('keydown');
		expect(lightbox).toContain('aria-live="polite"');
		expect(lightbox).toContain('focus trap');
		expect(lightbox).toContain('history.pushState');
		expect(lightbox).toContain('history.back');
		expect(lightbox).toContain('removeEventListener');
		expect(asset).toContain('Math.min');
		expect(asset).toContain('8192');
		expect(asset).toContain('0.25');
		expect(asset).toContain('data-pswp-width={lightboxWidth}');
		expect(asset).toContain('data-pswp-height={lightboxHeight}');
	});

	it('reports only redacted media failure diagnostics when explicitly enabled', () => {
		const asset = source('GalleryAsset');
		const debug = readFileSync('src/lib/components/journal/journal-debug.ts', 'utf8');
		expect(asset).toContain("reportJournalDebug('media-failure'");
  expect(debug).toContain("env.PUBLIC_PAGES_DEBUG === 'true'");
		expect(debug).toContain("console.info('[immich-pages-debug]'");
		expect(debug).toContain("'page-model-load'");
		expect(debug).toContain("'lightbox'");
		expect(debug).toContain("'media-failure'");
		expect(debug).toContain("'image' | 'video' | 'hero' | 'gallery'");
		expect(debug).toContain("'unavailable' | 'empty' | 'fallback'");
		expect(debug).not.toMatch(/asset\.id|videoHref|description|cookie|authorization|URL|origin|requestId|\bresponse\s*[:=]/i);
	});

	it('reports safe lifecycle fields only', () => {
		const debug = readFileSync('src/lib/components/journal/journal-debug.ts', 'utf8');
		expect(debug).toContain('assetCount');
		expect(debug).toContain('heroPresent');
		expect(debug).toContain('template');
		expect(debug).not.toMatch(/videoHref|description|cookie|authorization|requestId|\bresponse\s*[:=]/i);
	});

	it('defines CSS-owned media frames separate from intrinsic lightbox dimensions', () => {
		const asset = source('GalleryAsset');
		expect(asset).toContain('gallery-media-frame');
		 expect(asset).toContain('height: auto');
		 expect(asset).toContain('overflow: hidden');
		 expect(asset).toContain('object-fit: contain');
	});

	it('exposes orientation-aware frame geometry without coupling it to viewer dimensions', () => {
		const asset = source('GalleryAsset');
		expect(asset).toContain('portrait');
		expect(asset).toContain('landscape');
		 expect(asset).toContain('class:full-width={asset.fullWidth}');
		 expect(asset).toContain('aspect-ratio: auto');
		expect(asset).toContain('data-pswp-width={lightboxWidth}');
		expect(asset).toContain('data-pswp-height={lightboxHeight}');
	});

	 it('uses loaded image dimensions when metadata is hidden', () => {
		const asset = source('GalleryAsset');
		expect(asset).toContain('let naturalWidth = $state(0)');
		expect(asset).toContain('let naturalHeight = $state(0)');
		expect(asset).toContain('bind:naturalWidth');
		expect(asset).toContain('bind:naturalHeight');
		expect(asset).toContain('getPreferredDimension(asset.width, naturalWidth)');
		expect(asset).toContain('getPreferredDimension(asset.height, naturalHeight)');
		expect(asset).toContain('getPresentationOrientation(width, height)');
	 });

	it('only renders explicit captions and supports promoted assets', () => {
		const asset = source('GalleryAsset');
		const gallery = source('JournalGallery');
		expect(asset).toContain('{#if asset.caption}<figcaption>{asset.caption}</figcaption>{/if}');
		expect(asset).not.toContain('asset.fileName');
		expect(gallery).toContain('fullWidth');
		expect(gallery).toContain('full-width-row');
	});

	it('keeps promotion behind measured-slot policy and preserves the thumbnail anchor', () => {
		const asset = source('GalleryAsset');
		const gallery = source('JournalGallery');
		expect(asset).toContain('data-resolution-policy={layoutMeasured ? \'measured-slot\' : \'thumbnail-baseline\'}');
		expect(asset).toContain('chooseResolution(policyCssWidth, policyIntrinsicWidth, dpr)');
		expect(asset).toContain('promotedFailed = true');
		expect(gallery).toContain('{layoutMeasured}');
		expect(asset).toContain('href={resolve(asset.thumbnail as any)}');
	});

	it('treats HDR as an optional same-origin enhancement with visible SDR fallback', () => {
		const asset = source('GalleryAsset');
		const capabilities = readFileSync('src/lib/media/capabilities.ts', 'utf8');
		expect(asset).toContain('supportsHdrDisplay');
		expect(asset).toContain('supportsWideColorGamut');
		expect(asset).toContain('probeImageDecode(source)');
		expect(asset).toContain('data-media-hdr-status');
		expect(asset).toContain('data-lightbox-fallback="native-anchor"');
		expect(capabilities).toContain('setTimeout(() => finish(false)');
		expect(capabilities).toContain("src.startsWith('//')");
	});

	it('wires authorized video tiles into the PhotoSwipe custom content hook', () => {
		const asset = source('GalleryAsset');
		const lightbox = source('Lightbox');
		expect(asset).toContain('data-pswp-type="video"');
		expect(asset).toContain('playsinline');
		expect(lightbox).toContain("instance.addFilter('itemData'");
		expect(lightbox).toContain("instance.on('contentLoad'");
		expect(lightbox).toContain('video.controls = true');
		expect(lightbox).toContain('video.playsInline = true');
	});

	it('keeps marker handoff targets focusable and lightbox-compatible', () => {
		const asset = source('GalleryAsset');
		const page = source('JournalPage');
		expect(asset).toContain('tabindex="-1"');
		expect(asset).toContain('map-focus-highlight');
		expect(page).toContain('markerActivation');
		expect(page).toContain('mapStyle?.url');
	});
});
