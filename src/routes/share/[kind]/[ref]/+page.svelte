<script lang="ts">
	import JournalPage from '$lib/components/journal/JournalPage.svelte';
	import PresentationState from '$lib/components/journal/PresentationState.svelte';

	let { data, form } = $props();
	const outcome = $derived(data.outcome);
</script>

{#if outcome.kind === 'page'}
	<JournalPage page={outcome.page} navigation={data.navigation} indicatorEnabled={data.indicatorEnabled} />
{:else if outcome.kind === 'presentation-error'}
	<PresentationState state={outcome.state} retryHref="." />
{:else if outcome.kind === 'password-required'}
	<PresentationState copy={{ heading: 'This journey is protected', body: 'Enter the password provided with this Pages link.', action: 'Continue' }} form loginFailed={form?.kind === 'login-failed'} />
{:else if outcome.kind === 'unauthorized'}
	<PresentationState copy={{ heading: 'This journey is no longer available', body: 'Please check the link and try again.', action: 'Try again' }} retryHref="." />
{:else if outcome.kind === 'non-page'}
	<PresentationState copy={{ heading: 'This is not a Pages journey', body: 'The shared album is not published as a Pages presentation.', action: 'Try again' }} retryHref="." />
{:else}
	<PresentationState state="temporary" retryHref="." />
{/if}
