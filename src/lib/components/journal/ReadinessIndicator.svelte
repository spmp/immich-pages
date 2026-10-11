<script lang="ts">
	import { onMount } from 'svelte';
	import { preferredHdrRepresentation } from '$lib/media/capabilities';
	import { resolveHdrReadiness } from '$lib/media/hdr-readiness';

	type ReadinessState = 'preparing' | 'ready' | 'partial';
	type Progress = {
		state: ReadinessState;
		targeted: number;
		queued: number;
		running: number;
		completed: number;
		failed: number;
		skipped: number;
	};

	let { enabled, activeAssetId, activePosition = 0 }: { enabled: boolean; activeAssetId?: string; activePosition?: number } = $props();
	let readinessState = $state<ReadinessState>('ready');
	let progress = $state<Progress>({ state: 'ready', targeted: 0, queued: 0, running: 0, completed: 0, failed: 0, skipped: 0 });

	const isState = (value: unknown): value is ReadinessState => value === 'preparing' || value === 'ready' || value === 'partial';
	const isProgress = (value: unknown): value is Progress => {
		if (!value || typeof value !== 'object') return false;
		const candidate = value as Record<string, unknown>;
		return isState(candidate.state) && ['targeted', 'queued', 'running', 'completed', 'failed', 'skipped'].every((key) => typeof candidate[key] === 'number' && Number.isSafeInteger(candidate[key]) && candidate[key] >= 0);
	};

	onMount(() => {
		const representation = preferredHdrRepresentation();
		if (!enabled || !activeAssetId) return;
		if (!representation) {
			progress = resolveHdrReadiness(progress, { supported: false });
			readinessState = progress.state;
			return;
		}
		let stopped = false;
		let timer: number | undefined;
		let currentAssetId = activeAssetId;
		let currentPosition = activePosition;
		const endpoint = `${window.location.pathname}/prewarm`;
		const poll = async () => {
			if (stopped || document.visibilityState !== 'visible') return;
			try {
				const response = await fetch(endpoint, {
					method: 'POST',
					credentials: 'same-origin',
					headers: { 'content-type': 'application/json', 'x-hdr-representation': representation },
					body: JSON.stringify({ activeAssetId: currentAssetId, activePosition: currentPosition })
				});
				if (!response.ok) {
					progress = resolveHdrReadiness(progress, { supported: true, controlFailed: true });
					readinessState = progress.state;
					return;
				}
				const value: unknown = await response.json();
				if (isProgress(value)) {
					progress = resolveHdrReadiness(value, { supported: true });
					readinessState = progress.state;
				}
				if (!stopped && isProgress(value) && value.state === 'preparing') timer = window.setTimeout(() => void poll(), 2000);
			} catch {
				if (!stopped) {
					progress = resolveHdrReadiness(progress, { supported: true, controlFailed: true });
					readinessState = progress.state;
				}
			}
		};
		const onActiveAsset = (event: Event) => {
			const detail = (event as CustomEvent<{ activeAssetId?: string; activePosition?: number }>).detail;
			if (!detail?.activeAssetId || typeof detail.activePosition !== 'number' || !Number.isSafeInteger(detail.activePosition) || detail.activePosition < 0) return;
			currentAssetId = detail.activeAssetId;
			currentPosition = detail.activePosition;
			void poll();
		};
		document.addEventListener('pages:active-asset', onActiveAsset);
		void poll();
		return () => { stopped = true; document.removeEventListener('pages:active-asset', onActiveAsset); if (timer !== undefined) window.clearTimeout(timer); };
	});

	const label = $derived(readinessState === 'preparing' ? 'Preparing enhanced photos' : readinessState === 'ready' ? 'Enhanced photos ready' : 'Some enhanced photos are unavailable; showing standard photos');
</script>

{#if enabled && activeAssetId && progress.targeted !== 0}
	<div class="readiness" class:partial={readinessState === 'partial'} class:ready={readinessState === 'ready'} role="status" aria-live="polite" aria-busy={readinessState === 'preparing'} aria-label={label} title={label}>
		<span class="indicator" aria-hidden="true"></span>
		<span class="sr-only">{label}</span>
	</div>
{/if}

<style>
	.readiness { position: fixed; z-index: 3; top: 16px; left: 16px; display: inline-flex; align-items: center; width: 28px; height: 28px; justify-content: center; pointer-events: none; color: var(--theme-text); }
	.indicator { width: 9px; height: 9px; border-radius: 50%; background: var(--theme-accent, #c96b4b); }
	.readiness:not(.ready):not(.partial) .indicator { width: 16px; height: 16px; border: 2px solid color-mix(in srgb, currentColor 28%, transparent); border-top-color: currentColor; animation: readiness-spin 900ms linear infinite; }
	.readiness.ready .indicator { background: #2d8a58; }
	.readiness.partial .indicator { width: 10px; height: 10px; background: #b7791f; box-shadow: 0 0 0 3px color-mix(in srgb, #b7791f 18%, transparent); }
	.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
	@keyframes readiness-spin { to { transform: rotate(360deg); } }
	@media (prefers-reduced-motion: reduce) { .readiness:not(.ready):not(.partial) .indicator { animation: none; } }
</style>
