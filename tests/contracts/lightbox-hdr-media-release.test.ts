import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const lightbox = readFileSync('src/lib/components/journal/Lightbox.svelte', 'utf8');

/**
 * lightbox-mobile-crash (.planning/debug/lightbox-mobile-crash.md): the phone killed the tab once
 * the lightbox was holding 15-19 loaded HDR videos, because nothing ever let one go. The bounding
 * logic itself is executed in tests/unit/hdr-media-cache.test.ts; this pins the wiring that makes
 * it reachable from PhotoSwipe's slide lifecycle, in this repo's source-contract style for the
 * lightbox (see journal-gallery.test.ts).
 */
describe('lightbox HDR media release', () => {
	it('bounds the promoted-media cache and gives it a way to free a decoder', () => {
		expect(lightbox).toMatch(/new HdrMediaCache\(\{[^}]*maxIdle[^}]*release/);
		expect(lightbox).toContain("removeAttribute('src')");
	});

	it('lets go of a slide\'s HDR media when PhotoSwipe destroys that slide', () => {
		expect(lightbox).toMatch(/instance\.on\('contentDestroy'/);
		expect(lightbox).toContain('promotedHdrMedia.idle(');
		// An upgrade still in flight for a slide that no longer exists must stop loading, not run
		// on to its full timeout holding a decoder.
		expect(lightbox).toContain("giveUp('slide-destroyed')");
	});

	it('releases everything once the viewer has finished closing', () => {
		// PhotoSwipe clears its listeners before destroying its remaining slides, so no
		// contentDestroy is delivered for them; the viewer's own destroy event is the last chance.
		expect(lightbox).toMatch(/instance\.on\('destroy',[\s\S]{0,400}promotedHdrMedia\.clear\(\)/);
	});
});
