	<script lang="ts">
	import { resolve } from '$app/paths';
	import type { NormalizedAsset } from '$server/presentation/model';
	import { onMount } from 'svelte';
	import { chooseResolution, requiredWidth } from '$lib/media/resolution';
	import { probeImageDecode, supportsHdrDisplay, supportsWideColorGamut } from '$lib/media/capabilities';
	import { journalDebugEnabled, reportJournalDebug } from './journal-debug';
	let { asset, layoutWidth, layoutHeight, layoutMeasured = false }: { asset: NormalizedAsset & { width?: number | null; height?: number | null; videoHref?: string; fullWidth?: boolean }; layoutWidth?: number; layoutHeight?: number; layoutMeasured?: boolean } = $props();
	let failed = $state(false);
	let naturalWidth = $state(0);
	let naturalHeight = $state(0);
	let thumbnailIntrinsicWidth = $state<number | null>(null);
	let measured = $state(false);
	let renderedSlotWidth = $state(0);
	let figureElement = $state<HTMLElement | undefined>(undefined);
	let dpr = $state(1);
	let promotedFailed = $state(false);
	let hdrProbeStatus = $state<'not-requested' | 'unsupported' | 'verified' | 'failed'>('not-requested');
	const isVideo = $derived(asset.type === 'VIDEO');
	const label = $derived(asset.caption ?? (isVideo ? 'Journey video' : 'Journey photograph'));
	const width = $derived(getPreferredDimension(asset.width, naturalWidth));
	const height = $derived(getPreferredDimension(asset.height, naturalHeight));
	const orientation = $derived(getPresentationOrientation(width, height));
	const dimensions = $derived(getLightboxDimensions(width, height));
	const lightboxWidth = $derived(dimensions.width);
	const lightboxHeight = $derived(dimensions.height);
	const policyIntrinsicWidth = $derived(thumbnailIntrinsicWidth);
	const policyCssWidth = $derived(layoutWidth ?? 1);
	const policyRequiredWidth = $derived(requiredWidth(policyCssWidth, dpr));
	const resolution = $derived(layoutMeasured && measured && !promotedFailed && asset.fullsize ? chooseResolution(policyCssWidth, policyIntrinsicWidth, dpr) : 'thumbnail');
	const mediaSource = $derived(resolution === 'fullsize' && asset.fullsize ? asset.fullsize : asset.thumbnail);
	const resolvedThumbnailSource = $derived(resolve(asset.thumbnail as any));
	const resolvedFullsizeSource = $derived(asset.fullsize ? resolve(asset.fullsize as any) : null);
	const fullsizeAvailable = $derived(Boolean(asset.fullsize));
	const fallbackActive = $derived(resolution === 'thumbnail' && promotedFailed);
	let lastResolutionDiagnostic = '';

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
	function sourceMatches(actual: string, expected: string | null) {
		if (!actual || !expected) return false;
		if (actual === expected) return true;
		if (typeof document === 'undefined') return false;
		return new URL(actual, document.baseURI).href === new URL(expected, document.baseURI).href;
	}
	function getImageSource(image: HTMLImageElement) {
		const currentSource = image.currentSrc || image.src;
		if (sourceMatches(currentSource, resolvedFullsizeSource)) return 'fullsize';
		if (sourceMatches(currentSource, resolvedThumbnailSource)) return 'thumbnail';
		return null;
	}
	function handleMediaError(event: Event) {
		if (!isVideo) {
			const source = getImageSource(event.currentTarget as HTMLImageElement);
			if (!source) return;
			if (source === 'fullsize') {
			promotedFailed = true;
				reportJournalDebug('media-failure', { category: 'image', status: 'unavailable', errorContext: 'image-load' });
				return;
			}
			failed = true;
			reportJournalDebug('media-failure', { category: 'image', status: 'unavailable', errorContext: 'image-load' });
			return;
		}
		failed = true;
		reportJournalDebug('media-failure', { category: isVideo ? 'video' : 'image', status: 'unavailable', errorContext: isVideo ? 'video-load' : 'image-load' });
	}
	function handleMediaLoad(event: Event) {
		if (!isVideo) {
			const image = event.currentTarget as HTMLImageElement;
			const source = getImageSource(image);
			if (!source) return;
			if (source === 'fullsize') promotedFailed = false;
			if (source !== 'thumbnail') {
				reportJournalDebug('media-load', { category: 'image', status: 'success' });
				return;
			}
			const intrinsicWidth = image.naturalWidth;
			if (Number.isFinite(intrinsicWidth) && intrinsicWidth > 0) thumbnailIntrinsicWidth = intrinsicWidth;
		}
		reportJournalDebug('media-load', { category: isVideo ? 'video' : 'image', status: 'success' });
	}
	$effect(() => {
		if (!figureElement) return;
		const updateSlotWidth = () => {
			renderedSlotWidth = Math.max(0, Math.round(figureElement?.getBoundingClientRect().width ?? 0));
		};
		updateSlotWidth();
		if (typeof ResizeObserver === 'undefined') return;
		const observer = new ResizeObserver(updateSlotWidth);
		observer.observe(figureElement);
		return () => observer.disconnect();
	});
	$effect(() => {
		const diagnosticKey = [resolution, renderedSlotWidth, policyIntrinsicWidth ?? 'none', dpr, policyRequiredWidth, layoutMeasured, measured, fullsizeAvailable, promotedFailed, fallbackActive].join('|');
		if (!journalDebugEnabled || diagnosticKey === lastResolutionDiagnostic) return;
		lastResolutionDiagnostic = diagnosticKey;
		reportJournalDebug('media-resolution', {
			category: 'image',
			decision: resolution,
			slotWidth: renderedSlotWidth,
			intrinsicWidth: policyIntrinsicWidth,
			dpr,
			requiredWidth: policyRequiredWidth,
			layoutMeasured,
			measuringCompleted: measured,
			fullsizeAvailable,
			promotionFailed: promotedFailed,
			fallbackActive
		});
	});
	onMount(() => {
		dpr = typeof window.devicePixelRatio === 'number' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
		measured = true;
	});
	let probedFullsizeSource = '';
	$effect(() => {
		const source = resolution === 'fullsize' ? resolvedFullsizeSource : null;
		if (!source || probedFullsizeSource === source) return;
		probedFullsizeSource = source;
		if (!supportsHdrDisplay() && !supportsWideColorGamut()) {
			hdrProbeStatus = 'unsupported';
			return;
		}
		hdrProbeStatus = 'not-requested';
		void probeImageDecode(source).then((decoded) => {
			if (probedFullsizeSource === source) hdrProbeStatus = decoded ? 'verified' : 'failed';
		});
	});
</script>

	<figure bind:this={figureElement} id={'asset-' + asset.id} tabindex="-1" data-resolution-policy={layoutMeasured ? 'measured-slot' : 'thumbnail-baseline'} data-media-resolution={journalDebugEnabled ? resolution : undefined} data-media-hdr-status={journalDebugEnabled ? hdrProbeStatus : undefined} data-media-slot-width={journalDebugEnabled ? renderedSlotWidth : undefined} data-media-intrinsic-width={journalDebugEnabled ? policyIntrinsicWidth : undefined} data-media-dpr={journalDebugEnabled ? dpr : undefined} data-media-required-width={journalDebugEnabled ? policyRequiredWidth : undefined} data-media-layout-measured={journalDebugEnabled ? layoutMeasured : undefined} data-media-measuring-completed={journalDebugEnabled ? measured : undefined} data-media-fullsize-available={journalDebugEnabled ? fullsizeAvailable : undefined} data-media-promotion-failed={journalDebugEnabled ? promotedFailed : undefined} data-media-fallback-active={journalDebugEnabled ? fallbackActive : undefined} style={layoutWidth && layoutHeight ? `width: ${layoutWidth}px; height: ${layoutHeight}px` : undefined} class:failed class:full-width={asset.fullWidth} class:portrait={orientation === 'portrait'} class:landscape={orientation === 'landscape'}>
	{#if failed}<div class="unavailable" role="status">Media unavailable</div>
	{:else if isVideo}
		<div class="gallery-media-frame">
			<a href={resolve((asset.videoHref ?? asset.thumbnail) as any)} aria-label={label} data-media-source="thumbnail" data-lightbox-fallback="native-anchor" data-pswp-type="video" data-video-src={asset.videoHref} data-video-poster={asset.thumbnail} data-pswp-width={lightboxWidth} data-pswp-height={lightboxHeight}>
				<video src={asset.videoHref} poster={asset.thumbnail} controls playsinline preload="metadata" aria-label={label} onloadstart={handleMediaLoad} onerror={handleMediaError}><track kind="captions" /></video>
			</a>
		</div>
	{:else}
		<div class="gallery-media-frame">
			<a href={resolve(asset.thumbnail as any)} aria-label={label} data-media-source="thumbnail" data-lightbox-fallback="native-anchor" data-pswp-src={resolution === 'fullsize' ? resolvedFullsizeSource : undefined} data-pswp-width={lightboxWidth} data-pswp-height={lightboxHeight}>
				<img src={mediaSource} alt={label} loading="lazy" width={lightboxWidth} height={lightboxHeight} data-media-source={resolution} bind:naturalWidth bind:naturalHeight onload={handleMediaLoad} onerror={handleMediaError} />
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
