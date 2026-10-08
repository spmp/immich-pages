<script lang="ts">
	import { onMount } from 'svelte';
	import 'photoswipe/style.css';
	import { reportJournalDebug } from './journal-debug';
	let { galleryId }: { galleryId: string } = $props();
	let status = $state<'loading' | 'ready' | 'failed'>('loading');
	// Visible, no-devtools-needed answer to "is what's currently showing actually the promoted
	// HDR media, or still the SDR placeholder/a failure?" -- requested after the zoom-button tint
	// alone wasn't enough to tell "detected as HDR" apart from "this specific slide's media never
	// promoted." Guarded by a content-identity check wherever it's set so a background/preloaded
	// neighboring slide's late network result can't overwrite the text for whatever is actually
	// on screen now.
	let hdrStatus = $state('');

	onMount(() => {
		let lightbox: any;
		let opener: HTMLElement | null = null;
		let ready = false;
		let destroyed = false;
		let modalHistory = false;
		let closingFromPopstate = false;
		let pendingHistoryTraversal = false;
		let pendingAnchor: HTMLAnchorElement | null = null;
		let activeViewer: any;
		const previousOverflow = document.body.style.overflow;
		const getGallery = () => document.querySelector<HTMLElement>(`#${galleryId}`);
		const announcement = document.querySelector<HTMLElement>('[data-pswp-announcement]');
		const focusable = (root: Element) => Array.from(root.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter((element) => !element.hasAttribute('disabled'));
		const announce = () => {
			const item = lightbox?.pswp?.currSlide?.data;
			if (announcement && item) announcement.textContent = `${(lightbox.pswp.currIndex ?? 0) + 1} / ${lightbox.pswp.getNumItems()} — ${item.element?.getAttribute('aria-label') ?? 'Image'}`;
		};
			// Visual-only diagnostic: tints the zoom button for whichever slide pages has identified
			// as carrying a real Apple gain map (the HDR video candidate or the AVIF HDR candidate),
			// independent of whether the current device/browser actually renders it as HDR -- lets
			// "is this detected as HDR" and "is this device showing it as HDR" be checked separately.
			const updateHdrIndicator = () => {
				const root = document.querySelector<HTMLElement>('.pswp');
				const content = lightbox?.pswp?.currSlide?.content;
				const isHdrCandidate = content?.type === 'hdr-image' || (content?.type === 'video' && content?.data?.element?.dataset.videoControls === 'false');
				root?.toggleAttribute('data-pswp-hdr-active', Boolean(isHdrCandidate));
				// Reset on every slide change; the content-identity-guarded setHdrStatus calls inside
				// the contentLoad handlers below will promptly repopulate it for whichever slide is
				// now current. (A slide that already fully resolved in the background while it was a
				// preloaded neighbor, not yet current, won't have its text restored here -- a known,
				// low-stakes gap for the rapid-preloaded-swiping case, not the single-photo-view case
				// this was built to answer.)
				if (!isHdrCandidate) hdrStatus = '';
			};
			// Only applied if `content` is still the actively-displayed slide at the moment it
			// resolves -- a late network result for a background/preloaded neighboring slide must not
			// overwrite the status text for whatever the viewer is actually looking at right now.
			const setHdrStatus = (content: any, text: string) => {
				if (content === lightbox?.pswp?.currSlide?.content) hdrStatus = text;
			};
		const onKeydown = (event: KeyboardEvent) => {
			const root = document.querySelector<HTMLElement>('.pswp--open');
			if (!root) return;
			if (event.key === 'Escape') return;
			if (event.key !== 'Tab') return;
			// focus trap: keep keyboard navigation inside the open viewer.
			const controls = focusable(root);
			if (!controls.length) return;
			const first = controls[0];
			const last = controls[controls.length - 1];
			if (event.shiftKey && (document.activeElement === first || document.activeElement === root)) { event.preventDefault(); last.focus(); }
			else if (!event.shiftKey && (document.activeElement === last || document.activeElement === root)) { event.preventDefault(); first.focus(); }
		};
		const onPopstate = () => {
			// Escape closes PhotoSwipe first and then traverses the history entry we
			// added on open. A click can arrive in that small interval; hold it until
			// the traversal has completed so this popstate cannot close a new viewer.
			if (pendingHistoryTraversal) {
				pendingHistoryTraversal = false;
				modalHistory = false;
				const queuedAnchor = pendingAnchor;
				pendingAnchor = null;
				setTimeout(() => {
					if (destroyed || !ready || !lightbox || !queuedAnchor) return;
					const gallery = getGallery();
					const index = Array.from(gallery?.querySelectorAll('a') ?? []).indexOf(queuedAnchor);
					if (index >= 0) lightbox.loadAndOpen(index);
				}, 0);
				return;
			}
			if (destroyed || !lightbox?.pswp) { modalHistory = false; return; }
			closingFromPopstate = true;
			modalHistory = false;
			if (activeViewer) activeViewer.close();
			else document.querySelector<HTMLElement>('.pswp__button--close, .pswp button')?.click();
			setTimeout(() => {
				const root = document.querySelector<HTMLElement>('.pswp--open');
				if (!root) return;
				root.classList.remove('pswp--open');
				root.style.display = 'none';
				document.body.style.overflow = previousOverflow;
				opener?.focus();
				opener = null;
				activeViewer = undefined;
			}, 0);
		};
		const onReadyClick = (event: MouseEvent) => {
			const gallery = getGallery();
			if (destroyed || !gallery) return;
			// Leave the ordinary same-origin anchor untouched while enhancement loads.
			if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
			const anchor = (event.target as Element).closest<HTMLAnchorElement>('a');
			if (!anchor || !gallery.contains(anchor)) return;
			if (ready && lightbox) {
				event.preventDefault();
				if (pendingHistoryTraversal) {
					pendingAnchor = anchor;
					return;
				}
				lightbox.loadAndOpen(Array.from(gallery.querySelectorAll('a')).indexOf(anchor));
				return;
			}
			event.preventDefault();
			pendingAnchor = anchor;
		};
		document.addEventListener('click', onReadyClick, true);
		document.addEventListener('keydown', onKeydown);
		window.addEventListener('popstate', onPopstate, true);
		void (async () => {
			try {
				const { default: PhotoSwipeLightbox } = await import('photoswipe/lightbox');
				if (destroyed) return;
				const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
				const instance = new PhotoSwipeLightbox({ gallery: `#${galleryId}`, children: 'a', pswpModule: () => import('photoswipe'), showHideAnimationType: reducedMotion ? 'none' : 'zoom', wheelToZoom: true, bgOpacity: 1 });
				lightbox = instance;
				instance.addFilter('itemData', (itemData: any) => {
					const element = itemData.element as HTMLAnchorElement | undefined;
					if (element?.dataset.pswpType === 'video') return { ...itemData, type: 'video', src: element.dataset.videoSrc, poster: element.dataset.videoPoster };
					if (element?.dataset.pswpType === 'hdr-image') return { ...itemData, type: 'hdr-image', src: element.dataset.pswpSrc, poster: element.dataset.pswpPoster };
					return element?.dataset.pswpSrc ? { ...itemData, src: element.dataset.pswpSrc } : itemData;
				});
				// The HDR video candidate is a disguised still image (single frame, muted, looped,
				// no controls) wearing a <video> element only because this is the one representation
				// that actually renders HDR on real devices (see .planning/spikes/). An ordinary
				// authored video keeps PhotoSwipe's default non-zoomable video behavior -- pinch-zoom
				// fighting with playback controls/seeking makes no sense there. The 'hdr-image' type
				// (AVIF gain-map candidate) also needs to opt in explicitly since it isn't PhotoSwipe's
				// native 'image' type -- see the contentLoad handler below for why.
				instance.addFilter('isContentZoomable', (isContentZoomable: boolean, content: any) => {
					const isHdrVideoCandidate = content?.data?.element?.dataset.videoControls === 'false';
					const isHdrImageCandidate = content?.type === 'hdr-image';
					return (isHdrVideoCandidate || isHdrImageCandidate) ? true : isContentZoomable;
				});
				instance.on('contentLoad', (event: any) => {
					const { content } = event;
					if (content.type === 'hdr-image') {
						event.preventDefault();
						const label = content.data.element?.getAttribute('aria-label') ?? 'Journey photograph';

						// PhotoSwipe's native image pipeline gates DOM insertion behind HTMLImageElement.decode()
						// on Safari (a workaround for a *different*, partial-rendering Safari bug) -- but decode()
						// can take far longer than a plain load/complete check for a large AVIF with an embedded
						// HDR gain map, especially on a cold/uncached first conversion. When decode() stalls,
						// PhotoSwipe's own onload-driven state machine still marks the content "loaded" and
						// removes the placeholder/spinner, leaving a blank slide with nothing ever appended --
						// the real image is silently stuck behind decode() forever. Sidestep the native pipeline
						// entirely for this content type, same approach already used for the HDR video candidate
						// below: show the already-working SDR image until our own out-of-band load has actually
						// finished, using only the plain load/error events -- never decode() -- since decode() is
						// exactly the API that stalls.
						const placeholder = document.createElement('img');
						if (content.data.poster) placeholder.src = content.data.poster;
						placeholder.alt = label;
						placeholder.className = 'pswp__img';
						content.element = placeholder;
						content.state = 'loading';
						setHdrStatus(content, 'AVIF HDR image: loading…');

						const real = new Image();
						real.alt = label;
						real.className = 'pswp__img';

						let settled = false;
						let hdrTimeout: number | undefined;
						const finish = () => {
							if (hdrTimeout !== undefined) window.clearTimeout(hdrTimeout);
							content.state = 'loaded';
							content.instance?.dispatch?.('loadComplete', { slide: content.slide, content });
						};
						const giveUp = () => {
							if (settled) return;
							settled = true;
							finish();
							setHdrStatus(content, 'AVIF HDR image: failed, showing SDR photo');
							reportJournalDebug('media-failure', { category: 'image', status: 'unavailable', errorContext: 'image-load', failureCategory: 'decode' });
							// The placeholder <img> is already the visible, correct content; nothing to swap.
						};
						const promote = () => {
							if (settled) return;
							settled = true;
							finish();
							setHdrStatus(content, 'AVIF HDR image: loaded');
							// PhotoSwipe sizes a content's element by setting explicit inline width/height
							// on it directly (Content.setDisplayedSize -> setWidthHeight), keyed to whichever
							// element is currently content.element -- swapping the reference to `real` here
							// without copying that over leaves `real` unsized (shows at native pixel size,
							// i.e. "fully zoomed in") since nothing re-triggers a resize just because the
							// element reference changed. Copy the already-correct box straight across.
							real.style.width = placeholder.style.width;
							real.style.height = placeholder.style.height;
							placeholder.remove();
							content.element = real;
							content.slide?.container.appendChild(real);
						};
						real.addEventListener('error', giveUp);
						real.addEventListener('load', promote, { once: true });
						// Server-side compose/encode alone can take up to ~20s each for a real photo (see
						// hdr-compositor.ts), and both HDR routes share one small concurrency pool with
						// the gallery's own background prewarm fetches (JournalGallery.svelte) -- a request
						// queued behind those can easily take another 20-40s before it even starts. 30s
						// was giving up on perfectly good, still-in-progress conversions.
						hdrTimeout = window.setTimeout(giveUp, 60_000);
						real.src = content.data.src;
						if (real.complete) promote();
						return;
					}
					if (content.type !== 'video') return;
					event.preventDefault();
					const controlsDisabled = content.data.element?.dataset.videoControls === 'false';
					const label = content.data.element?.getAttribute('aria-label') ?? 'Journey video';

					if (!controlsDisabled) {
						// An ordinary authored video (not an HDR candidate): unchanged behavior, native
						// controls, no auto-play/auto-swap machinery.
						const video = document.createElement('video');
						video.src = content.data.src;
						video.poster = content.data.poster;
						video.controls = true;
						video.playsInline = true;
						video.preload = 'metadata';
						video.className = 'pswp__video';
						video.setAttribute('aria-label', label);
						video.addEventListener('error', () => reportJournalDebug('media-failure', { category: 'video', status: 'unavailable', errorContext: 'video-load', failureCategory: 'decode' }));
						const track = document.createElement('track');
						track.kind = 'captions';
						video.appendChild(track);
						content.element = video;
						return;
					}

					// HDR candidate: a real first-time HDR conversion can legitimately take several
					// seconds server-side (native decode/composite/encode, uncached). Never remove the
					// already-working SDR poster from the slide until the HDR video has proven it can
					// actually decode and play -- this makes a slow, hung, or failing HDR source just
					// never upgrade, instead of leaving the slide blank with nothing to recover to.
					const placeholder = document.createElement('img');
					if (content.data.poster) placeholder.src = content.data.poster;
					placeholder.alt = label;
					placeholder.className = 'pswp__img';
					content.element = placeholder;
					setHdrStatus(content, 'HDR video: loading…');

					const video = document.createElement('video');
					// Zero-cost, zero-network diagnostic: ask the browser's own canPlayType directly
					// which part of the encode it claims to support, *before* even attempting to load
					// the real file -- narrows "format unsupported" down to HEVC itself vs. the 10-bit
					// profile vs. the HDR (BT.2020/PQ) signaling, without needing devtools access.
					// Folded into the final status text (not shown on its own) since it would
					// otherwise just flash and be overwritten the instant load/error fires.
					const canPlayDiagnostic = `8bit:"${video.canPlayType('video/mp4; codecs="hvc1.1.6.L153.B0"')}" 10bit:"${video.canPlayType('video/mp4; codecs="hvc1.2.4.L153.B0"')}" hev1:"${video.canPlayType('video/mp4; codecs="hev1.2.4.L153.B0"')}"`;
					video.src = content.data.src;
					video.poster = content.data.poster;
					video.controls = false;
					video.playsInline = true;
					video.preload = 'auto';
					video.autoplay = true;
					video.muted = true;
					video.loop = true;
					video.className = 'pswp__video';
					video.setAttribute('aria-label', label);
					const track = document.createElement('track');
					track.kind = 'captions';
					video.appendChild(track);

					let settled = false;
					let hdrTimeout: number | undefined;
					// MediaError.code, straight from the browser's own native video pipeline: 1=ABORTED,
					// 2=NETWORK, 3=DECODE, 4=SRC_NOT_SUPPORTED. Server-side everything has checked out
					// clean (right bytes, right container structure, zero errors logged) while this
					// still fails client-side with no visible reason why -- this is the single most
					// direct signal available without devtools access, so surface it on screen rather
					// than only in the (also devtools-only) console.
					const mediaErrorLabel: Record<number, string> = { 1: 'aborted', 2: 'network', 3: 'decode', 4: 'format unsupported' };
					const giveUp = (errorContext: 'video-load' | 'video-playback') => {
						if (settled) return;
						settled = true;
						if (hdrTimeout !== undefined) window.clearTimeout(hdrTimeout);
						// Must read video.error before removeAttribute('src')/load() below, which clear it.
						const code = video.error?.code;
						const reason = code !== undefined ? (mediaErrorLabel[code] ?? `code ${code}`) : 'timed out';
						video.pause();
						video.removeAttribute('src');
						video.load();
						setHdrStatus(content, `HDR video: failed to ${errorContext === 'video-playback' ? 'play' : 'load'} (${reason}), showing SDR photo [canPlayType ${canPlayDiagnostic}]`);
						reportJournalDebug('media-failure', { category: 'video', status: 'unavailable', errorContext, failureCategory: errorContext === 'video-playback' ? 'playback' : 'decode' });
						// The placeholder <img> is already the visible, correct content; nothing to swap.
					};
					const promote = () => {
						if (settled || content.type !== 'video') return;
						settled = true;
						if (hdrTimeout !== undefined) window.clearTimeout(hdrTimeout);
						setHdrStatus(content, 'HDR video: playing');
						// content.load()/content.append() are one-shot (guarded by content.isAttached,
						// already set true when the placeholder was attached) and will not re-run content
						// creation for an already-attached slide; PhotoSwipe's own Content.append() does
						// exactly this direct DOM insertion for non-image content, so do the same here.
						placeholder.remove();
						content.element = video;
						content.slide?.container.appendChild(video);
					};
					video.addEventListener('error', () => giveUp('video-load'));
					// See the AVIF path's identical comment above: server-side compose/encode can take
					// up to ~20s each for a real photo, and both HDR routes share one small concurrency
					// pool with the gallery's own background prewarm fetches -- a request queued behind
					// those can take another 20-40s before it even starts. 30s was giving up on
					// perfectly good, still-in-progress conversions.
					hdrTimeout = window.setTimeout(() => giveUp('video-load'), 60_000);
					video.addEventListener('loadeddata', () => {
						void video.play().then(promote).catch(() => giveUp('video-playback'));
					}, { once: true });
				});
				instance.on('loadError', (event: any) => {
					const { content } = event;
					const anchor = content.data.element as HTMLAnchorElement | undefined;
					if (content.type !== 'image' || !anchor?.dataset.pswpSrc) return;
					delete anchor.dataset.pswpSrc;
					content.element?.remove();
					content.element = undefined;
					content.data.src = anchor.href;
					content.load(false, true);
					reportJournalDebug('media-failure', { category: 'image', status: 'unavailable', errorContext: 'image-load', failureCategory: 'decode' });
				});
				instance.on('beforeOpen', (event: any) => {
					activeViewer = event.pswp;
					opener = document.activeElement as HTMLElement;
					document.body.style.overflow = 'hidden';
					if (!modalHistory) { history.pushState({ immichPagesLightbox: true }, '', location.href); modalHistory = true; }
					reportJournalDebug('lightbox', { status: 'opened' });
				});
				instance.on('afterInit', () => {
					const focusClose = () => {
						const root = document.querySelector<HTMLElement>('.pswp');
						const close = root?.querySelector<HTMLElement>('button[aria-label*="Close"], button[title*="Close"], .pswp__button');
						if (close) {
							close.focus();
							if (document.activeElement === close) return true;
							return false;
						}
						if (root) {
							root.tabIndex = -1;
							root.focus();
						}
						return Boolean(root);
					};
					focusClose();
					setTimeout(() => {
						if (!focusClose()) setTimeout(focusClose, 0);
					}, 0);
					setTimeout(focusClose, 50);
				});
				instance.on('openingAnimationEnd', () => {
					const root = document.querySelector<HTMLElement>('.pswp');
					root?.setAttribute('data-pswp-modal', 'true');
					updateHdrIndicator();
					setTimeout(() => {
						const openRoot = document.querySelector<HTMLElement>('.pswp--open');
						(openRoot?.querySelector<HTMLElement>('button[aria-label*="Close"], button[title*="Close"], .pswp__button') ?? openRoot)?.focus();
						announce();
						setTimeout(() => openRoot?.querySelector<HTMLElement>('.pswp__button--close, button[aria-label*="Close"], button[title*="Close"]')?.focus(), 0);
					}, 0);
				});
				instance.on('change', () => { announce(); updateHdrIndicator(); });
				instance.on('close', () => {
					const shouldGoBack = modalHistory && !closingFromPopstate;
					modalHistory = false;
					closingFromPopstate = false;
					pendingHistoryTraversal = shouldGoBack;
					document.body.style.overflow = previousOverflow;
					opener?.focus(); opener = null;
					activeViewer = undefined;
					reportJournalDebug('lightbox', { status: 'closed' });
					if (shouldGoBack) history.back();
				});
				instance.init();
				ready = true;
				status = 'ready';
				if (pendingAnchor) {
					const index = Array.from(getGallery()?.querySelectorAll('a') ?? []).indexOf(pendingAnchor);
					pendingAnchor = null;
					if (index >= 0) instance.loadAndOpen(index);
				}
				reportJournalDebug('lightbox', { status: 'initialized' });
			} catch {
				ready = false;
				status = 'failed';
				const fallback = (pendingAnchor as HTMLAnchorElement | null)?.href;
				pendingAnchor = null;
				if (fallback) location.assign(fallback);
				reportJournalDebug('lightbox', { status: 'failure', errorContext: 'lightbox-load' });
			}
		})();
		return () => {
			destroyed = true; ready = false;
			document.removeEventListener('click', onReadyClick, true);
			document.removeEventListener('keydown', onKeydown);
			window.removeEventListener('popstate', onPopstate, true);
			document.body.style.overflow = previousOverflow;
			lightbox?.destroy();
		};
	});
</script>

<p class="sr-only" aria-live="polite" data-pswp-announcement data-lightbox-status={status}>Images open in the full-screen viewer. Use Escape to close. <span aria-label="Close full-screen viewer"></span></p>

{#if hdrStatus}<p class="hdr-status" data-pswp-hdr-status>{hdrStatus}</p>{/if}

<style>
	.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
	:global(.pswp) {
		position: fixed;
		inset: 0;
		width: 100vw;
		height: 100vh;
		height: 100dvh;
	}
	:global(.pswp--open) { display: block; visibility: visible; }
	:global(.pswp), :global(.pswp__bg) { --pswp-bg: var(--theme-overlay, #000); --pswp-bg-opacity: 1; background-color: var(--theme-overlay, #000); opacity: 1; }
	:global(.pswp__video) { display: block; max-width: 100%; max-height: 100%; width: auto; height: auto; object-fit: contain; }
	/* Diagnostic only: identifies a slide pages has detected as carrying a real Apple gain map,
	   independent of whether this device/browser actually renders it as HDR. The zoom icon's
	   fill comes from the --pswp-icon-color custom property (photoswipe.css); only its inner
	   crosshair bars use currentColor (bound to --pswp-icon-color-secondary), which defaults to
	   a dark grey that gives the "+" contrast against the white glass shape -- overriding both
	   to the same light blue erased that contrast, making the "+" invisible against itself.
	   Only tint the glass shape; leave the secondary color at its default for contrast. */
	:global(.pswp[data-pswp-hdr-active] .pswp__button--zoom) { --pswp-icon-color: lightblue; }
	/* Diagnostic only, same purpose as the zoom-button tint above: a plain-language, no-devtools-
	   needed answer to "is what's on screen right now actually the promoted HDR media, or still
	   the SDR placeholder/a failure." Only rendered while non-empty (i.e. only while a lightbox
	   slide with a real gain map is loading/resolved), so it's invisible the rest of the time. */
	.hdr-status {
		position: fixed;
		/* PhotoSwipe's own root (.pswp, dynamically appended later in the DOM) uses
		   --pswp-root-z-index: 100000. Equal z-index ties resolve by document order, so at
		   100000 this sibling element painted *underneath* the lightbox's opaque backdrop --
		   invisible the entire time, not a logic bug. One higher clears its whole stacking
		   context (including all of its children's z-indices, which are capped within it). */
		z-index: 100001;
		top: max(8px, env(safe-area-inset-top));
		left: 50%;
		transform: translateX(-50%);
		margin: 0;
		padding: 4px 10px;
		font-size: 13px;
		line-height: 1.4;
		color: #fff;
		background: rgba(0, 0, 0, 0.7);
		border-radius: 6px;
		pointer-events: none;
	}
</style>
