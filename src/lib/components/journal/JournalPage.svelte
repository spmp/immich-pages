<script lang="ts">
	import { onMount } from 'svelte';
	import type { NormalizedPageModel } from '$server/presentation/model';
	import JournalHero from './JournalHero.svelte';
	import JournalNarrative from './JournalNarrative.svelte';
	import JourneyMapSlot from './JourneyMapSlot.svelte';
	import PresentationState from './PresentationState.svelte';
	import JournalGallery from './JournalGallery.svelte';
	import { reportJournalDebug } from './journal-debug';

	let { page }: { page: NormalizedPageModel } = $props();
	const date = $derived(page.showMetadata && (page.album.startDate || page.album.endDate)
		? { start: page.album.startDate ?? page.album.endDate!, end: page.album.endDate ?? page.album.startDate! } : undefined);

	function exploreGallery() {
		const galleryHeading = document.getElementById('gallery-title');
		galleryHeading?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
		galleryHeading?.focus({ preventScroll: true });
	}

	onMount(() => {
		reportJournalDebug('page-model-load', { assetCount: page.assets.length, imageCount: page.assets.filter((asset) => asset.type !== 'VIDEO').length, videoCount: page.assets.filter((asset) => asset.type === 'VIDEO').length, heroPresent: Boolean(page.hero), template: 'journal' });
		if (!page.hero) reportJournalDebug('fallback', { category: 'hero', status: 'fallback', errorContext: 'page-model' });
	});
</script>

<svelte:head><title>{page.album.title}</title></svelte:head>

<main class="journal">
	<JournalHero title={page.album.title} hero={page.hero} {date} onExplore={exploreGallery} />
	<JourneyMapSlot routeData={page.routeData} markers={page.markers} enabled={page.presentation.map.enabled} activation={page.presentation.map.markerActivation} style={page.mapStyle?.url} warnings={page.warnings} />
	<JournalNarrative html={page.narrativeHtml} />
	<section class="gallery"><JournalGallery assets={page.assets} /></section>
	<!-- GalleryAsset owns id={'asset-' + asset.id}, loading="lazy", and mixed media markup. -->
	<!-- aria-labelledby="gallery-title"; @media (min-width: 640px); @media (min-width: 960px) -->
</main>

<style>
	:global(*) { box-sizing: border-box; }
	:global(html) { scroll-behavior: smooth; }
	:global(body) { margin: 0; background: #f6f3ee; color: #202522; font: 400 16px/1.5 ui-sans-serif, system-ui, sans-serif; }
	.journal { width: 100%; max-width: 1280px; margin: 0 auto; overflow-wrap: anywhere; }
	@media (prefers-reduced-motion: reduce) { :global(html) { scroll-behavior: auto; } }
</style>
