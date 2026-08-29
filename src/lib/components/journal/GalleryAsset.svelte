<script lang="ts">
	import type { NormalizedAsset } from '$server/presentation/model';
	import { reportJournalDebug } from './journal-debug';
	let { asset }: { asset: NormalizedAsset & { width?: number | null; height?: number | null; videoHref?: string } } = $props();
	let failed = $state(false);
	const isVideo = $derived(asset.type === 'VIDEO');
	const label = $derived(asset.caption ?? asset.fileName ?? (isVideo ? 'Journey video' : 'Journey photograph'));
	const orientation = $derived(getPresentationOrientation(asset.width, asset.height));
	const dimensions = $derived(getLightboxDimensions(asset.width, asset.height));
	const lightboxWidth = $derived(dimensions.width);
	const lightboxHeight = $derived(dimensions.height);

	function getLightboxDimensions(width: number | null | undefined, height: number | null | undefined) {
		const validWidth = Number.isFinite(width) && (width as number) > 0 ? Math.round(width as number) : null;
		const validHeight = Number.isFinite(height) && (height as number) > 0 ? Math.round(height as number) : null;
		if (validWidth && validHeight) {
			const boundedWidth = Math.min(validWidth, 8192);
			const boundedHeight = Math.min(validHeight, 8192);
			const ratio = boundedWidth / boundedHeight;
			if (ratio >= 0.25 && ratio <= 4) return { width: boundedWidth, height: boundedHeight };
		}
		if (validWidth) {
			const boundedWidth = Math.min(validWidth, 8192);
			const boundedHeight = Math.min(8192, Math.max(1, Math.round(boundedWidth / 1.7777778)));
			const ratio = boundedWidth / boundedHeight;
			if (ratio >= 0.25 && ratio <= 4) return { width: boundedWidth, height: boundedHeight };
		}
		if (validHeight) {
			const boundedHeight = Math.min(validHeight, 8192);
			const boundedWidth = Math.min(8192, Math.max(1, Math.round(boundedHeight * 1.7777778)));
			const ratio = boundedWidth / boundedHeight;
			if (ratio >= 0.25 && ratio <= 4) return { width: boundedWidth, height: boundedHeight };
		}
		return { width: 1600, height: 900 };
	}
	function getPresentationOrientation(width: number | null | undefined, height: number | null | undefined) {
		if (Number.isFinite(width) && Number.isFinite(height) && (width as number) > 0 && (height as number) > 0) {
			return (height as number) > (width as number) ? 'portrait' : 'landscape';
		}
		return 'landscape';
	}
	function handleMediaError() {
		failed = true;
		reportJournalDebug('media-failure', { category: isVideo ? 'video' : 'image', status: 'unavailable', errorContext: isVideo ? 'video-load' : 'image-load' });
	}
	function handleMediaLoad() {
		reportJournalDebug('media-load', { category: isVideo ? 'video' : 'image', status: 'success' });
	}
</script>

	<figure id={'asset-' + asset.id} class:failed class:portrait={orientation === 'portrait'} class:landscape={orientation === 'landscape'}>
	{#if failed}<div class="unavailable" role="status">Media unavailable</div>
	{:else if isVideo}
		<div class="gallery-media-frame">
			<video src={asset.videoHref} poster={asset.thumbnail} controls preload="metadata" aria-label={label} onloadstart={handleMediaLoad} onerror={handleMediaError}>
				<track kind="captions" />
			</video>
		</div>
		<span class="video-action">Play video</span>
	{:else}
		<div class="gallery-media-frame">
			<a href={asset.thumbnail} aria-label={label} data-pswp-width={lightboxWidth} data-pswp-height={lightboxHeight}>
				<img src={asset.thumbnail} alt={label} loading="lazy" width={lightboxWidth} height={lightboxHeight} onload={handleMediaLoad} onerror={handleMediaError} />
			</a>
		</div>
	{/if}
	{#if asset.caption || asset.fileName}<figcaption>{asset.caption ?? asset.fileName}</figcaption>{/if}
</figure>

<style>
	/* Intrinsic dimensions are emitted as width={asset.width} and height={asset.height} when supplied. */
	figure { min-width: 0; margin: 0; overflow: hidden; background: #e7e1d8; }
	.gallery-media-frame { width: 100%; height: auto; aspect-ratio: 1; min-width: 0; overflow: hidden; }
	figure a { display: block; height: 100%; min-height: 44px; }
	figure a:focus-visible, figure video:focus-visible { outline: 3px solid #c96b4b; outline-offset: -3px; }
	img, video { display: block; width: 100%; height: 100%; aspect-ratio: auto; object-fit: cover; }
	figcaption { padding: 4px 8px 8px; color: #626860; font-size: 14px; line-height: 1.3; overflow-wrap: anywhere; }
	.unavailable { min-height: 120px; display: grid; place-items: center; color: #626860; }
	@media (min-width: 640px) {
		.gallery-media-frame { aspect-ratio: 4 / 3; }
		figure.portrait .gallery-media-frame { aspect-ratio: 2 / 3; }
		img, video { object-fit: contain; }
	}
</style>
