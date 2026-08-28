<script lang="ts">
	import JournalPage from '$lib/components/journal/JournalPage.svelte';
	import PresentationState from '$lib/components/journal/PresentationState.svelte';

	let { data } = $props();
	const outcome = $derived(data.outcome);
</script>

{#if outcome.kind === 'page'}
	<JournalPage page={outcome.page} />
{:else if outcome.kind === 'presentation-error'}
	<PresentationState state={outcome.state} retryHref="." />
{/if}
