<script lang="ts">
	import { onMount } from 'svelte';
	import type { NormalizedPageModel } from '$server/presentation/model';
	import JournalHero from './JournalHero.svelte';
	import JournalNarrative from './JournalNarrative.svelte';
	import JourneyMapSlot from './JourneyMapSlot.svelte';
	import PresentationState from './PresentationState.svelte';
	import JournalGallery from './JournalGallery.svelte';
	import { reportJournalDebug } from './journal-debug';
	import PageNavigation from '$lib/components/navigation/PageNavigation.svelte';
	import MobileDrawer from '$lib/components/navigation/MobileDrawer.svelte';
	import type { NavigationEntry } from '$server/library/model';
	import '$lib/styles/theme.css';
	import ThemeRoot from './ThemeRoot.svelte';
	import ThemeExplorer from '$lib/theme/ThemeExplorer.svelte';
	import { createThemeState } from '$lib/theme/state.svelte';

	let { page, navigation }: { page: NormalizedPageModel; navigation?: { entries: NavigationEntry[]; activeHref?: string } } = $props();
	const theme = createThemeState();
	const date = $derived(page.showMetadata && (page.album.startDate || page.album.endDate)
		? { start: page.album.startDate ?? page.album.endDate!, end: page.album.endDate ?? page.album.startDate! } : undefined);

	function exploreGallery() {
		const galleryHeading = document.getElementById('gallery-title');
		galleryHeading?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
		galleryHeading?.focus({ preventScroll: true });
	}

	onMount(() => {
		theme.hydrate();
		reportJournalDebug('page-model-load', { assetCount: page.assets.length, imageCount: page.assets.filter((asset) => asset.type !== 'VIDEO').length, videoCount: page.assets.filter((asset) => asset.type === 'VIDEO').length, heroPresent: Boolean(page.hero), template: 'journal' });
		if (!page.hero) reportJournalDebug('fallback', { category: 'hero', status: 'fallback', errorContext: 'page-model' });
	});
</script>

<svelte:head><title>{page.album.title}</title></svelte:head>

	<ThemeRoot themeKey={theme.selectedKey}>
		<ThemeExplorer {theme} />
		{#if navigation}<div class="mobile-navigation"><MobileDrawer entries={navigation.entries} activeHref={navigation.activeHref} /></div>{/if}
		<div class:navigated={navigation} class="journal-layout">
			{#if navigation}<PageNavigation entries={navigation.entries} activeHref={navigation.activeHref} />{/if}
			<main class="journal">
	<JournalHero title={page.album.title} hero={page.hero} {date} onExplore={exploreGallery} />
	<JourneyMapSlot routeData={page.routeData} markers={page.markers} enabled={page.presentation.map.enabled} activation={page.presentation.map.markerActivation} showMarkerList={page.presentation.map.showMarkerList} clustering={page.presentation.map.clustering} clusterRadius={page.presentation.map.clusterRadius} markerColor={page.presentation.map.markerColor} routeColor={page.presentation.map.routeColor} routeWidth={page.presentation.map.routeWidth} routeStartColor={page.presentation.map.routeStartColor} routeEndColor={page.presentation.map.routeEndColor} style={page.mapStyle?.url} warnings={page.warnings} />
	<JournalNarrative html={page.narrativeHtml} />
	<section class="gallery"><JournalGallery assets={page.assets} /></section>
	<!-- GalleryAsset owns id={'asset-' + asset.id}, loading="lazy", and mixed media markup. -->
		<!-- aria-labelledby="gallery-title"; @media (min-width: 640px); @media (min-width: 960px) -->
			</main>
		</div>
	</ThemeRoot>

<style>
	:global(*) { box-sizing: border-box; }
	:global(html) { scroll-behavior: smooth; }
	:global(body) { margin: 0; background: var(--theme-bg); color: var(--theme-text); font: 400 16px/1.5 var(--theme-font-body); }
	.journal { width: 100%; max-width: var(--theme-content-width); margin: 0 auto; overflow-wrap: anywhere; }
	.journal-layout { display: flex; align-items: stretch; min-height: 100svh; }
	.journal-layout.navigated .journal { max-width: none; }
	.mobile-navigation { display: none; position: fixed; z-index: 10; top: 16px; right: 16px; }
	@media (max-width: 959px) { .mobile-navigation { display: block; } .journal-layout { display: block; } }
	@media (prefers-reduced-motion: reduce) { :global(html) { scroll-behavior: auto; } }
</style>
