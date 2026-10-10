<script lang="ts">
	import type { NormalizedAsset } from '$server/presentation/model';
	import GalleryAsset from './GalleryAsset.svelte';
	import Lightbox from './Lightbox.svelte';
	import { onMount } from 'svelte';
	import { reportJournalDebug } from './journal-debug';
	import { calculateJustifiedRows } from './justified-layout';
	import { preferredHdrRepresentation } from '$lib/media/capabilities';
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
		const representation = preferredHdrRepresentation();
		if (!representation || !shareKind || !shareRef || enriched.length === 0) return;
		let stopped = false;
		let controller: AbortController | undefined;
		let lastAnnouncement = '';
		const first = enriched.findIndex((asset) => Boolean(representation === 'avif' ? asset.hdrAvifHref : asset.hdrHref));
		const announce = (activeAssetId: string, activePosition: number) => {
			if (stopped || document.visibilityState !== 'visible' || !Number.isSafeInteger(activePosition) || activePosition < 0) return;
			const key = `${activeAssetId}:${activePosition}:${representation}`;
			if (key === lastAnnouncement) return;
			lastAnnouncement = key;
			controller?.abort();
			controller = new AbortController();
			void fetch(`/share/${encodeURIComponent(shareKind)}/${encodeURIComponent(shareRef)}/prewarm`, {
				method: 'POST', credentials: 'same-origin', signal: controller.signal,
				headers: { 'content-type': 'application/json', 'x-hdr-representation': representation },
				body: JSON.stringify({ activeAssetId, activePosition })
			}).catch(() => { /* optional control-plane failure preserves SDR */ });
		};
		if (first >= 0) announce(enriched[first].id, first);
		const onActiveAsset = (event: Event) => {
			const detail = (event as CustomEvent<{ activeAssetId?: string; activePosition?: number }>).detail;
			if (detail?.activeAssetId && Number.isSafeInteger(detail.activePosition)) announce(detail.activeAssetId, detail.activePosition as number);
		};
		document.addEventListener('pages:active-asset', onActiveAsset);
		const onVisibilityChange = () => { if (document.visibilityState === 'visible' && first >= 0) announce(enriched[first].id, first); };
		document.addEventListener('visibilitychange', onVisibilityChange);
		return () => {
			stopped = true;
			controller?.abort();
			document.removeEventListener('pages:active-asset', onActiveAsset);
			document.removeEventListener('visibilitychange', onVisibilityChange);
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
