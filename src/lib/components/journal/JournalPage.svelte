<script lang="ts">
	import type { NormalizedPageModel } from '$server/presentation/model';
	import JournalHero from './JournalHero.svelte';
	import JournalNarrative from './JournalNarrative.svelte';
	import JourneyMapSlot from './JourneyMapSlot.svelte';

	let { page, onState }: { page: NormalizedPageModel; onState?: () => void } = $props();
	let galleryHeading = $state<HTMLElement | null>(null);
	const date = $derived(page.showMetadata && (page.album.startDate || page.album.endDate)
		? { start: page.album.startDate ?? page.album.endDate!, end: page.album.endDate ?? page.album.startDate! } : undefined);

	function exploreGallery() {
		galleryHeading?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
		galleryHeading?.focus({ preventScroll: true });
	}
</script>

<svelte:head><title>{page.album.title}</title></svelte:head>

<main class="journal">
	<JournalHero title={page.album.title} hero={page.hero} {date} onExplore={exploreGallery} />
	<JourneyMapSlot routeData={page.routeData} markers={page.markers} />
	<JournalNarrative html={page.narrativeHtml} />
	<section class="gallery" aria-labelledby="gallery-title">
		<div class="section-heading">
			<span class="rule" aria-hidden="true"></span>
			<h2 id="gallery-title" bind:this={galleryHeading} tabindex="-1">Gallery</h2>
		</div>
		{#if page.assets.length === 0}
			<p class="quiet">No photographs to show yet</p>
		{:else}
			<div class="gallery-grid">
				{#each page.assets as asset}
					<figure id={'asset-' + asset.id}>
						<a href={asset.thumbnail} aria-label={asset.caption ?? asset.fileName ?? 'Journey photograph'}>
							<img src={asset.thumbnail} alt={asset.caption ?? asset.fileName ?? 'Journey photograph'} loading="lazy" width="1200" height="900" />
						</a>
						{#if asset.caption || asset.fileName}<figcaption>{asset.caption ?? asset.fileName}</figcaption>{/if}
					</figure>
				{/each}
			</div>
		{/if}
	</section>
</main>

<style>
	:global(*) { box-sizing: border-box; }
	:global(html) { scroll-behavior: smooth; }
	:global(body) { margin: 0; background: #f6f3ee; color: #202522; font: 400 16px/1.5 ui-sans-serif, system-ui, sans-serif; }
	.journal { width: 100%; max-width: 1280px; margin: 0 auto; overflow-wrap: anywhere; }
	.gallery { padding: 48px 16px 64px; }
	.section-heading { display: flex; align-items: center; gap: 8px; margin-bottom: 24px; }
	.rule { width: 32px; height: 4px; background: #c96b4b; }
	h2 { margin: 0; font: 600 20px/1.2 ui-serif, Georgia, serif; }
	.gallery h2:focus-visible { outline: 3px solid #c96b4b; outline-offset: 4px; }
	.quiet { color: #626860; }
	.gallery-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
	figure { min-width: 0; margin: 0; overflow: hidden; background: #e7e1d8; }
	figure a { display: block; min-height: 44px; }
	figure a:focus-visible { outline: 3px solid #c96b4b; outline-offset: -3px; }
	figure img { display: block; width: 100%; aspect-ratio: 1; object-fit: cover; }
	figcaption { padding: 4px 8px 8px; color: #626860; font-size: 14px; line-height: 1.3; overflow-wrap: anywhere; }
	@media (min-width: 640px) { .gallery { padding: 48px 24px 64px; } .gallery-grid { gap: 16px; } figure img { aspect-ratio: 4 / 3; object-fit: contain; } }
	@media (min-width: 960px) { .gallery { padding-left: 32px; padding-right: 32px; } .gallery-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
	@media (min-width: 1200px) { .gallery { padding-left: 48px; padding-right: 48px; } }
	@media (prefers-reduced-motion: reduce) { :global(html) { scroll-behavior: auto; } }
</style>
