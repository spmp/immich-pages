<script lang="ts">
	import { onMount } from 'svelte';

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
	let readinessState = $state<ReadinessState>('preparing');
	let progress = $state<Progress>({ state: 'preparing', targeted: 1, queued: 0, running: 0, completed: 0, failed: 0, skipped: 0 });

	const isState = (value: unknown): value is ReadinessState => value === 'preparing' || value === 'ready' || value === 'partial';
	const isProgress = (value: unknown): value is Progress => {
		if (!value || typeof value !== 'object') return false;
		const candidate = value as Record<string, unknown>;
		return isState(candidate.state) && ['targeted', 'queued', 'running', 'completed', 'failed', 'skipped'].every((key) => typeof candidate[key] === 'number' && Number.isSafeInteger(candidate[key]) && candidate[key] >= 0);
	};

	onMount(() => {
		if (!enabled || !activeAssetId) return;
		let stopped = false;
		let timer: number | undefined;
		const endpoint = `${window.location.pathname}/prewarm`;
		const poll = async () => {
			if (stopped || document.visibilityState !== 'visible') return;
			try {
				const response = await fetch(endpoint, {
					method: 'POST',
					credentials: 'same-origin',
					headers: { 'content-type': 'application/json', 'x-hdr-representation': 'video' },
					body: JSON.stringify({ activeAssetId, activePosition })
				});
				const value: unknown = await response.json();
				if (isProgress(value)) {
					progress = value;
					readinessState = value.state;
				}
				if (!stopped && isProgress(value) && value.state === 'preparing') timer = window.setTimeout(() => void poll(), 2000);
			} catch {
				if (!stopped) {
					readinessState = 'partial';
					progress = { ...progress, state: 'partial' };
				}
			}
		};
		void poll();
		return () => { stopped = true; if (timer !== undefined) window.clearTimeout(timer); };
	});

	const label = $derived(readinessState === 'preparing' ? 'Preparing enhanced photos' : readinessState === 'ready' ? 'Enhanced photos ready' : 'Some enhanced photos are unavailable; showing standard photos');
</script>

{#if enabled && activeAssetId && progress.targeted !== 0}
	<div class="readiness" class:partial={readinessState === 'partial'} class:ready={readinessState === 'ready'} role="status" aria-live="polite" aria-label={label} title={label}>
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
