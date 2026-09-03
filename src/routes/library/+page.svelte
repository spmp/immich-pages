<script lang="ts">
	import PageNavigation from '$lib/components/navigation/PageNavigation.svelte';
	import MobileDrawer from '$lib/components/navigation/MobileDrawer.svelte';
	import PresentationState from '$lib/components/journal/PresentationState.svelte';

	let { data } = $props();
	const library = $derived(data.library);
</script>

<svelte:head><title>Published journeys</title></svelte:head>

{#if library.kind === 'ready'}
	<div class="library-shell">
		<PageNavigation entries={library.entries} />
		<div class="mobile-navigation"><MobileDrawer entries={library.entries} /></div>
		<main aria-labelledby="library-title"><p class="eyebrow">Immich Pages</p><h1 id="library-title">Published journeys</h1><p class="intro">Choose a journey to begin.</p>{#if library.warnings.length}<p class="notice" role="status">Some journeys are temporarily unavailable.</p>{/if}</main>
	</div>
{:else if library.kind === 'access'}
	<PresentationState copy={{ heading: 'Your library is private', body: 'Open a shared journey in Pages to add it to your private library.', action: 'Try again' }} retryHref="." />
{:else if library.kind === 'empty'}
	<PresentationState copy={{ heading: 'No published journeys yet', body: 'Open a shared journey to add it to your private Pages library.', action: 'Try again' }} retryHref="." />
{:else}
	<PresentationState copy={{ heading: 'Your library is unavailable right now', body: 'Please try again in a moment.', action: 'Try again' }} retryHref="." />
{/if}

<style>
	.library-shell { min-height: 100svh; display: flex; color: #202522; background: #f6f3ee; }
	main { flex: 1; display: grid; align-content: center; justify-items: start; gap: 16px; padding: 48px clamp(24px, 7vw, 96px); }
	.eyebrow { margin: 0; color: #c96b4b; font: 600 13px/1.3 ui-sans-serif, system-ui, sans-serif; letter-spacing: .08em; text-transform: uppercase; }
	h1 { max-width: 14ch; margin: 0; font: 400 clamp(42px, 8vw, 84px)/.98 ui-serif, Georgia, serif; }
	.intro, .notice { max-width: 42ch; margin: 0; color: #626860; }
	.notice { padding: 12px 16px; border-left: 3px solid #c96b4b; background: #ebe6dd; }
	.mobile-navigation { display: none; position: fixed; z-index: 10; top: 16px; right: 16px; }
	@media (max-width: 959px) { .library-shell { display: block; } .mobile-navigation { display: block; } main { min-height: 100svh; padding: 96px 24px 48px; } }
</style>
