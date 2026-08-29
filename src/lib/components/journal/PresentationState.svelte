<script lang="ts">
	import { presentationCopy, type PresentationStateKind } from './presentation-copy';
	import { onMount } from 'svelte';
	import { reportJournalDebug } from './journal-debug';

	let { state = 'temporary', retryHref = '.', copy: copyOverride }: { state?: PresentationStateKind; retryHref?: string; copy?: { heading: string; body: string; action: string } } = $props();
	const copy = $derived(copyOverride ?? presentationCopy(state));
	onMount(() => { reportJournalDebug('presentation-state', { status: state === 'invalid' ? 'invalid' : state }); reportJournalDebug('fallback', { category: 'gallery', status: state === 'invalid' ? 'invalid' : state }); });
</script>

<section class="presentation-state" aria-labelledby="state-title" role="status">
	<span class="rule" aria-hidden="true"></span>
	<h1 id="state-title">{copy.heading}</h1>
	<p>{copy.body}</p>
	<a href={retryHref}>{copy.action}</a>
</section>

<style>
	.presentation-state { min-height: 100svh; display: grid; align-content: center; justify-items: start; gap: 16px; padding: 48px 16px; color: #202522; background: #f6f3ee; }
	.rule { width: 32px; height: 4px; background: #c96b4b; }
	h1 { max-width: 24ch; margin: 0; font: 400 clamp(36px, 6vw, 48px)/1.05 ui-serif, Georgia, serif; overflow-wrap: anywhere; }
	p { max-width: 48ch; margin: 0; color: #626860; font: 400 16px/1.5 ui-sans-serif, system-ui, sans-serif; }
	a { min-height: 44px; display: inline-flex; align-items: center; padding: 8px 16px; color: #fffdf8; background: #c96b4b; font: 600 14px/1.3 ui-sans-serif, system-ui, sans-serif; }
	a:focus-visible { outline: 3px solid #202522; outline-offset: 4px; }
	@media (min-width: 640px) { .presentation-state { padding-left: 24px; padding-right: 24px; } }
	@media (min-width: 960px) { .presentation-state { padding-left: 32px; padding-right: 32px; } }
	@media (min-width: 1200px) { .presentation-state { padding-left: 48px; padding-right: 48px; } }
</style>
