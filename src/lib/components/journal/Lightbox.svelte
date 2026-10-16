<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { env } from '$env/dynamic/public';
	import 'photoswipe/style.css';
	import { beforeNavigate } from '$app/navigation';
	import { clientDiagnostics, journalDebugEnabled, reportJournalDebug } from './journal-debug';
	import { measureMediaFootprint, measureVideoStates } from './client-diagnostics';
	import { beginHdrUpgrade, isHdrUpgradeLoading, probeHdrVersion, type HdrAvailability } from '$lib/media/hdr-upgrade';
	import { markHdrUpgradePromoted } from '$lib/media/hdr-upgrade';
	import { HdrMediaCache } from '$lib/media/hdr-media-cache';
	let { galleryId }: { galleryId: string } = $props();
	let status = $state<'loading' | 'ready' | 'failed'>('loading');
	// The zoom-button tint tells a viewer whether this photo has an HDR version and whether it is
	// the one showing (yellow while it loads, blue once it does): on by default, set
	// PUBLIC_HDR_ZOOM_INDICATOR=false to hide it. The on-screen status line is a debugging aid
	// built while root-causing HDR rendering, off unless PUBLIC_HDR_DEBUG=true.
	const hdrZoomIndicatorEnabled = env.PUBLIC_HDR_ZOOM_INDICATOR !== 'false';
	const hdrDebugEnabled = env.PUBLIC_HDR_DEBUG === 'true';
	// How long to wait for an HDR conversion before giving up and settling for the SDR photo.
	// Real conversions can legitimately take 20-40s+ server-side, and both HDR routes share one
	// small concurrency pool with the gallery's own background prewarm fetches, so a request a
	// few photos into a browsing session can queue behind several others -- configurable rather
	// than another guessed hardcoded number, so it can be tuned directly against what a real
	// session actually needs without a code change each time.
	const parsedHdrClientTimeoutMs = Number(env.PUBLIC_HDR_CLIENT_TIMEOUT_MS);
	const hdrClientTimeoutMs = Number.isFinite(parsedHdrClientTimeoutMs) && parsedHdrClientTimeoutMs > 0 ? Math.min(parsedHdrClientTimeoutMs, 600_000) : 60_000;
	// Visible, no-devtools-needed answer to "is what's currently showing actually the promoted
	// HDR media, or still the SDR placeholder/a failure?" -- requested after the zoom-button tint
	// alone wasn't enough to tell "detected as HDR" apart from "this specific slide's media never
	// promoted." Guarded by a content-identity check wherever it's set so a background/preloaded
	// neighboring slide's late network result can't overwrite the text for whatever is actually
	// on screen now.
	let hdrStatus = $state('');

	// lightbox-mobile-crash diagnostic: every SvelteKit-routed way of leaving this page, with
	// where it is going. A client-side navigation never fires pagehide, so without this a
	// history.back() that the router resolves to the library would leave no trace at all.
	beforeNavigate((navigation) => {
		if (!journalDebugEnabled) return;
		if (navigation.willUnload && navigation.type !== 'leave') clientDiagnostics.setExitCause('sveltekit-navigation');
		reportJournalDebug('navigation', { navKind: navigation.type, navDelta: navigation.delta, navToRoute: navigation.to?.route?.id ?? undefined, willUnload: navigation.willUnload, lightboxOpen: Boolean(document.querySelector('.pswp--open')) });
	});

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
		// Every promoted HDR video, across however many slides currently hold one -- a slide
		// several photos away is still "cached" (not destroyed) by PhotoSwipe's ContentLoader, and
		// nothing about navigating away from it ever paused the <video> it already promoted. With
		// autoplay+loop set at promote time and never revisited, each one just keeps decoding and
		// looping in the background indefinitely. On a resource-constrained device, two or three of
		// those running at once was enough to stall a *new* video's decode past its own timeout --
		// the conversion had already landed server-side, but the client never got to play() it.
		// Single-frame content, so pausing changes nothing about what's visible; only the active
		// decode/display pipeline (which is what some platforms gate real HDR tone-mapping behind)
		// needs to be limited to the one slide actually on screen.
		const hdrVideos: HTMLVideoElement[] = [];
		const hdrVideoLoaders = new SvelteMap<any, () => void>();
		const hdrVideoPromoters = new SvelteMap<any, () => void>();
		// Free what a promoted element holds, not just our reference to it: a <video> that still
		// has a src keeps its decoder and decoded frames whether or not it is in the document or
		// playing. Holding one per photo viewed is what got the tab killed on a real phone (15-19
		// held at each kill, slides painting black shortly before as the OS took decoders away)
		// -- see .planning/debug/lightbox-mobile-crash.md.
		const releaseHdrMedia = (media: HTMLImageElement | HTMLVideoElement) => {
			if (media instanceof HTMLVideoElement) {
				const held = hdrVideos.indexOf(media);
				if (held >= 0) hdrVideos.splice(held, 1);
				media.pause();
				media.removeAttribute('src');
				media.load();
			} else media.removeAttribute('src');
			media.remove();
		};
		// PhotoSwipe itself keeps at most five slides' content alive; maxIdle is how many more
		// promoted elements may outlive their slide, so stepping back a few photos is still
		// instant without the total growing with the album.
		const promotedHdrMedia = new HdrMediaCache({ maxIdle: 2, release: releaseHdrMedia });
		// What to let go of when PhotoSwipe destroys a slide's content, keyed by that content.
		const hdrContentDisposers = new Map<any, () => void>();
		// Whether each photo has an HDR version, asked once per lightbox and remembered. A photo with
		// no HDR data is then never offered one -- it is simply the standard photo.
		const hdrAvailability = new Map<string, Promise<HdrAvailability>>();
		const checkHdrAvailability = (src: string) => {
			let answer = hdrAvailability.get(src);
			if (!answer) { answer = probeHdrVersion(src); hdrAvailability.set(src, answer); }
			return answer;
		};
		const showStandardPhoto = (content: any, photoSwipeType: 'hdr-image' | 'video', srcKind: 'hdr-avif' | 'hdr-video') => {
			content.__hdrNone = true;
			setHdrStatus(content, 'Standard photo: no HDR version');
			updateHdrIndicator();
			reportJournalDebug('hdr-media', { status: 'unavailable', hdrReason: 'unsupported', spinner: 'stop', photoSwipeType, srcKind });
		};
		const syncHdrVideoPlayback = () => {
			const currentVideo = lightbox?.pswp?.currSlide?.content?.element as HTMLVideoElement | undefined;
			for (const video of hdrVideos) {
				if (video === currentVideo) { if (video.paused) void video.play().catch(() => {}); }
				else if (!video.paused) video.pause();
			}
		};
		const previousOverflow = document.body.style.overflow;
		const getGallery = () => document.querySelector<HTMLElement>(`#${galleryId}`);
		const announcement = document.querySelector<HTMLElement>('[data-pswp-announcement]');
		const focusable = (root: Element) => Array.from(root.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter((element) => !element.hasAttribute('disabled'));
		const announce = () => {
			const item = lightbox?.pswp?.currSlide?.data;
			if (announcement && item) announcement.textContent = `${(lightbox.pswp.currIndex ?? 0) + 1} / ${lightbox.pswp.getNumItems()} — ${item.element?.getAttribute('aria-label') ?? 'Image'}`;
		};
		// Tells JournalGallery's background HDR prewarm scheduler which photo the viewer is
		// actually looking at right now, so it can reprioritize to continue sequentially from here
		// instead of wherever the initial front-to-back scan happened to be -- without this, a
		// request a few photos into a browsing session could sit queued behind many already-
		// scheduled prewarm fetches for photos nobody's looking at anymore.
		const notifyActiveAsset = () => {
			const anchor = lightbox?.pswp?.currSlide?.content?.data?.element as HTMLElement | undefined;
			const figure = anchor?.closest('figure');
			const figureId = figure?.id;
			const gallery = getGallery();
			const activePosition = anchor && gallery ? Array.from(gallery.querySelectorAll('a')).indexOf(anchor as HTMLAnchorElement) : -1;
			if (figureId && figure?.dataset.assetId && activePosition >= 0) document.dispatchEvent(new CustomEvent('pages:active-asset', { detail: { figureId, activeAssetId: figure.dataset.assetId, activePosition } }));
		};
			// Viewer-facing cue: tints the zoom button for whichever slide pages has identified
			// as carrying a real Apple gain map (the HDR video candidate or the AVIF HDR candidate),
			// independent of whether the current device/browser actually renders it as HDR -- lets
			// "is this detected as HDR" and "is this device showing it as HDR" be checked separately.
			// Three states, not two: white (not an HDR candidate at all), khaki/yellow (candidate,
			// still showing the SDR placeholder -- loading, or silently never promoted), blue
			// (candidate, the real HDR media is actually attached and showing). The yellow state is
			// what made the real bug below visible in the first place: content.__hdrPromoted set but
			// never reflected is impossible, so a slide stuck yellow forever means attachment itself
			// silently failed, not that it's merely slow.
			const updateHdrIndicator = () => {
				const root = document.querySelector<HTMLElement>('.pswp');
				const content = lightbox?.pswp?.currSlide?.content;
				// No tint for a photo with no HDR version, or once an HDR attempt has given up: the
				// standard photo is what is showing, so the cue must not stay on "loading".
				const isHdrCandidate = !content?.__hdrNone && !content?.__hdrGaveUp && (content?.type === 'hdr-image' || (content?.type === 'video' && content?.data?.element?.dataset.videoControls === 'false'));
				// The two settings are independent now, so the debug status line is reset here even
				// when the tint is switched off.
				if (!isHdrCandidate) hdrStatus = '';
				if (!hdrZoomIndicatorEnabled) { root?.removeAttribute('data-pswp-hdr-state'); return; }
				if (!isHdrCandidate) {
					root?.removeAttribute('data-pswp-hdr-state');
					// Reset on every slide change; the content-identity-guarded setHdrStatus calls
					// inside the contentLoad handlers below will promptly repopulate it for whichever
					// slide is now current. (A slide that already fully resolved in the background
					// while it was a preloaded neighbor, not yet current, won't have its text restored
					// here -- a known, low-stakes gap for the rapid-preloaded-swiping case, not the
					// single-photo-view case this was built to answer.)
					hdrStatus = '';
					return;
				}
				root?.setAttribute('data-pswp-hdr-state', content.__hdrPromoted ? 'loaded' : 'pending');
			};
			// Only applied if `content` is still the actively-displayed slide at the moment it
			// resolves -- a late network result for a background/preloaded neighboring slide must not
			// overwrite the status text for whatever the viewer is actually looking at right now.
			const setHdrStatus = (content: any, text: string) => {
				if (!hdrDebugEnabled) return;
				if (content === lightbox?.pswp?.currSlide?.content) hdrStatus = text;
			};
			// PhotoSwipe's built-in preloader does not poll; it re-reads content.isLoading() only
			// when told to -- on 'change', on 'loadComplete', or through this method, which
			// ui/loading-indicator.js publishes with an explicit `// expose the method` for exactly
			// the case of a content type that loads outside PhotoSwipe's own image pipeline. Both
			// HDR paths are that case, so both must call this on both edges of their loading state;
			// announcing only the start is what previously left a spinner running forever over an
			// HDR video that had actually loaded fine.
			//
			// Deliberately goes through lightbox.pswp rather than the Content's own `instance`: a
			// Content created during the pre-open preload window belongs to the PhotoSwipeLightbox,
			// which has no preloader subscribed and no currSlide to match against, so nudging it
			// there is silently a no-op. Before the viewer exists there is simply no spinner to
			// update, and the 'change' PhotoSwipe dispatches as it opens (photoswipe.js:413) re-reads
			// the state anyway.
		const refreshSpinner = () => lightbox?.pswp?.ui?.updatePreloaderVisibility?.();
		// lightbox-mobile-crash diagnostics (all no-ops unless PUBLIC_PAGES_DEBUG=true). The
		// history trace records this component's own bookkeeping next to the browser's real
		// history at each step of the open/close handshake, so a mismatch between the two --
		// the only way history.back() below can leave the page -- is visible in the log. The
		// gauge records what the lightbox is holding in memory, since a tab killed for memory
		// runs no code and can only be explained by the last figures it reported.
		const reportHistory = (historyAction: 'push' | 'back' | 'popstate-close' | 'popstate-traversal-done' | 'popstate-no-viewer') =>
			reportJournalDebug('history', { historyAction, historyLength: history.length, stateIsLightbox: Boolean(history.state?.immichPagesLightbox), modalHistory, closingFromPopstate, pendingHistoryTraversal, viewerOpen: Boolean(lightbox?.pswp) });
		let slidesViewed = 0;
		let lastGauge = '';
		let heartbeat: ReturnType<typeof setInterval> | undefined;
		const readGauge = () => {
			const retained = promotedHdrMedia.values();
			return { ...measureMediaFootprint(document, retained), ...measureVideoStates([...retained, ...hdrVideos]), retainedHdr: retained.length, liveVideos: hdrVideos.length, slidesViewed };
		};
		const reportGauge = (force: boolean) => {
			const gauge = readGauge();
			const key = JSON.stringify(gauge);
			if (force || key !== lastGauge) {
				lastGauge = key;
				const heapBytes = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory?.usedJSHeapSize;
				reportJournalDebug('resource-gauge', { ...gauge, jsHeapMb: typeof heapBytes === 'number' ? heapBytes / 1_048_576 : undefined, deviceMemoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory });
			}
			return gauge;
		};
		const stopHeartbeat = () => { if (heartbeat !== undefined) { clearInterval(heartbeat); heartbeat = undefined; } };
		const startHeartbeat = () => {
			if (!journalDebugEnabled || heartbeat !== undefined) return;
			// Keeps the stored breadcrumb fresh while the viewer is open, so the next load can
			// tell "died mid-use" from "died after sitting idle", and catches media that
			// finishes loading between slide changes.
			heartbeat = setInterval(() => {
				const gauge = reportGauge(false);
				clientDiagnostics.heartbeat({ decodedMegapixels: gauge.decodedMegapixels, liveVideos: gauge.liveVideos, retainedHdr: gauge.retainedHdr });
			}, 5_000);
		};
		const reportSlide = (status: 'opened' | 'closed' | 'changed') => {
			const pswp = lightbox?.pswp;
			const content = pswp?.currSlide?.content;
			const anchor = content?.data?.element as HTMLElement | undefined;
			const anchors = getGallery()?.querySelectorAll('a');
			const assetIndex = anchor && anchors ? Array.from(anchors).indexOf(anchor as HTMLAnchorElement) : -1;
			if (journalDebugEnabled) {
				if (status !== 'closed') slidesViewed += 1;
				const gauge = reportGauge(true);
				clientDiagnostics.note(`lightbox:${status}`, { lightboxOpen: status !== 'closed', slideIndex: typeof pswp?.currIndex === 'number' ? pswp.currIndex : undefined, slidesViewed, decodedMegapixels: gauge.decodedMegapixels, liveVideos: gauge.liveVideos, retainedHdr: gauge.retainedHdr });
			}
			reportJournalDebug('lightbox', { status, assetIndex: assetIndex >= 0 ? assetIndex : undefined, assetTotal: anchors?.length, slideIndex: typeof pswp?.currIndex === 'number' ? pswp.currIndex : undefined, slideTotal: typeof pswp?.getNumItems === 'function' ? pswp.getNumItems() : undefined, photoSwipeType: content?.type === 'hdr-image' || content?.type === 'video' || content?.type === 'image' ? content.type : undefined, srcKind: content?.type === 'hdr-image' ? 'hdr-avif' : content?.data?.element?.dataset.videoControls === 'false' ? 'hdr-video' : content?.data?.src ? 'fullsize' : 'unknown' });
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
				reportHistory('popstate-traversal-done');
				// Still on this page after our own history.back(): it did not leave.
				clientDiagnostics.setExitCause(undefined);
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
			if (destroyed || !lightbox?.pswp) { reportHistory('popstate-no-viewer'); modalHistory = false; return; }
			reportHistory('popstate-close');
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
				// The sanctioned way to report a custom content type's loading state: PhotoSwipe asks
				// (Content.isLoading applies this filter) rather than the app writing content.state
				// behind its back. That matters because content.state is PhotoSwipe's own field --
				// keeping a second, hand-maintained copy of "am I loading" is what let the real state
				// and the spinner disagree. OR-ed with the incoming value so every content type this
				// app doesn't manage keeps PhotoSwipe's own answer.
				instance.addFilter('isContentLoading', (isContentLoading: boolean, content: any) => isHdrUpgradeLoading(content) || isContentLoading);
				instance.on('contentLoad', (event: any) => {
					const { content } = event;
					if (content.type === 'hdr-image') {
						event.preventDefault();
						reportJournalDebug('hdr-media', { status: 'loading', spinner: 'start', photoSwipeType: 'hdr-image', srcKind: 'hdr-avif' });
						const label = content.data.element?.getAttribute('aria-label') ?? 'Journey photograph';
						const cached = promotedHdrMedia.get('avif', content.data.src);
						if (cached) {
							content.element = cached;
							hdrContentDisposers.set(content, () => promotedHdrMedia.idle(cached));
							markHdrUpgradePromoted(content);
							setHdrStatus(content, 'AVIF HDR image: loaded');
							updateHdrIndicator();
							reportJournalDebug('hdr-media', { status: 'promoted', hdrReason: 'cached', cacheReuse: true, spinner: 'stop', photoSwipeType: 'hdr-image', srcKind: 'hdr-avif' });
							return;
						}

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
						setHdrStatus(content, 'AVIF HDR image: checking…');
						let slideGone = false;
						hdrContentDisposers.set(content, () => { slideGone = true; });
						const startAvifUpgrade = () => {
						setHdrStatus(content, 'AVIF HDR image: loading…');
						const real = new Image();
						real.alt = label;
						real.className = 'pswp__img';
						const reportAvifLifecycle = (status: 'loading' | 'ready' | 'failure', requestPhase: 'start' | 'end', spinner: 'start' | 'stop') =>
							reportJournalDebug('hdr-media', { status, requestPhase, spinner, photoSwipeType: 'hdr-image', srcKind: 'hdr-avif' });
						real.addEventListener('loadstart', () => reportAvifLifecycle('loading', 'start', 'start'));
						real.addEventListener('load', () => reportAvifLifecycle('ready', 'end', 'stop'));

						// Server-side compose/encode alone can take up to ~20s each for a real photo (see
						// hdr-compositor.ts), and both HDR routes share one small concurrency pool with
						// the gallery's own background prewarm fetches (JournalGallery.svelte) -- a request
						// queued behind those can easily take another 20-40s before it even starts. 30s
						// was giving up on perfectly good, still-in-progress conversions.
						const upgrade = beginHdrUpgrade({
							content,
							placeholder,
							real,
							timeoutMs: hdrClientTimeoutMs,
							refreshSpinner,
							beforeSwap: () => {
								// PhotoSwipe sizes a content's element by setting explicit inline width/height
								// on it directly (Content.setDisplayedSize -> setWidthHeight), keyed to whichever
								// element is currently content.element -- swapping the reference to `real`
								// without copying that over leaves `real` unsized (shows at native pixel size,
								// i.e. "fully zoomed in") since nothing re-triggers a resize just because the
								// element reference changed. Copy the already-correct box straight across.
								real.style.width = placeholder.style.width;
								real.style.height = placeholder.style.height;
							},
							// Only runs when the upgrade loses; stops a transfer nothing will ever show.
							releaseReal: () => real.removeAttribute('src'),
							onSettled: (outcome, reason) => {
								if (outcome === 'promoted') {
								promotedHdrMedia.set('avif', content.data.src, real);
									setHdrStatus(content, 'AVIF HDR image: loaded');
									updateHdrIndicator();
									reportJournalDebug('hdr-media', { status: 'promoted', spinner: 'stop', photoSwipeType: 'hdr-image', srcKind: 'hdr-avif' });
									return;
								}
								// The slide went away mid-load; that is not a media failure.
								if (reason === 'slide-destroyed') return;
								content.__hdrGaveUp = true;
								setHdrStatus(content, 'AVIF HDR image: failed, showing SDR photo');
								updateHdrIndicator();
								reportJournalDebug('hdr-media', { status: 'given-up', hdrReason: 'image-load', spinner: 'stop', photoSwipeType: 'hdr-image', srcKind: 'hdr-avif' });
								reportJournalDebug('media-failure', { category: 'image', status: 'unavailable', errorContext: 'image-load', failureCategory: 'decode' });
							}
						});
						hdrContentDisposers.set(content, () => {
							if (!upgrade.settled) upgrade.giveUp('slide-destroyed');
							else if (content.__hdrPromoted) promotedHdrMedia.idle(real);
						});
						real.addEventListener('error', () => {
							if (upgrade.settled) return;
							reportAvifLifecycle('failure', 'end', 'stop');
							upgrade.giveUp('image-load');
						});
						real.addEventListener('load', () => {
							if (real.naturalWidth > 0) upgrade.promote();
							else upgrade.giveUp('image-decode');
						}, { once: true });
						real.src = content.data.src;
						if (real.complete) upgrade.promote();
						};
						void checkHdrAvailability(content.data.src).then((availability) => {
							if (slideGone) return;
							if (availability === 'none') showStandardPhoto(content, 'hdr-image', 'hdr-avif');
							else startAvifUpgrade();
						});
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
						video.addEventListener('error', () => reportJournalDebug('media-failure', { category: 'video', status: 'unavailable', errorContext: 'video-load', failureCategory: 'decode', nativeErrorCode: video.error?.code ?? null }));
						const track = document.createElement('track');
						track.kind = 'captions';
						video.appendChild(track);
						content.element = video;
						return;
					}

					const cached = promotedHdrMedia.get('video', content.data.src);
					if (cached instanceof HTMLVideoElement) {
						content.element = cached;
						hdrContentDisposers.set(content, () => promotedHdrMedia.idle(cached));
						markHdrUpgradePromoted(content);
						if (!hdrVideos.includes(cached)) hdrVideos.push(cached);
						setHdrStatus(content, 'HDR video: playing');
						updateHdrIndicator();
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
					setHdrStatus(content, 'HDR video: checking…');
					reportJournalDebug('hdr-media', { status: 'loading', spinner: 'start', photoSwipeType: 'video', srcKind: 'hdr-video' });
					let videoSlideGone = false;
					hdrContentDisposers.set(content, () => { videoSlideGone = true; });
					const startVideoUpgrade = () => {
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
					video.preload = 'none';
					video.autoplay = false;
					video.muted = true;
					video.loop = true;
					video.className = 'pswp__video';
					video.setAttribute('aria-label', label);
					const track = document.createElement('track');
					track.kind = 'captions';
					video.appendChild(track);

					// MediaError.code, straight from the browser's own native video pipeline: 1=ABORTED,
					// 2=NETWORK, 3=DECODE, 4=SRC_NOT_SUPPORTED. Server-side everything has checked out
					// clean (right bytes, right container structure, zero errors logged) while this
					// still fails client-side with no visible reason why -- this is the single most
					// direct signal available without devtools access, so surface it on screen rather
					// than only in the (also devtools-only) console.
					const mediaErrorLabel: Record<number, string> = { 1: 'aborted', 2: 'network', 3: 'decode', 4: 'format unsupported' };
					const reportVideoLifecycle = (status: 'loading' | 'ready' | 'temporary' | 'failure', requestPhase?: 'start' | 'end', spinner?: 'start' | 'stop', nativeErrorCode?: number | null) =>
						reportJournalDebug('hdr-media', { status, requestPhase, spinner, nativeErrorCode, photoSwipeType: 'video', srcKind: 'hdr-video' });
					video.addEventListener('loadstart', () => reportVideoLifecycle('loading', 'start', 'start'));
					video.addEventListener('loadedmetadata', () => reportVideoLifecycle('ready'));
					video.addEventListener('canplay', () => reportVideoLifecycle('ready'));
					video.addEventListener('waiting', () => reportVideoLifecycle('loading', undefined, 'start'));
					video.addEventListener('stalled', () => reportVideoLifecycle('temporary'));
					video.addEventListener('suspend', () => reportVideoLifecycle('temporary'));
					video.addEventListener('abort', () => reportVideoLifecycle('failure', 'end', 'stop'));
					video.addEventListener('progress', () => reportVideoLifecycle('loading'));
					let videoReady = false;
					let upgrade: ReturnType<typeof beginHdrUpgrade>;
					let videoStarted = false;
					const startVideo = () => {
						if (videoStarted) return;
						videoStarted = true;
						video.preload = 'auto';
						video.load();
					};
					let playbackStarted = false;
					const tryPromote = () => {
						if (!videoReady || content !== lightbox?.pswp?.currSlide?.content || !upgrade || upgrade.settled) return;
						if (playbackStarted) return;
						playbackStarted = true;
						void video.play().then(() => upgrade.promote()).catch(() => upgrade.giveUp('video-playback'));
					};
					hdrVideoLoaders.set(content, startVideo);
					hdrVideoPromoters.set(content, tryPromote);
					if (content === lightbox?.pswp?.currSlide?.content) startVideo();
					video.addEventListener('loadeddata', () => {
						videoReady = true;
						reportVideoLifecycle('ready', 'end', 'stop');
						tryPromote();
					});
					video.addEventListener('canplay', () => {
						videoReady = true;
						tryPromote();
					});
					// See the AVIF path's identical comment above: server-side compose/encode can take
					// up to ~20s each for a real photo, and both HDR routes share one small concurrency
					// pool with the gallery's own background prewarm fetches -- a request queued behind
					// those can take another 20-40s before it even starts. 30s was giving up on
					// perfectly good, still-in-progress conversions.
					upgrade = beginHdrUpgrade({
						content,
						placeholder,
						real: video,
						timeoutMs: hdrClientTimeoutMs,
						refreshSpinner,
						// Only runs when the upgrade loses; frees the decoder for a video nothing will
						// ever show. beginHdrUpgrade reports the outcome before calling this, because
						// removeAttribute('src')/load() clear the MediaError that outcome reads.
						releaseReal: () => { video.pause(); video.removeAttribute('src'); video.load(); },
						onSettled: (outcome, reason) => {
							if (outcome === 'promoted') {
								promotedHdrMedia.set('video', content.data.src, video);
								if (!hdrVideos.includes(video)) hdrVideos.push(video);
								// Don't wait for the next 'change' -- a preloaded neighboring slide can
								// promote while a different slide is current, and its autoplay has
								// already started by the time loadeddata fired.
								syncHdrVideoPlayback();
								setHdrStatus(content, 'HDR video: playing');
								updateHdrIndicator();
								reportJournalDebug('hdr-media', { status: 'promoted', spinner: 'stop', photoSwipeType: 'video', srcKind: 'hdr-video' });
								return;
							}
							// The slide went away mid-load; that is not a media failure.
							if (reason === 'slide-destroyed') return;
							content.__hdrGaveUp = true;
							const code = video.error?.code;
							const detail = code !== undefined ? (mediaErrorLabel[code] ?? `code ${code}`) : 'timed out';
							setHdrStatus(content, `HDR video: failed to ${reason === 'video-playback' ? 'play' : 'load'} (${detail}), showing SDR photo [canPlayType ${canPlayDiagnostic}]`);
							updateHdrIndicator();
							reportJournalDebug('hdr-media', { status: 'given-up', hdrReason: reason === 'video-playback' ? 'video-playback' : 'video-load', spinner: 'stop', nativeErrorCode: code ?? null, photoSwipeType: 'video', srcKind: 'hdr-video' });
							reportJournalDebug('media-failure', { category: 'video', status: 'unavailable', errorContext: reason === 'video-playback' ? 'video-playback' : 'video-load', failureCategory: reason === 'video-playback' ? 'playback' : 'decode', nativeErrorCode: code ?? null });
							// The placeholder <img> is already the visible, correct content; nothing to swap.
						}
					});
					hdrContentDisposers.set(content, () => {
						hdrVideoLoaders.delete(content);
						hdrVideoPromoters.delete(content);
						if (!upgrade.settled) upgrade.giveUp('slide-destroyed');
						else if (content.__hdrPromoted) promotedHdrMedia.idle(video);
					});
					video.addEventListener('error', () => {
						if (upgrade.settled) return;
						const nativeErrorCode = video.error?.code ?? null;
						reportVideoLifecycle('failure', 'end', 'stop', nativeErrorCode);
						upgrade.giveUp('video-load');
					});
					if (video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
						videoReady = true;
						tryPromote();
					}
					};
					void checkHdrAvailability(content.data.src).then((availability) => {
						if (videoSlideGone) return;
						if (availability === 'none') showStandardPhoto(content, 'video', 'hdr-video');
						else startVideoUpgrade();
					});
				});
				// PhotoSwipe has dropped this slide (it keeps only a handful around the current one):
				// stop anything still loading for it and hand its promoted element back to the cache,
				// which releases the oldest ones nothing is showing.
				instance.on('contentDestroy', (event: any) => {
					const dispose = hdrContentDisposers.get(event.content);
					hdrContentDisposers.delete(event.content);
					dispose?.();
				});
				// The viewer has finished closing. PhotoSwipe clears its listeners before destroying
				// the slides it still holds, so no contentDestroy arrives for those.
				instance.on('destroy', () => {
					for (const dispose of hdrContentDisposers.values()) dispose();
					hdrContentDisposers.clear();
					promotedHdrMedia.clear();
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
					if (!modalHistory) { history.pushState({ immichPagesLightbox: true }, '', location.href); modalHistory = true; reportHistory('push'); }
					startHeartbeat();
					reportSlide('opened');
				});
				instance.on('afterInit', () => {
					hdrVideoLoaders.get(lightbox?.pswp?.currSlide?.content)?.();
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
					notifyActiveAsset();
					hdrVideoLoaders.get(lightbox?.pswp?.currSlide?.content)?.();
					setTimeout(() => {
						const openRoot = document.querySelector<HTMLElement>('.pswp--open');
						(openRoot?.querySelector<HTMLElement>('button[aria-label*="Close"], button[title*="Close"], .pswp__button') ?? openRoot)?.focus();
						announce();
						setTimeout(() => openRoot?.querySelector<HTMLElement>('.pswp__button--close, button[aria-label*="Close"], button[title*="Close"]')?.focus(), 0);
					}, 0);
				});
				instance.on('change', () => {
					announce();
					updateHdrIndicator();
					notifyActiveAsset();
					hdrVideoLoaders.get(lightbox?.pswp?.currSlide?.content)?.();
					hdrVideoPromoters.get(lightbox?.pswp?.currSlide?.content)?.();
					syncHdrVideoPlayback();
					reportSlide('changed');
				});
				instance.on('close', () => {
					const shouldGoBack = modalHistory && !closingFromPopstate;
					modalHistory = false;
					closingFromPopstate = false;
					pendingHistoryTraversal = shouldGoBack;
					document.body.style.overflow = previousOverflow;
					opener?.focus(); opener = null;
					activeViewer = undefined;
					for (const video of hdrVideos) video.pause();
					hdrVideos.length = 0;
					hdrVideoLoaders.clear();
					hdrVideoPromoters.clear();
					stopHeartbeat();
					reportSlide('closed');
					if (shouldGoBack) {
						reportHistory('back');
						clientDiagnostics.setExitCause('lightbox-close-back');
						history.back();
					}
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
			} catch (error) {
				ready = false;
				status = 'failed';
				clientDiagnostics.reportError('lightbox-init', error);
				const fallback = (pendingAnchor as HTMLAnchorElement | null)?.href;
				pendingAnchor = null;
				if (fallback) { clientDiagnostics.setExitCause('lightbox-fallback-assign'); location.assign(fallback); }
				reportJournalDebug('lightbox', { status: 'failure', errorContext: 'lightbox-load' });
			}
		})();
						return () => {
			destroyed = true; ready = false;
			stopHeartbeat();
			document.removeEventListener('click', onReadyClick, true);
			document.removeEventListener('keydown', onKeydown);
			window.removeEventListener('popstate', onPopstate, true);
			document.body.style.overflow = previousOverflow;
							lightbox?.destroy();
						promotedHdrMedia.clear();
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
	:global(.pswp[data-pswp-hdr-state="pending"] .pswp__button--zoom) { --pswp-icon-color: khaki; }
	:global(.pswp[data-pswp-hdr-state="loaded"] .pswp__button--zoom) { --pswp-icon-color: lightblue; }
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
