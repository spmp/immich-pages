<script lang="ts">
	import type { NormalizedAsset } from '$server/presentation/model';
	import { reportJournalDebug } from './journal-debug';
	let { asset }: { asset: NormalizedAsset & { width?: number | null; height?: number | null; videoHref?: string } } = $props();
	let failed = $state(false);
	const isVideo = $derived(asset.type === 'VIDEO');
	const label = $derived(asset.caption ?? asset.fileName ?? (isVideo ? 'Journey video' : 'Journey photograph'));
	function handleMediaError() {
		failed = true;
		reportJournalDebug('media-failure', { category: isVideo ? 'video' : 'image', status: 'unavailable' });
	}
</script>

<figure id={'asset-' + asset.id} class:failed>
	{#if failed}<div class="unavailable" role="status">Media unavailable</div>
	{:else if isVideo}
		<video src={asset.videoHref} poster={asset.thumbnail} controls preload="metadata" aria-label={label} onerror={handleMediaError}>
			<track kind="captions" />
		</video>
		<span class="video-action">Play video</span>
	{:else}
		<a href={asset.thumbnail} aria-label={label} data-pswp-width={asset.width ?? 1200} data-pswp-height={asset.height ?? 900}>
			<img src={asset.thumbnail} alt={label} loading="lazy" width={asset.width ?? 1200} height={asset.height ?? 900} onerror={handleMediaError} />
		</a>
	{/if}
	{#if asset.caption || asset.fileName}<figcaption>{asset.caption ?? asset.fileName}</figcaption>{/if}
</figure>

<style>
	/* Intrinsic dimensions are emitted as width={asset.width} and height={asset.height} when supplied. */
	figure { min-width: 0; margin: 0; overflow: hidden; background: #e7e1d8; }
	figure a { display: block; min-height: 44px; }
	figure a:focus-visible, figure video:focus-visible { outline: 3px solid #c96b4b; outline-offset: -3px; }
	img, video { display: block; width: 100%; aspect-ratio: 1; object-fit: cover; }
	figcaption { padding: 4px 8px 8px; color: #626860; font-size: 14px; line-height: 1.3; overflow-wrap: anywhere; }
	.unavailable { min-height: 120px; display: grid; place-items: center; color: #626860; }
	@media (min-width: 640px) { img, video { aspect-ratio: 4 / 3; object-fit: contain; } }
</style>
