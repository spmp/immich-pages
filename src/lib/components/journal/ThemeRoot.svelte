<script lang="ts">
	import { onMount } from 'svelte';
	import type { Snippet } from 'svelte';
	import { normalizeThemeKey, type ThemeKey } from '$lib/theme/registry';
	import { normalizeGradient, sampleHeroGradient } from '$lib/theme/gradient';
	import type { NormalizedGradient } from '$server/presentation/model';
	import type { ThemeState } from '$lib/theme/state.svelte';

	let { theme, themeKey, gradient, heroSource, children }: { theme?: ThemeState; themeKey?: ThemeKey; gradient?: NormalizedGradient; heroSource?: string | null; children: Snippet } = $props();
	const normalizedKey = $derived(normalizeThemeKey(theme?.effectiveKey ?? themeKey));
	let automaticGradient = $state<NormalizedGradient | null>(null);
	const explicitGradient = $derived(normalizeGradient(gradient));
	const appliedGradient = $derived(explicitGradient ?? automaticGradient);
	const gradientStyle = $derived(appliedGradient
		? `--theme-gradient-direction: ${appliedGradient.direction}; --theme-gradient-top: ${appliedGradient.top}; --theme-gradient-bottom: ${appliedGradient.bottom};`
		: undefined);

	onMount(() => {
		if (gradient || !heroSource) return;
		void sampleHeroGradient(heroSource).then((sampled) => {
			if (sampled) automaticGradient = sampled;
		});
	});
</script>

<div class="theme-root" data-theme={normalizedKey} data-gradient-mode={explicitGradient ? 'explicit' : automaticGradient ? 'automatic' : 'theme'} style={gradientStyle}>
	{@render children()}
</div>
