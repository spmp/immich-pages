<script lang="ts">
	let { data } = $props();
	const page = $derived(data.outcome.page);
</script>

<svelte:head><title>{page.album.title}</title></svelte:head>

<main>
	<h1>{page.album.title}</h1>
	<p>{page.album.description}</p>
	<section aria-label="Album assets">
		{#each page.assets as asset}
			<figure><img src={asset.thumbnail} alt={asset.fileName ?? ''} /><figcaption>{asset.fileName}</figcaption></figure>
		{/each}
	</section>
</main>
