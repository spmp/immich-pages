<script lang="ts">
	import JournalPage from '$lib/components/journal/JournalPage.svelte';
	import PresentationState from '$lib/components/journal/PresentationState.svelte';

	let { data, params } = $props();
	const outcome = $derived(data.outcome);
	const navigation = $derived(outcome.kind === 'page' ? {
		entries: [{ href: `/library/page/${encodeURIComponent(params.locator)}`, title: outcome.page.album.title, date: outcome.page.album.startDate && outcome.page.album.endDate ? { start: outcome.page.album.startDate, end: outcome.page.album.endDate } : undefined, thumbnail: outcome.page.hero?.thumbnail }],
		activeHref: `/library/page/${encodeURIComponent(params.locator)}`
	} : undefined);
</script>

{#if outcome.kind === 'page'}
	<JournalPage page={outcome.page} {navigation} />
{:else if outcome.kind === 'presentation-error'}
	<PresentationState state={outcome.state} retryHref="." />
{:else}
	<PresentationState copy={{ heading: 'This journey is no longer available', body: 'Please check your Immich access and try again.', action: 'Try again' }} retryHref="." />
{/if}
