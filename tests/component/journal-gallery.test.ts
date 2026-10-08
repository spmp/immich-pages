// Source-text contract: asserts on raw .svelte source, not rendered DOM/behavior, except calculateJustifiedRows (real unit logic). See tests/component/gallery-asset.render.test.ts for a real render-based example.
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
		expect(asset).toContain('data-pswp-src={!hdrCandidate ? (lightboxImageSource ?? undefined) : undefined}');
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
		const lightbox = source('Lightbox');
		const capabilities = readFileSync('src/lib/media/capabilities.ts', 'utf8');
		expect(asset).toContain('supportsHdrDisplay');
		expect(asset).toContain('supportsWideColorGamut');
		expect(asset).toContain('probeImageDecode(source)');
		expect(asset).toContain('data-media-hdr-status');
		expect(asset).toContain('data-lightbox-fallback="native-anchor"');
		expect(asset).toContain('supportsHdrDisplay()');
		expect(asset).toContain('resolvedHdrSource');
		expect(asset).toContain('data-hdr-prewarm={hdrDisplay && hdrGamut ? (resolvedHdrSource ?? undefined) : undefined}');
		expect(asset).toContain('const hdrCandidate = $derived(Boolean(!avifCandidate && resolvedHdrSource && hdrDisplay && hdrGamut && !promotedFailed))');
		expect(asset).toContain('const posterSource = $derived((hdrCandidate || avifCandidate) && !promotedFailed ? (resolvedFullsizeSource ?? resolvedThumbnailSource) : resolvedThumbnailSource)');
		expect(asset).toContain('data-video-poster={hdrCandidate ? posterSource : undefined}');
		expect(lightbox).toContain('void video.play().then(promote).catch(() => giveUp(');
		expect(capabilities).toContain('setTimeout(() => finish(false)');
		expect(capabilities).toContain("src.startsWith('//')");
	});

	it('exposes bounded source-resolution facts for optional HDR work', () => {
		const asset = source('GalleryAsset');
		const gallery = source('JournalGallery');
		expect(asset).toContain('selectTargetResolution');
		expect(asset).toContain('data-hdr-target-width');
		expect(asset).toContain('data-hdr-target-height');
		expect(asset).toContain('data-hdr-bounded');
		expect(gallery).toContain('maxRequests = 8');
		expect(gallery).toContain('maxConcurrent = 2');
		expect(gallery).toContain("document.visibilityState === 'visible'");
	});

	it('prewarms HDR videos in gallery order by default, reprioritized to continue from whichever photo the viewer opens', () => {
		const gallery = source('JournalGallery');
		const lightbox = source('Lightbox');
		// querySelectorAll already returns elements in document order -- no sort needed for the
		// "first photo, then sequentially" default.
		expect(gallery).not.toContain('getBoundingClientRect');
		expect(gallery).toContain("document.addEventListener('pages:active-asset', onActiveAsset)");
		expect(gallery).toContain('const startIndex = preferredStartFigureId ? candidates.findIndex((item) => item.figureId === preferredStartFigureId) : -1;');
		expect(gallery).toContain('const ordered = startIndex > 0 ? [...candidates.slice(startIndex), ...candidates.slice(0, startIndex)] : candidates;');
		// A stalled fetch (real risk on the flaky mobile connections this exists for) used to be
		// able to permanently occupy one of only `maxConcurrent` slots forever, silently halting
		// all further prewarming with no visible symptom.
		expect(gallery).toContain('const giveUpTimer = window.setTimeout(() => controller.abort(), prewarmFetchTimeoutMs);');
		expect(gallery).toContain('window.clearTimeout(giveUpTimer);');
		expect(lightbox).toContain("document.dispatchEvent(new CustomEvent('pages:active-asset', { detail: { figureId } }))");
		expect(lightbox).toContain('notifyActiveAsset();');
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
		expect(lightbox).toContain('video.autoplay = true');
		expect(lightbox).toContain('video.muted = true');
		expect(lightbox).toContain('video.loop = true');
		expect(lightbox).toContain("instance.on('loadError'");
		expect(lightbox).toContain('delete anchor.dataset.pswpSrc');
	});

	it('never blanks the slide while an HDR candidate is loading: a known-good placeholder image is assigned before the video, and only a confirmed successful play promotes it', () => {
		const lightbox = source('Lightbox');
		const contentLoad = lightbox.slice(lightbox.indexOf("instance.on('contentLoad'"), lightbox.indexOf("instance.on('loadError'"));
		expect(contentLoad.indexOf('content.element = placeholder')).toBeGreaterThanOrEqual(0);
		expect(contentLoad.indexOf('content.element = placeholder')).toBeLessThan(contentLoad.indexOf("video.addEventListener('loadeddata'"));
		expect(contentLoad).toContain('placeholder.remove()');
		expect(contentLoad).toContain('content.element = video');
		expect(contentLoad).toContain("video.addEventListener('error', () => giveUp('video-load'))");
		expect(contentLoad).toContain("window.setTimeout(() => giveUp('video-load'), hdrClientTimeoutMs)");
	});

	it('wires the AVIF HDR candidate into PhotoSwipe via a custom content type, bypassing native image decode()', () => {
		const asset = source('GalleryAsset');
		const lightbox = source('Lightbox');
		expect(asset).toContain("avifCandidate ? 'hdr-image' : undefined");
		expect(asset).toContain('data-pswp-poster={avifCandidate ? posterSource : undefined}');
		expect(lightbox).toContain("if (element?.dataset.pswpType === 'hdr-image') return { ...itemData, type: 'hdr-image'");
		expect(lightbox).toContain("content?.type === 'hdr-image'");
		const contentLoad = lightbox.slice(lightbox.indexOf("instance.on('contentLoad'"), lightbox.indexOf("instance.on('loadError'"));
		expect(contentLoad).toContain("if (content.type === 'hdr-image')");
		// The whole point of this path is to never call decode() -- that's the API observed to
		// stall on a slow/cold AVIF gain-map conversion and leave the slide blank. Only the plain
		// load/error events (and the synchronous .complete check) may gate the promotion.
		const hdrImageBlock = contentLoad.slice(contentLoad.indexOf("if (content.type === 'hdr-image')"), contentLoad.indexOf("if (content.type !== 'video') return;"));
		expect(hdrImageBlock).not.toContain('real.decode(');
		expect(hdrImageBlock.indexOf('content.element = placeholder')).toBeGreaterThanOrEqual(0);
		expect(hdrImageBlock.indexOf('content.element = placeholder')).toBeLessThan(hdrImageBlock.indexOf("real.addEventListener('load'"));
		// PhotoSwipe sizes a content's element via explicit inline width/height keyed to whichever
		// element is currently content.element; swapping the reference without copying that over
		// leaves the promoted image unsized ("loads at full/native zoom instead of fit-to-screen").
		expect(hdrImageBlock.indexOf("real.style.width = placeholder.style.width")).toBeGreaterThanOrEqual(0);
		expect(hdrImageBlock.indexOf("real.style.width = placeholder.style.width")).toBeLessThan(hdrImageBlock.indexOf('placeholder.remove()'));
		expect(hdrImageBlock).toContain('placeholder.remove()');
		expect(hdrImageBlock).toContain('content.element = real');
		expect(hdrImageBlock).toContain("real.addEventListener('error', giveUp)");
		expect(hdrImageBlock).toContain('window.setTimeout(giveUp, hdrClientTimeoutMs)');
		expect(hdrImageBlock).toContain('if (real.complete) promote()');
	});

	it('tints the zoom button three ways -- white, khaki/pending, blue/loaded -- gated behind PUBLIC_HDR_DEBUG, off by default', () => {
		const lightbox = source('Lightbox');
		expect(lightbox).toContain("const hdrDebugEnabled = env.PUBLIC_HDR_DEBUG === 'true';");
		expect(lightbox).toContain("content?.type === 'hdr-image' || (content?.type === 'video' && content?.data?.element?.dataset.videoControls === 'false')");
		expect(lightbox).toContain("if (!hdrDebugEnabled) { root?.removeAttribute('data-pswp-hdr-state'); return; }");
		expect(lightbox).toContain("root?.setAttribute('data-pswp-hdr-state', content.__hdrPromoted ? 'loaded' : 'pending')");
		expect(lightbox).toContain("instance.on('change', () => { announce(); updateHdrIndicator(); notifyActiveAsset(); })");
		// The zoom icon's fill comes from the --pswp-icon-color custom property, not plain `color`
		// -- and only that one, not --pswp-icon-color-secondary (the "+" bars' color), or the "+"
		// becomes invisible against an identically-tinted glass shape.
		expect(lightbox).toContain(':global(.pswp[data-pswp-hdr-state="pending"] .pswp__button--zoom) { --pswp-icon-color: khaki; }');
		expect(lightbox).toContain(':global(.pswp[data-pswp-hdr-state="loaded"] .pswp__button--zoom) { --pswp-icon-color: lightblue; }');
		expect(lightbox).not.toContain('--pswp-icon-color-secondary: lightblue');
	});

	it('marks content.__hdrPromoted, and clears content.element on recycling so a revisit retries instead of being silently blocked forever', () => {
		// The real cause of "video/image available but inconsistently not displayed": PhotoSwipe
		// destroys (content.remove()'d, content.isAttached = false) a slide's content when it's
		// swiped far enough away to fall out of the 3-slide holder window, but nothing cancels an
		// in-flight HDR conversion already underway for it, AND PhotoSwipe's ContentLoader caches
		// Content objects by index and hands the same one back on revisit. Content.load() refuses
		// to dispatch 'contentLoad' again as long as content.element is still set, so a revisit of
		// an abandoned slide would silently keep showing the stale placeholder forever -- no
		// spinner, no retry -- unless content.element is explicitly cleared on abandonment.
		const lightbox = source('Lightbox');
		const contentLoad = lightbox.slice(lightbox.indexOf("instance.on('contentLoad'"), lightbox.indexOf("instance.on('loadError'"));
		const avifBlock = contentLoad.slice(contentLoad.indexOf('const finish = ()'), contentLoad.indexOf("if (content.type !== 'video') return;"));
		expect(avifBlock).toContain('const abandonStaleAttempt = () => {');
		expect(avifBlock).toContain('content.element = undefined;');
		expect(avifBlock).toContain("if (!content.isAttached) { abandonStaleAttempt(); return; }");
		expect(avifBlock).toContain('content.__hdrPromoted = true;');
		const videoBlock = contentLoad.slice(contentLoad.indexOf('const abandonStaleAttempt = ()', contentLoad.indexOf("if (content.type !== 'video') return;")));
		expect(videoBlock).toContain('const abandonStaleAttempt = () => {');
		expect(videoBlock).toContain('content.element = undefined;');
		expect(videoBlock).toContain("if (!content.isAttached) { abandonStaleAttempt(); return; }");
		expect(videoBlock).toContain('content.__hdrPromoted = true;');
	});

	it('drives the native PhotoSwipe preloader spinner for the HDR video candidate, not just the AVIF one', () => {
		// content.state = 'loading'/'loaded' is what Content.isLoading() actually checks
		// (independent of content type) -- missing for the video path the whole time, unlike AVIF
		// which has always set it. Not noticeable when conversions were fast; impossible to miss
		// once they started taking 10-30s+ with no spinner for that whole wait.
		const lightbox = source('Lightbox');
		const contentLoad = lightbox.slice(lightbox.indexOf("instance.on('contentLoad'"), lightbox.indexOf("instance.on('loadError'"));
		const videoBlock = contentLoad.slice(contentLoad.indexOf("if (content.type !== 'video') return;"));
		expect(videoBlock).toContain("content.state = 'loading';");
		expect(videoBlock).toContain("content.state = 'loaded';");
	});

	it('makes the HDR give-up timeout configurable via PUBLIC_HDR_CLIENT_TIMEOUT_MS instead of another guessed hardcoded number', () => {
		// Real conversions can legitimately take 20-40s+ server-side, and both HDR routes share one
		// small concurrency pool with the gallery's own background prewarm fetches, so a request a
		// few photos into a browsing session can queue behind several others. Rather than guess at
		// yet another fixed number, this is tunable directly against what a real session needs.
		const lightbox = source('Lightbox');
		expect(lightbox).toContain('const parsedHdrClientTimeoutMs = Number(env.PUBLIC_HDR_CLIENT_TIMEOUT_MS);');
		expect(lightbox).toContain('const hdrClientTimeoutMs = Number.isFinite(parsedHdrClientTimeoutMs) && parsedHdrClientTimeoutMs > 0 ? Math.min(parsedHdrClientTimeoutMs, 600_000) : 60_000;');
	});

	it('shows a plain-language, no-devtools status for whichever HDR media is actually on screen', () => {
		const lightbox = source('Lightbox');
		expect(lightbox).toContain("let hdrStatus = $state('')");
		expect(lightbox).toContain('{#if hdrStatus}<p class="hdr-status" data-pswp-hdr-status>{hdrStatus}</p>{/if}');
		// Guarded by content identity so a late result for a background/preloaded neighboring
		// slide can't overwrite the text for whatever is actually being displayed right now.
		expect(lightbox).toContain('if (content === lightbox?.pswp?.currSlide?.content) hdrStatus = text;');
		expect(lightbox).toContain("setHdrStatus(content, 'HDR video: loading…')");
		expect(lightbox).toContain("setHdrStatus(content, 'HDR video: playing')");
		// The native MediaError code (1=ABORTED, 2=NETWORK, 3=DECODE, 4=SRC_NOT_SUPPORTED) is the
		// single most direct signal available without devtools access, so it's shown on screen.
		expect(lightbox).toContain('const mediaErrorLabel: Record<number, string> = { 1: \'aborted\', 2: \'network\', 3: \'decode\', 4: \'format unsupported\' };');
		expect(lightbox).toContain('const code = video.error?.code;');
		// canPlayType costs nothing (no network) and narrows "format unsupported" down to HEVC
		// itself vs. the 10-bit profile vs. the HDR (hev1 tag) signaling -- folded into the final
		// message rather than shown standalone, since standalone it would just flash and be
		// overwritten the instant load/error fires.
		expect(lightbox).toContain("const canPlayDiagnostic = `8bit:\"${video.canPlayType('video/mp4; codecs=\"hvc1.1.6.L153.B0\"')}\" 10bit:\"${video.canPlayType('video/mp4; codecs=\"hvc1.2.4.L153.B0\"')}\" hev1:\"${video.canPlayType('video/mp4; codecs=\"hev1.2.4.L153.B0\"')}\"`");
		expect(lightbox).toContain("`HDR video: failed to ${errorContext === 'video-playback' ? 'play' : 'load'} (${reason}), showing SDR photo [canPlayType ${canPlayDiagnostic}]`");
		expect(lightbox).toContain("setHdrStatus(content, 'AVIF HDR image: loading…')");
		expect(lightbox).toContain("setHdrStatus(content, 'AVIF HDR image: loaded')");
		expect(lightbox).toContain("setHdrStatus(content, 'AVIF HDR image: failed, showing SDR photo')");
		// PhotoSwipe's own root (.pswp) uses --pswp-root-z-index: 100000 and is appended to the DOM
		// after this badge -- an equal z-index would tie, and document order would put the
		// lightbox's opaque backdrop on top, hiding the badge completely despite it being "there."
		expect(lightbox).toContain('z-index: 100001;');
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
