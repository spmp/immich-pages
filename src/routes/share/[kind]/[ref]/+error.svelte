<script lang="ts">
	import PresentationState from '$lib/components/journal/PresentationState.svelte';
	import { routeErrorCopy } from '$lib/components/journal/presentation-copy';

	let { status } = $props();
	const copy = $derived(routeErrorCopy(typeof status === 'number' ? status : 500));
</script>

<svelte:head><title>{copy.heading}</title></svelte:head>

<PresentationState copy={copy} />
