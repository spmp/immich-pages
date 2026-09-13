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
			if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
			else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
		};
		const onPopstate = () => {
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
					return element?.dataset.pswpType === 'video'
						? { ...itemData, type: 'video', src: element.dataset.videoSrc, poster: element.dataset.videoPoster }
						: itemData;
				});
				instance.on('contentLoad', (event: any) => {
					const { content } = event;
					if (content.type !== 'video') return;
					event.preventDefault();
					const video = document.createElement('video');
					video.src = content.data.src;
					video.poster = content.data.poster;
					video.controls = true;
					video.playsInline = true;
					video.preload = 'metadata';
					video.className = 'pswp__video';
					video.setAttribute('aria-label', content.data.element?.getAttribute('aria-label') ?? 'Journey video');
					const track = document.createElement('track');
					track.kind = 'captions';
					video.appendChild(track);
					content.element = video;
				});
				instance.on('beforeOpen', (event: any) => {
					activeViewer = event.pswp;
					opener = document.activeElement as HTMLElement;
					document.body.style.overflow = 'hidden';
					if (!modalHistory) { history.pushState({ immichPagesLightbox: true }, '', location.href); modalHistory = true; }
					reportJournalDebug('lightbox', { status: 'opened' });
				});
				instance.on('openingAnimationEnd', () => {
					const root = document.querySelector<HTMLElement>('.pswp');
					root?.setAttribute('data-pswp-modal', 'true');
					setTimeout(() => {
						const openRoot = document.querySelector<HTMLElement>('.pswp--open');
						(openRoot?.querySelector<HTMLElement>('button[aria-label*="Close"], button[title*="Close"], .pswp__button') ?? openRoot)?.focus();
						announce();
					}, 0);
				});
				instance.on('change', announce);
				instance.on('close', () => {
					const shouldGoBack = modalHistory && !closingFromPopstate;
					modalHistory = false;
					closingFromPopstate = false;
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
	:global(.pswp), :global(.pswp__bg) { --pswp-bg: var(--theme-overlay, #000); --pswp-bg-opacity: 1; background-color: var(--theme-overlay, #000); opacity: 1; }
	:global(.pswp__video) { display: block; max-width: 100%; max-height: 100%; width: auto; height: auto; object-fit: contain; }
</style>
