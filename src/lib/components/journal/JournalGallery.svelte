<script lang="ts">
	import type { NormalizedAsset } from '$server/presentation/model';
	import GalleryAsset from './GalleryAsset.svelte';
	import Lightbox from './Lightbox.svelte';
	import { onMount } from 'svelte';
	import { reportJournalDebug } from './journal-debug';
	import { calculateJustifiedRows } from './justified-layout';
	import { supportsHdrDisplay, supportsWideColorGamut } from '$lib/media/capabilities';
	let { assets, shareKind, shareRef, fullWidth = [] }: { assets: NormalizedAsset[]; shareKind?: string; shareRef?: string; fullWidth?: string[] } = $props();
	const enriched = $derived(assets.map((asset) => {
		const videoHref = asset.videoHref ?? (asset.type === 'VIDEO' && shareKind && shareRef ? `/share/${shareKind}/${encodeURIComponent(shareRef)}/media/${encodeURIComponent(asset.id)}/video/playback` : undefined);
		return { ...asset, fullWidth: asset.fullWidth || fullWidth.includes(asset.id), videoHref };
	}));
	let galleryElement = $state<HTMLElement | undefined>(undefined);
	let availableWidth = $state(960);
	let layoutMeasured = $state(false);
	const rows = $derived(calculateJustifiedRows(enriched, availableWidth));
	$effect(() => {
		if (!galleryElement) return;
		const update = () => { availableWidth = Math.max(1, galleryElement?.clientWidth ?? 960); layoutMeasured = true; };
		update();
		if (typeof ResizeObserver === 'undefined') return;
		const observer = new ResizeObserver(update);
		observer.observe(galleryElement);
		return () => observer.disconnect();
	});
	onMount(() => reportJournalDebug('gallery-state', { category: 'gallery', status: enriched.length === 0 ? 'empty' : 'success', assetCount: enriched.length, imageCount: enriched.filter((asset) => asset.type !== 'VIDEO').length, videoCount: enriched.filter((asset) => asset.type === 'VIDEO').length, ...(enriched.length === 0 ? { errorContext: 'gallery-load' as const } : {}) }));
	onMount(() => {
		if (!supportsHdrDisplay() || !supportsWideColorGamut()) return;
		const controllers = new Set<AbortController>();
		const completed = new Set<string>();
		let stopped = false;
		let running = 0;
		let queue: string[] = [];
		const maxRequests = 24;
		const maxConcurrent = 2;
		const schedule = () => {
			if (stopped || document.visibilityState !== 'visible') return;
			const candidates = Array.from(document.querySelectorAll<HTMLElement>('[data-hdr-prewarm]'))
				.map((element) => ({ element, url: element.dataset.hdrPrewarm }))
				.filter((item): item is { element: HTMLElement; url: string } => Boolean(item.url && !completed.has(item.url)))
				.sort((a, b) => Math.abs(a.element.getBoundingClientRect().top) - Math.abs(b.element.getBoundingClientRect().top));
			queue = candidates.slice(0, maxRequests).map((item) => item.url);
			pump();
		};
		const pump = () => {
			while (!stopped && document.visibilityState === 'visible' && running < maxConcurrent && queue.length) {
				const url = queue.shift()!;
				if (completed.has(url)) continue;
				completed.add(url);
				running += 1;
				const controller = new AbortController();
				controllers.add(controller);
				void fetch(url, { credentials: 'same-origin', signal: controller.signal, headers: { accept: 'video/mp4' } })
					.then((response) => response.ok ? response.arrayBuffer() : undefined)
					.catch(() => undefined)
					.finally(() => { controllers.delete(controller); running -= 1; pump(); });
			}
		};
		const onVisibilityChange = () => {
			if (document.visibilityState === 'hidden') {
				for (const controller of controllers) controller.abort();
				queue = [];
			} else schedule();
		};
		document.addEventListener('visibilitychange', onVisibilityChange);
		const idleWindow = window as Window & { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number; cancelIdleCallback?: (handle: number) => void };
		const usedIdleCallback = Boolean(idleWindow.requestIdleCallback);
		const idle = usedIdleCallback ? idleWindow.requestIdleCallback!(schedule, { timeout: 250 }) : window.setTimeout(schedule, 0);
		return () => {
			stopped = true;
			document.removeEventListener('visibilitychange', onVisibilityChange);
			for (const controller of controllers) controller.abort();
			if (usedIdleCallback && idleWindow.cancelIdleCallback) idleWindow.cancelIdleCallback(idle);
			else window.clearTimeout(idle);
		};
	});
</script>

	<section class="gallery" aria-label="Gallery">
	{#if enriched.length === 0}<p>No photographs to show yet</p>{:else}<Lightbox galleryId="journal-gallery" /><div id="journal-gallery" class="gallery-grid" bind:this={galleryElement}>{#each rows as row, rowIndex (rowIndex)}<div class:full-width-row={row.fullWidth} class="justified-row" style={`height: ${row.height}px`}>{#each row.items as asset (asset.id)}<GalleryAsset {asset} layoutWidth={asset.layoutWidth} layoutHeight={asset.layoutHeight} {layoutMeasured} />{/each}</div>{/each}</div>{/if}
</section>

<style>
	.gallery { padding: var(--theme-space-section) 16px 64px; color: var(--theme-text); }
	.gallery-grid { display: block; }
	.justified-row { display: flex; align-items: stretch; gap: var(--theme-space-gap); margin-bottom: var(--theme-space-section); overflow: hidden; }
	.justified-row :global(figure) { flex: 0 0 auto; }
	.full-width-row { display: block; }
	.full-width-row :global(figure) { width: 100% !important; }
	@media (min-width: 640px) { .gallery { padding-left: 24px; padding-right: 24px; } }
	@media (min-width: 960px) { .gallery { padding-left: 32px; padding-right: 32px; } }
	@media (min-width: 1200px) { .gallery { padding-left: 48px; padding-right: 48px; } }
</style>
