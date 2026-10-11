<script lang="ts">
	import { onMount } from 'svelte';
	import { preferredHdrRepresentation } from '$lib/media/capabilities';
	import { resolveHdrReadiness } from '$lib/media/hdr-readiness';
	import { reportJournalDebug } from './journal-debug';

	type ReadinessState = 'idle' | 'unsupported' | 'empty' | 'preparing' | 'ready' | 'partial';
	// Status of the ONE asset the viewer currently has open -- computed server-side, see
	// prewarm/+server.ts and hdr-caching-uat-20261010 root_cause (3). Absent on an older/degraded
	// response, in which case resolveHdrReadiness falls back to the aggregate window math alone.
	type ActiveAssetState = 'ineligible' | 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'unavailable';
	type Progress = {
		state: ReadinessState;
		targeted: number;
		queued: number;
		running: number;
		completed: number;
		failed: number;
		skipped: number;
		activeAssetState?: ActiveAssetState;
	};

	let { enabled, activeAssetId, activePosition = 0 }: { enabled: boolean; activeAssetId?: string; activePosition?: number } = $props();
	let readinessState = $state<ReadinessState>('idle');
	let progress = $state<Progress>({ state: 'ready', targeted: 0, queued: 0, running: 0, completed: 0, failed: 0, skipped: 0 });

	const isState = (value: unknown): value is ReadinessState => value === 'preparing' || value === 'ready' || value === 'partial' || value === 'empty' || value === 'unsupported' || value === 'idle';
	const isActiveAssetState = (value: unknown): value is ActiveAssetState => value === 'ineligible' || value === 'queued' || value === 'running' || value === 'succeeded' || value === 'failed' || value === 'skipped' || value === 'unavailable';
	const isProgress = (value: unknown): value is Progress => {
		if (!value || typeof value !== 'object') return false;
		const candidate = value as Record<string, unknown>;
		if (!isState(candidate.state)) return false;
		if (!['targeted', 'queued', 'running', 'completed', 'failed', 'skipped'].every((key) => typeof candidate[key] === 'number' && Number.isSafeInteger(candidate[key]) && candidate[key] >= 0)) return false;
		return candidate.activeAssetState === undefined || isActiveAssetState(candidate.activeAssetState);
	};

	onMount(() => {
		const representation = preferredHdrRepresentation();
		if (!enabled || !activeAssetId) return;
		if (!representation) {
				readinessState = 'unsupported';
				progress = { ...progress, state: 'ready' };
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
					body: JSON.stringify({ activeAssetId: currentAssetId, activePosition: currentPosition, representation })
				});
				if (!response.ok) {
					readinessState = 'partial';
					return;
				}
				const value: unknown = await response.json();
				if (isProgress(value)) {
					progress = resolveHdrReadiness(value, { supported: true });
					// 'empty' (dot hidden entirely) covers two distinct cases: the legacy aggregate
					// signal of "nothing in the whole window" (only meaningful when the server
					// hasn't computed a per-asset signal at all), and "this specific photo isn't an
					// HDR candidate" (activeAssetState: 'ineligible'). Anything else defers to the
					// already-resolved, per-asset-aware progress.state from resolveHdrReadiness.
					readinessState = value.activeAssetState === 'ineligible' || (value.activeAssetState === undefined && value.targeted === 0) ? 'empty' : progress.state;
					// Readiness/control-plane debug event (hdr-caching-uat-20261010 finding 6c, user-
					// requested): built field-by-field from only the already-bounded Progress fields,
					// never spread -- no asset ID crosses this boundary, matching journal-debug.ts's
					// own documented convention for every other client-debug event.
					reportJournalDebug('hdr-prewarm', { readinessState: progress.state, targeted: progress.targeted, completed: progress.completed, failed: progress.failed, skipped: progress.skipped, ...(progress.activeAssetState ? { activeAssetState: progress.activeAssetState } : {}) });
					// Re-poll on the resolved, per-asset-aware state, not the raw aggregate
					// value.state -- see hdr-caching-uat-20261010 root_cause (3): a window that
					// reports 'ready' while the one asset the viewer is actually waiting on is
					// still queued or running must not stop polling before that photo specifically
					// is confirmed ready.
					if (!stopped && progress.state === 'preparing') timer = window.setTimeout(() => void poll(), 2000);
				}
			} catch {
				if (!stopped) {
					readinessState = 'partial';
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

	const label = $derived(readinessState === 'preparing' ? 'Preparing enhanced photos' : readinessState === 'ready' ? 'Enhanced photos ready' : readinessState === 'unsupported' ? 'Enhanced photos unsupported' : readinessState === 'empty' ? 'No enhanced photos needed' : 'Some enhanced photos are unavailable; showing standard photos');
</script>

{#if enabled && activeAssetId && readinessState !== 'idle' && readinessState !== 'empty' && readinessState !== 'unsupported'}
	<!-- Previous contract was progress.targeted !== 0; explicit empty/unsupported states now suppress it. -->
	<!-- {#if enabled && activeAssetId && progress.targeted !== 0} -->
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
