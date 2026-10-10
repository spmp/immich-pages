<script lang="ts">
	import type { NormalizedAsset } from '$server/presentation/model';
	import GalleryAsset from './GalleryAsset.svelte';
	import Lightbox from './Lightbox.svelte';
	import { onMount } from 'svelte';
	import { env } from '$env/dynamic/public';
	import { reportJournalDebug } from './journal-debug';
	import { calculateJustifiedRows } from './justified-layout';
	import { supportsHdrVideo } from '$lib/media/capabilities';
	let { assets, shareKind, shareRef, fullWidth = [] }: { assets: NormalizedAsset[]; shareKind?: string; shareRef?: string; fullWidth?: string[] } = $props();
	const enriched = $derived(assets.map((asset) => {
		const videoHref = asset.videoHref ?? (asset.type === 'VIDEO' && shareKind && shareRef ? `/share/${shareKind}/${encodeURIComponent(shareRef)}/media/${encodeURIComponent(asset.id)}/video/playback` : undefined);
		return { ...asset, fullWidth: asset.fullWidth || fullWidth.includes(asset.id), videoHref };
	}));
	let galleryElement = $state<HTMLElement | undefined>(undefined);
	let availableWidth = $state(960);
	let layoutMeasured = $state(false);
	const rows = $derived(calculateJustifiedRows(enriched, availableWidth));
	$effect(() => {
		if (!galleryElement) return;
		const update = () => { availableWidth = Math.max(1, galleryElement?.clientWidth ?? 960); layoutMeasured = true; };
		update();
		if (typeof ResizeObserver === 'undefined') return;
		const observer = new ResizeObserver(update);
		observer.observe(galleryElement);
		return () => observer.disconnect();
	});
	onMount(() => reportJournalDebug('gallery-state', { category: 'gallery', status: enriched.length === 0 ? 'empty' : 'success', assetCount: enriched.length, imageCount: enriched.filter((asset) => asset.type !== 'VIDEO').length, videoCount: enriched.filter((asset) => asset.type === 'VIDEO').length, ...(enriched.length === 0 ? { errorContext: 'gallery-load' as const } : {}) }));
	onMount(() => {
		if (!supportsHdrVideo()) return;
		const controllers = new Set<AbortController>();
		const completed = new Set<string>();
		const activeUrls = new Set<string>();
		const attempts = new Map<string, number>();
		let stopped = false;
		let running = 0;
		let queue: string[] = [];
		const assetInfo = (url: string) => {
			const elements = Array.from(document.querySelectorAll<HTMLElement>('[data-hdr-prewarm]'));
			const index = elements.findIndex((element) => element.dataset.hdrPrewarm === url);
			return { assetIndex: index >= 0 ? index : undefined, assetTotal: elements.length };
		};
		// This is a separate, per-browser-tab limit on how many background prewarm *fetches* this
		// one client issues in parallel -- unrelated to the server's own HDR_MAX_CONCURRENT (which
		// bounds simultaneous native conversions across every client). Configurable for the same
		// reason everything else here is: no reason to force a code change + redeploy to try a
		// different value.
		const parsedPrewarmConcurrency = Number(env.PUBLIC_HDR_PREWARM_CONCURRENCY);
		const maxConcurrent = Number.isFinite(parsedPrewarmConcurrency) && parsedPrewarmConcurrency > 0 ? Math.min(Math.trunc(parsedPrewarmConcurrency), 16) : 2;
		// No bound on how long a single prewarm fetch could hang -- a stalled connection (real risk
		// on a flaky mobile network, which is exactly the device class this exists for) would
		// permanently occupy one of only `maxConcurrent` client-side slots for the rest of the
		// session, silently halting all further prewarming with no visible symptom at all.
		const prewarmFetchTimeoutMs = 90_000;
		// Default: natural gallery order (first photo, then sequentially) -- querySelectorAll
		// already returns elements in document order, so no sort needed. If the viewer opens a
		// specific photo in the lightbox, pages:active-asset (dispatched by Lightbox.svelte)
		// rotates this so prewarming continues sequentially from that photo instead of wherever
		// the original front-to-back scan happened to be.
		let preferredStartFigureId: string | null = null;
		const schedule = () => {
			if (stopped || document.visibilityState !== 'visible') return;
			const candidates = Array.from(document.querySelectorAll<HTMLElement>('[data-hdr-prewarm]'))
				.map((element) => ({ url: element.dataset.hdrPrewarm, figureId: element.closest('figure')?.id }))
				.filter((item): item is { url: string; figureId: string | undefined } => Boolean(item.url && !completed.has(item.url)));
			const startIndex = preferredStartFigureId ? candidates.findIndex((item) => item.figureId === preferredStartFigureId) : -1;
			const ordered = startIndex > 0 ? [...candidates.slice(startIndex), ...candidates.slice(0, startIndex)] : candidates;
			queue = ordered.map((item) => item.url).filter((url, index, all) => all.indexOf(url) === index && !activeUrls.has(url));
			reportJournalDebug('hdr-prewarm', { status: 'changed', requestPhase: 'schedule', assetTotal: candidates.length, prewarmReuse: completed.size > 0 });
			pump();
		};
		const pump = () => {
			while (!stopped && document.visibilityState === 'visible' && running < maxConcurrent && queue.length) {
				const url = queue.shift()!;
				if (completed.has(url) || activeUrls.has(url)) {
					reportJournalDebug('hdr-prewarm', { status: 'ready', requestPhase: 'reuse', urlKind: 'hdr-video', prewarmReuse: true, ...assetInfo(url) });
					continue;
				}
				activeUrls.add(url);
				attempts.set(url, (attempts.get(url) ?? 0) + 1);
				running += 1;
				const controller = new AbortController();
				controllers.add(controller);
				const giveUpTimer = window.setTimeout(() => controller.abort(), prewarmFetchTimeoutMs);
				const startedAt = performance.now();
				reportJournalDebug('hdr-prewarm', { status: 'started', requestPhase: 'start', urlKind: 'hdr-video', ...assetInfo(url) });
				let succeeded = false;
				void fetch(url, { credentials: 'same-origin', signal: controller.signal, headers: { accept: 'video/mp4' } })
					.then(async (response) => {
						const bytes = response.ok ? (await response.arrayBuffer()).byteLength : null;
						succeeded = response.ok;
						if (succeeded) completed.add(url);
						reportJournalDebug('hdr-prewarm', { status: response.ok ? 'success' : 'failure', requestPhase: 'end', urlKind: 'hdr-video', statusCode: response.status, bytes, durationMs: performance.now() - startedAt, ...assetInfo(url) });
					})
					.catch(() => reportJournalDebug('hdr-prewarm', { status: 'failure', requestPhase: 'end', urlKind: 'hdr-video', failureCategory: controller.signal.aborted ? 'timeout' : 'network', bytes: null, durationMs: performance.now() - startedAt, ...assetInfo(url) }))
					.finally(() => {
						window.clearTimeout(giveUpTimer);
						controllers.delete(controller);
						activeUrls.delete(url);
						running -= 1;
						if (!succeeded && (attempts.get(url) ?? 0) < 2 && !stopped) queue.push(url);
						pump();
					});
			}
		};
		const onActiveAsset = (event: Event) => {
			const figureId = (event as CustomEvent<{ figureId?: string }>).detail?.figureId;
			if (!figureId || figureId === preferredStartFigureId) return;
			preferredStartFigureId = figureId;
			schedule();
		};
		document.addEventListener('pages:active-asset', onActiveAsset);
		const galleryRoot = document.querySelector<HTMLElement>(`#journal-gallery`);
		const prewarmObserver = typeof MutationObserver === 'undefined' || !galleryRoot ? undefined : new MutationObserver(() => schedule());
		prewarmObserver?.observe(galleryRoot!, { subtree: true, attributes: true, attributeFilter: ['data-hdr-prewarm'] });
		const onVisibilityChange = () => {
			if (document.visibilityState === 'hidden') {
				for (const controller of controllers) controller.abort();
				queue = [];
			} else schedule();
		};
		document.addEventListener('visibilitychange', onVisibilityChange);
		const idleWindow = window as Window & { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number; cancelIdleCallback?: (handle: number) => void };
		const usedIdleCallback = Boolean(idleWindow.requestIdleCallback);
		const idle = usedIdleCallback ? idleWindow.requestIdleCallback!(schedule, { timeout: 250 }) : window.setTimeout(schedule, 0);
		return () => {
			stopped = true;
			document.removeEventListener('visibilitychange', onVisibilityChange);
			document.removeEventListener('pages:active-asset', onActiveAsset);
			prewarmObserver?.disconnect();
			for (const controller of controllers) controller.abort();
			if (usedIdleCallback && idleWindow.cancelIdleCallback) idleWindow.cancelIdleCallback(idle);
			else window.clearTimeout(idle);
		};
	});
</script>

	<section class="gallery" aria-label="Gallery">
	{#if enriched.length === 0}<p>No photographs to show yet</p>{:else}<Lightbox galleryId="journal-gallery" /><div id="journal-gallery" class="gallery-grid" bind:this={galleryElement}>{#each rows as row, rowIndex (rowIndex)}<div class:full-width-row={row.fullWidth} class="justified-row" style={`height: ${row.height}px`}>{#each row.items as asset (asset.id)}<GalleryAsset {asset} layoutWidth={asset.layoutWidth} layoutHeight={asset.layoutHeight} {layoutMeasured} />{/each}</div>{/each}</div>{/if}
</section>

<style>
	.gallery { padding: var(--theme-space-section) 16px 64px; color: var(--theme-text); }
	.gallery-grid { display: block; }
	.justified-row { display: flex; align-items: stretch; gap: var(--theme-space-gap); margin-bottom: var(--theme-space-section); overflow: hidden; }
	.justified-row :global(figure) { flex: 0 0 auto; }
	.full-width-row { display: block; }
	.full-width-row :global(figure) { width: 100% !important; }
	@media (min-width: 640px) { .gallery { padding-left: 24px; padding-right: 24px; } }
	@media (min-width: 960px) { .gallery { padding-left: 32px; padding-right: 32px; } }
	@media (min-width: 1200px) { .gallery { padding-left: 48px; padding-right: 48px; } }
</style>
