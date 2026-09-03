<script lang="ts">
	import JournalPage from '$lib/components/journal/JournalPage.svelte';
	import PresentationState from '$lib/components/journal/PresentationState.svelte';

	let { data }: { data: { outcome: any; navigation?: any } } = $props();
	const outcome = $derived(data.outcome);
	const navigation = $derived(outcome.kind === 'page' ? data.navigation : undefined);
</script>

{#if outcome.kind === 'page'}
	<JournalPage page={outcome.page} {navigation} />
{:else if outcome.kind === 'presentation-error'}
	<PresentationState state={outcome.state} retryHref="." />
{:else}
	<PresentationState copy={{ heading: 'This journey is no longer available', body: 'The old library route is no longer supported.', action: 'Try again' }} retryHref="/library" />
{/if}
