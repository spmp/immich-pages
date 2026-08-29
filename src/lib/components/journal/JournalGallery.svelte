<script lang="ts">
	import type { NormalizedAsset } from '$server/presentation/model';
	import GalleryAsset from './GalleryAsset.svelte';
	import Lightbox from './Lightbox.svelte';
	import { onMount } from 'svelte';
	import { reportJournalDebug } from './journal-debug';
	let { assets, shareKind, shareRef }: { assets: NormalizedAsset[]; shareKind?: string; shareRef?: string } = $props();
	const enriched = $derived(assets.map((asset) => ({ ...asset, videoHref: asset.videoHref ?? (asset.type === 'VIDEO' && shareKind && shareRef ? `/share/${shareKind}/${encodeURIComponent(shareRef)}/media/${encodeURIComponent(asset.id)}/video/playback` : undefined) })));
	onMount(() => reportJournalDebug('gallery-state', { category: 'gallery', status: enriched.length === 0 ? 'empty' : 'success', assetCount: enriched.length }));
</script>

<section class="gallery" aria-labelledby="gallery-title">
		<div class="section-heading"><span class="rule" aria-hidden="true"></span><h2 id="gallery-title" tabindex="-1">Gallery</h2></div>
		{#if enriched.length === 0}<p>No photographs to show yet</p>{:else}<Lightbox galleryId="journal-gallery" /><div id="journal-gallery" class="gallery-grid">{#each enriched as asset}<GalleryAsset {asset} />{/each}</div>{/if}
</section>

<style>
	.gallery { padding: 48px 16px 64px; }
	.section-heading { display: flex; align-items: center; gap: 8px; margin-bottom: 24px; }
	.rule { width: 32px; height: 4px; background: #c96b4b; }
	h2 { margin: 0; font: 600 20px/1.2 ui-serif, Georgia, serif; }
	h2:focus-visible { outline: 3px solid #c96b4b; outline-offset: 4px; }
	.gallery-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
	@media (min-width: 640px) { .gallery { padding-left: 24px; padding-right: 24px; } .gallery-grid { gap: 16px; } }
	@media (min-width: 960px) { .gallery { padding-left: 32px; padding-right: 32px; } .gallery-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
	@media (min-width: 1200px) { .gallery { padding-left: 48px; padding-right: 48px; } }
</style>
