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
		expect(asset).toContain('data-pswp-src={!hdrCandidate ? (avifCandidate ? addInteractivePriority(lightboxImageSource ?? undefined) : (lightboxImageSource ?? undefined)) : undefined}');
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
		expect(debug).not.toMatch(/asset\.id|videoHref|description|cookie|authorization|\bURL\b|origin|requestId|\bresponse\s*[:=]/i);
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
		expect(asset).toContain('data-hdr-representation={hdrRepresentation ?? undefined}');
		expect(asset).toContain("const hdrCandidate = $derived(Boolean(!avifCandidate && resolvedHdrSource && hdrRepresentation === 'video' && !promotedFailed))");
		expect(asset).toContain('const posterSource = $derived((hdrCandidate || avifCandidate) && !promotedFailed ? (resolvedFullsizeSource ?? resolvedThumbnailSource) : resolvedThumbnailSource)');
		expect(asset).toContain('data-video-poster={hdrCandidate ? posterSource : undefined}');
		expect(lightbox).toContain("video.play().then(() => upgrade.promote()).catch(() => upgrade.giveUp('video-playback'))");
		expect(lightbox).toContain("upgrade.giveUp('image-decode')");
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
		expect(gallery).not.toContain('maxRequests = 8');
		expect(gallery).toContain("headers: { 'content-type': 'application/json', 'x-hdr-representation': representation }");
		expect(gallery).toContain('activeAssetId, activePosition');
		expect(gallery).not.toContain('data-hdr-prewarm');
		expect(gallery).toContain("document.visibilityState === 'visible'");
	});

	it('prewarms HDR videos in gallery order by default, reprioritized to continue from whichever photo the viewer opens', () => {
		const gallery = source('JournalGallery');
		const lightbox = source('Lightbox');
		expect(gallery).toContain("document.addEventListener('pages:active-asset', onActiveAsset)");
		expect(gallery).toContain('preferredHdrRepresentation()');
		expect(gallery).toContain('controller?.abort()');
		expect(gallery).not.toContain('querySelectorAll<HTMLElement>(\'[data-hdr-prewarm]\')');
		expect(lightbox).toContain("document.dispatchEvent(new CustomEvent('pages:active-asset', { detail: { figureId, activeAssetId: figure.dataset.assetId, activePosition } }))");
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
		expect(lightbox).toContain('video.autoplay = false');
		expect(lightbox).toContain("video.preload = 'none'");
		expect(lightbox).toContain('const startVideo = () => {');
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
		// The placeholder -> HDR swap itself now lives in one shared module used by both HDR paths
		// (src/lib/media/hdr-upgrade.ts) rather than being duplicated inline per path, so what this
		// contract checks here is the wiring: the real element is handed to that module, and the
		// only things that can end the wait are a confirmed play, a load error, or the timeout.
		// The swap's actual behavior is covered behaviorally in tests/unit/hdr-upgrade.test.ts.
		expect(contentLoad).toContain('real: video');
		expect(contentLoad).toContain("video.addEventListener('error', () => {");
		expect(contentLoad).toContain("upgrade.giveUp('video-load')");
		expect(contentLoad).toContain('timeoutMs: hdrClientTimeoutMs');
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
		// ...which is why the size copy has to run in the shared upgrade's `beforeSwap` hook: that
		// is the point at which content.element is still the placeholder, so the already-correct
		// box can be read off it before the handover. (Ordering is enforced behaviorally in
		// tests/unit/hdr-upgrade.test.ts -- 'runs the pre-swap hook before handing the element over'.)
		expect(hdrImageBlock.indexOf('beforeSwap: () => {')).toBeGreaterThanOrEqual(0);
		expect(hdrImageBlock.indexOf('beforeSwap: () => {')).toBeLessThan(hdrImageBlock.indexOf('real.style.width = placeholder.style.width'));
		expect(hdrImageBlock).toContain('real.style.height = placeholder.style.height');
		expect(hdrImageBlock).toContain("real.addEventListener('error', () => {");
		expect(hdrImageBlock).toContain("upgrade.giveUp('image-load')");
		expect(hdrImageBlock).toContain('timeoutMs: hdrClientTimeoutMs');
		expect(hdrImageBlock).toContain('if (real.complete) upgrade.promote()');
	});

	it('tints the zoom button three ways -- white, khaki/pending, blue/loaded -- gated behind PUBLIC_HDR_DEBUG, off by default', () => {
		const lightbox = source('Lightbox');
		expect(lightbox).toContain("const hdrDebugEnabled = env.PUBLIC_HDR_DEBUG === 'true';");
		expect(lightbox).toContain("content?.type === 'hdr-image' || (content?.type === 'video' && content?.data?.element?.dataset.videoControls === 'false')");
		expect(lightbox).toContain("if (!hdrDebugEnabled) { root?.removeAttribute('data-pswp-hdr-state'); return; }");
		expect(lightbox).toContain("root?.setAttribute('data-pswp-hdr-state', content.__hdrPromoted ? 'loaded' : 'pending')");
		expect(lightbox).toContain("instance.on('change', () => {");
		expect(lightbox).toContain('hdrVideoPromoters.get(lightbox?.pswp?.currSlide?.content)?.();');
		// The zoom icon's fill comes from the --pswp-icon-color custom property, not plain `color`
		// -- and only that one, not --pswp-icon-color-secondary (the "+" bars' color), or the "+"
		// becomes invisible against an identically-tinted glass shape.
		expect(lightbox).toContain(':global(.pswp[data-pswp-hdr-state="pending"] .pswp__button--zoom) { --pswp-icon-color: khaki; }');
		expect(lightbox).toContain(':global(.pswp[data-pswp-hdr-state="loaded"] .pswp__button--zoom) { --pswp-icon-color: lightblue; }');
		expect(lightbox).not.toContain('--pswp-icon-color-secondary: lightblue');
	});

	it('shares one HDR upgrade state machine between both HDR paths, so the two cannot drift apart again', () => {
		// The regression this guards was, at root, a divergence: the HDR video path and the AVIF
		// path each carried their own copy of this logic, and the change that made the spinner
		// clear was applied to one and not the other -- while that commit's message claimed "both
		// paths now manage content.state consistently". Two copies of a subtle lifecycle contract
		// IS the bug; one shared module is the fix, because it makes the divergence unexpressible.
		const lightbox = source('Lightbox');
		const upgradeModule = readFileSync('src/lib/media/hdr-upgrade.ts', 'utf8');
		const contentLoad = lightbox.slice(lightbox.indexOf("instance.on('contentLoad'"), lightbox.indexOf("instance.on('loadError'"));
		expect(lightbox).toContain("import { beginHdrUpgrade, isHdrUpgradeLoading } from '$lib/media/hdr-upgrade'");
		// Exactly two call sites -- the AVIF path and the HDR video path -- and no third copy.
		expect(contentLoad.match(/beginHdrUpgrade\(\{/g)).toHaveLength(2);
		// The promotion bookkeeping lives in the shared module, once, rather than per-path.
		expect(upgradeModule.match(/__hdrPromoted = true/g)).toHaveLength(1);
		expect(contentLoad).not.toContain('__hdrPromoted = true');
	});

	it('hands the HDR element to PhotoSwipe rather than clearing content.element, so an attempt resolving before the slide is attached cannot blank it', () => {
		// This deliberately replaces an earlier contract that asserted the OPPOSITE: it required
		// `content.element = undefined` on any attempt that resolved while !content.isAttached, to
		// force a fresh retry on revisit. That turned out to be why the first photo intermittently
		// showed nothing at all. PhotoSwipe's lightbox module starts preloading slide content
		// before its own module import resolves and before the gallery finishes opening, and
		// Slide.appendHeavy() deliberately refuses to attach during that window -- so !isAttached
		// is the NORMAL state of a first slide that is still opening, not evidence of recycling.
		// Clearing the element there threw away a load that had just succeeded.
		//
		// Content.append() reads content.element at call time, so assigning it and doing nothing
		// else is correct in both cases at once: still-opening (PhotoSwipe appends it shortly) and
		// genuinely recycled (content.slide has been cleared, so there is nothing to append into).
		const lightbox = source('Lightbox');
		const contentLoad = lightbox.slice(lightbox.indexOf("instance.on('contentLoad'"), lightbox.indexOf("instance.on('loadError'"));
		expect(contentLoad).not.toContain('abandonStaleAttempt');
		expect(contentLoad).not.toContain('content.element = undefined');
		expect(contentLoad).not.toContain('!content.isAttached');
		// Behavioral coverage: tests/unit/hdr-upgrade.test.ts, 'hands the real element to
		// PhotoSwipe without appending when the slide is not attached yet'.
		expect(readFileSync('src/lib/media/hdr-upgrade.ts', 'utf8')).toContain('content.element = real;');
	});

	it('drives the native PhotoSwipe preloader through PhotoSwipe\'s own hooks, on both edges, for both HDR paths', () => {
		// The previous version of this contract asserted only that the video path contained
		// `content.state = 'loading'`, under the name "drives the native PhotoSwipe preloader
		// spinner". It passed for the entire time the spinner was in fact permanently stuck --
		// because writing PhotoSwipe's load state is only half the contract, and no source-text
		// check can see that nothing ever told the preloader to re-read it. The preloader re-reads
		// isContentLoading() only on 'change', on 'loadComplete', or when
		// ui.updatePreloaderVisibility() is called (ui/loading-indicator.js publishes it with an
		// explicit `// expose the method` for exactly this case).
		const lightbox = source('Lightbox');
		const upgradeModule = readFileSync('src/lib/media/hdr-upgrade.ts', 'utf8');
		// Report the loading state when PhotoSwipe asks, instead of writing its own field behind
		// its back: a second, hand-maintained copy of "am I loading" is what desynced.
		expect(lightbox).toContain("instance.addFilter('isContentLoading'");
		expect(lightbox).toContain('isHdrUpgradeLoading(content) || isContentLoading');
		expect(lightbox).not.toContain('content.state =');
		// ...and nudge the preloader to re-read it, through the published method.
		expect(lightbox).toContain('const refreshSpinner = () => lightbox?.pswp?.ui?.updatePreloaderVisibility?.();');
		// Both edges -- once when the attempt starts, once when it settles either way.
		expect(upgradeModule.match(/refreshSpinner\(\)/g)?.length).toBeGreaterThanOrEqual(2);
		// And no synthesized library-internal events: pre-open, a Content still belongs to the
		// PhotoSwipeLightbox (no preloader subscribed to it, and content.slide is undefined so the
		// handler's own currSlide check could never match), so dispatching 'loadComplete' at it
		// was silently a no-op for the first slide specifically -- the one that hung worst.
		expect(lightbox).not.toContain("dispatch?.('loadComplete'");
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
		expect(lightbox).toContain("`HDR video: failed to ${reason === 'video-playback' ? 'play' : 'load'} (${detail}), showing SDR photo [canPlayType ${canPlayDiagnostic}]`");
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

	// WR-02 lock-in (08-21-PLAN.md Task 4): JournalGallery itself must never become a second
	// /prewarm producer -- ReadinessIndicator is the sole control-loop owner (see the
	// "HDR control ownership moved to ReadinessIndicator" comment this test enforces, not just
	// documents). Source-text, matching this file's own established convention (see header
	// comment) rather than a render-based fetch spy: a reintroduced `fetch('/prewarm'...)` call
	// anywhere in this component's script would fail this assertion.
	it('never issues its own /prewarm control-loop request', () => {
		const gallery = source('JournalGallery');
		expect(gallery).not.toMatch(/prewarm/i);
		expect(gallery).not.toMatch(/\bfetch\(/);
	});
});
