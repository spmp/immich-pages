<script lang="ts">
	import type { Snippet } from 'svelte';
	import { normalizeThemeKey, type ThemeKey } from '$lib/theme/registry';

	let { themeKey, children }: { themeKey: ThemeKey; children: Snippet } = $props();
	const normalizedKey = $derived(normalizeThemeKey(themeKey));
</script>

<div class="theme-root" data-theme={normalizedKey}>
	{@render children()}
</div>
