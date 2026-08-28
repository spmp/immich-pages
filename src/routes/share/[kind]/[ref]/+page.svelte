<script lang="ts">
	let { data } = $props();
	const page = $derived(data.outcome.page);
</script>

<svelte:head><title>{page.album.title}</title></svelte:head>

<main class="journal">
		<header class="hero">
			<div class="hero-copy"><p class="eyebrow">Journey gallery</p><h1>{page.album.title}</h1></div>
		</header>
		<div class="map-slot" aria-label="Journey map extension point"></div>
		<article class="narrative"><div class="prose">{@html page.narrativeHtml}</div></article>
		<section class="gallery" aria-labelledby="gallery-title">
			<h2 id="gallery-title">Gallery</h2>
			{#if page.assets.length === 0}<p>No photographs to show yet</p>{:else}
			<div class="gallery-grid">
				{#each page.assets as asset}
					<figure id={'asset-' + asset.id}><a href={asset.thumbnail}><img src={asset.thumbnail} alt={asset.caption ?? asset.fileName ?? 'Journey photograph'} loading="lazy" /></a>{#if asset.caption || asset.fileName}<figcaption>{asset.caption ?? asset.fileName}</figcaption>{/if}</figure>
				{/each}
			</div>{/if}
		</section>
</main>

<style>
	:global(*) { box-sizing: border-box; }
	:global(body) { margin: 0; background: #f6f3ee; color: #202522; font: 16px/1.5 ui-sans-serif, system-ui, sans-serif; }
	.journal { margin: 0 auto; max-width: 1280px; }
	.hero { min-height: 56svh; display: grid; align-items: end; padding: 48px 16px; color: #fffdf8; background: linear-gradient(transparent, #202522); }
	.hero-copy h1 { margin: 0; font: 400 clamp(36px, 6vw, 48px)/1.05 ui-serif, Georgia, serif; }
	.eyebrow { margin: 0 0 8px; font-size: 14px; font-weight: 600; }
	.map-slot { min-height: 0; }
	.narrative, .gallery { padding: 48px 16px; }
	.narrative { max-width: 720px; margin: 0 auto; }
	.prose :global(a) { color: inherit; text-decoration: underline; }
	.gallery h2 { font-size: 20px; }
	.gallery-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
	figure { margin: 0; overflow: hidden; background: #e7e1d8; }
	figure img { display: block; width: 100%; aspect-ratio: 1; object-fit: cover; }
	figcaption { padding: 4px 8px; font-size: 14px; }
	@media (min-width: 640px) { .hero, .narrative, .gallery { padding-left: 24px; padding-right: 24px; } .gallery-grid { gap: 16px; } figure img { object-fit: contain; } }
	@media (min-width: 960px) { .hero, .gallery { padding-left: 32px; padding-right: 32px; } .gallery-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
	@media (min-width: 1200px) { .hero, .gallery { padding-left: 48px; padding-right: 48px; } }
</style>
