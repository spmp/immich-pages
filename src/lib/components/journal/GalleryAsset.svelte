	<script lang="ts">
	import { resolve } from '$app/paths';
	import type { NormalizedAsset } from '$server/presentation/model';
	import { reportJournalDebug } from './journal-debug';
	let { asset, layoutWidth, layoutHeight }: { asset: NormalizedAsset & { width?: number | null; height?: number | null; videoHref?: string; fullWidth?: boolean }; layoutWidth?: number; layoutHeight?: number } = $props();
	let failed = $state(false);
	let naturalWidth = $state(0);
	let naturalHeight = $state(0);
	const isVideo = $derived(asset.type === 'VIDEO');
	const label = $derived(asset.caption ?? (isVideo ? 'Journey video' : 'Journey photograph'));
	const width = $derived(getPreferredDimension(asset.width, naturalWidth));
	const height = $derived(getPreferredDimension(asset.height, naturalHeight));
	const orientation = $derived(getPresentationOrientation(width, height));
	const dimensions = $derived(getLightboxDimensions(width, height));
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
	function getPreferredDimension(provided: number | null | undefined, natural: number) {
		if (Number.isFinite(provided) && (provided as number) > 0) return provided;
		return Number.isFinite(natural) && natural > 0 ? natural : null;
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

	<figure id={'asset-' + asset.id} tabindex="-1" style={layoutWidth && layoutHeight ? `width: ${layoutWidth}px; height: ${layoutHeight}px` : undefined} class:failed class:full-width={asset.fullWidth} class:portrait={orientation === 'portrait'} class:landscape={orientation === 'landscape'}>
	{#if failed}<div class="unavailable" role="status">Media unavailable</div>
	{:else if isVideo}
		<div class="gallery-media-frame">
			<a href={resolve((asset.videoHref ?? asset.thumbnail) as any)} aria-label={label} data-media-source="thumbnail" data-lightbox-fallback="native-anchor" data-pswp-type="video" data-video-src={asset.videoHref} data-video-poster={asset.thumbnail} data-pswp-width={lightboxWidth} data-pswp-height={lightboxHeight}>
				<video src={asset.videoHref} poster={asset.thumbnail} controls playsinline preload="metadata" aria-label={label} onloadstart={handleMediaLoad} onerror={handleMediaError}><track kind="captions" /></video>
			</a>
		</div>
	{:else}
		<div class="gallery-media-frame">
			<a href={resolve(asset.thumbnail as any)} aria-label={label} data-media-source="thumbnail" data-lightbox-fallback="native-anchor" data-pswp-width={lightboxWidth} data-pswp-height={lightboxHeight}>
				<img src={asset.thumbnail} alt={label} loading="lazy" width={lightboxWidth} height={lightboxHeight} bind:naturalWidth bind:naturalHeight onload={handleMediaLoad} onerror={handleMediaError} />
			</a>
		</div>
	{/if}
	{#if asset.caption}<figcaption>{asset.caption}</figcaption>{/if}
</figure>

<style>
	/* Intrinsic dimensions are emitted as width={asset.width} and height={asset.height} when supplied. */
	figure { min-width: 0; margin: 0; overflow: hidden; background: transparent; }
	figure:focus-visible { outline: 3px solid var(--theme-accent); outline-offset: 4px; }
	:global(figure.map-focus-highlight) { animation: map-focus-highlight 2.2s ease-out; }
	@keyframes map-focus-highlight { 0%, 65% { box-shadow: 0 0 0 5px var(--theme-accent); } 100% { box-shadow: 0 0 0 0 transparent; } }
	.gallery-media-frame { width: 100%; height: auto; min-width: 0; overflow: hidden; }
	figure a { display: block; min-height: 44px; }
	figure a:focus-visible, figure video:focus-visible { outline: 3px solid var(--theme-accent); outline-offset: -3px; }
	img, video { display: block; width: 100%; height: 100%; aspect-ratio: auto; object-fit: contain; }
	figcaption { padding: 4px 8px 8px; color: var(--theme-muted); font-size: 14px; line-height: 1.3; overflow-wrap: anywhere; }
	.unavailable { min-height: 120px; display: grid; place-items: center; color: var(--theme-muted); }
	@media (min-width: 960px) { figure.full-width .gallery-media-frame { max-width: 100%; } }
</style>
