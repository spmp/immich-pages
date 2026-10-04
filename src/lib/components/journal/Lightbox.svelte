<script lang="ts">
	import { onMount } from 'svelte';
	import 'photoswipe/style.css';
	import { reportJournalDebug } from './journal-debug';
	let { galleryId }: { galleryId: string } = $props();
	let status = $state<'loading' | 'ready' | 'failed'>('loading');

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
							reportJournalDebug('media-failure', { category: 'image', status: 'unavailable', errorContext: 'image-load', failureCategory: 'decode' });
							// The placeholder <img> is already the visible, correct content; nothing to swap.
						};
						const promote = () => {
							if (settled) return;
							settled = true;
							finish();
							placeholder.remove();
							content.element = real;
							content.slide?.container.appendChild(real);
						};
						real.addEventListener('error', giveUp);
						real.addEventListener('load', promote, { once: true });
						hdrTimeout = window.setTimeout(giveUp, 30_000);
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

					const video = document.createElement('video');
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
					const giveUp = (errorContext: 'video-load' | 'video-playback') => {
						if (settled) return;
						settled = true;
						if (hdrTimeout !== undefined) window.clearTimeout(hdrTimeout);
						video.pause();
						video.removeAttribute('src');
						video.load();
						reportJournalDebug('media-failure', { category: 'video', status: 'unavailable', errorContext, failureCategory: errorContext === 'video-playback' ? 'playback' : 'decode' });
						// The placeholder <img> is already the visible, correct content; nothing to swap.
					};
					const promote = () => {
						if (settled || content.type !== 'video') return;
						settled = true;
						if (hdrTimeout !== undefined) window.clearTimeout(hdrTimeout);
						// content.load()/content.append() are one-shot (guarded by content.isAttached,
						// already set true when the placeholder was attached) and will not re-run content
						// creation for an already-attached slide; PhotoSwipe's own Content.append() does
						// exactly this direct DOM insertion for non-image content, so do the same here.
						placeholder.remove();
						content.element = video;
						content.slide?.container.appendChild(video);
					};
					video.addEventListener('error', () => giveUp('video-load'));
					hdrTimeout = window.setTimeout(() => giveUp('video-load'), 30_000);
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
					setTimeout(() => {
						const openRoot = document.querySelector<HTMLElement>('.pswp--open');
						(openRoot?.querySelector<HTMLElement>('button[aria-label*="Close"], button[title*="Close"], .pswp__button') ?? openRoot)?.focus();
						announce();
						setTimeout(() => openRoot?.querySelector<HTMLElement>('.pswp__button--close, button[aria-label*="Close"], button[title*="Close"]')?.focus(), 0);
					}, 0);
				});
				instance.on('change', announce);
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
</style>
