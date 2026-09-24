<script lang="ts">
	import { onMount } from 'svelte';
	import type { Snippet } from 'svelte';
	import { normalizeThemeKey, type ThemeKey } from '$lib/theme/registry';
	import { sampleHeroGradient } from '$lib/theme/gradient';
	import type { NormalizedGradient } from '$server/presentation/model';
	import type { ThemeState } from '$lib/theme/state.svelte';

	let { theme, themeKey, gradient, heroSource, children }: { theme?: ThemeState; themeKey?: ThemeKey; gradient?: NormalizedGradient; heroSource?: string | null; children: Snippet } = $props();
	const normalizedKey = $derived(normalizeThemeKey(theme?.effectiveKey ?? themeKey));
	type ColoredGradient = Extract<NormalizedGradient, { auto: false }>;
	let automaticGradient = $state<ColoredGradient | null>(null);
	const automaticGradientEnabled = $derived(gradient?.auto === true);
	const explicitGradient = $derived(gradient?.auto === false ? gradient : null);
	const appliedGradient = $derived(explicitGradient ?? automaticGradient);
	const gradientStyle = $derived(appliedGradient
		? `--theme-gradient-direction: ${appliedGradient.direction}; --theme-gradient-top: ${appliedGradient.top}; --theme-gradient-bottom: ${appliedGradient.bottom};`
		: undefined);

	onMount(() => {
		theme?.hydrate();
		if (!automaticGradientEnabled || !heroSource) return;
		const foreground = normalizedKey === 'light' ? '#1b1b1b' : '#f1eee7';
		void sampleHeroGradient(heroSource, foreground).then((sampled) => {
			if (sampled) automaticGradient = { auto: false, direction: gradient?.direction ?? 'to bottom', top: sampled.top, bottom: sampled.bottom };
		});
	});
</script>

<div class="theme-root" data-theme={normalizedKey} data-gradient-mode={explicitGradient ? 'explicit' : automaticGradient ? 'automatic' : 'theme'} style={gradientStyle}>
	{@render children()}
</div>
