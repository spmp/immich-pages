<script lang="ts">
	import JournalPage from '$lib/components/journal/JournalPage.svelte';

	let { data } = $props();
	const outcome = $derived(data.outcome);
</script>

{#if outcome.kind === 'page'}
	<JournalPage page={outcome.page} />
{:else}
	<main><p>This journey is unavailable right now. Please check the link and try again.</p></main>
{/if}
