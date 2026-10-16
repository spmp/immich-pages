<!-- Development-only artifact. Production routes must not import this exploratory surface. -->
<script lang="ts">
	import { THEME_KEYS, THEME_REGISTRY, type ThemeKey } from './registry';
	import type { ThemeState } from './state.svelte';

	let { theme, selectId = 'theme-choice' }: { theme: ThemeState; selectId?: string } = $props();

	function selectTheme(value: string) {
		theme.select(value);
	}
</script>

<aside class="theme-explorer" aria-label="Temporary theme explorer">
	<label for={selectId}>Explore theme</label>
	<select id={selectId} value={theme.selectedKey} onchange={(event) => selectTheme(event.currentTarget.value)}>
		{#each THEME_KEYS as key (key)}
			<option value={key}>{THEME_REGISTRY[key].label}</option>
		{/each}
	</select>
	<strong class="selected-mode">Selected mode: {THEME_REGISTRY[theme.selectedKey as ThemeKey].label}</strong>
	<strong class="active-theme">Active preset: {THEME_REGISTRY[theme.effectiveKey as ThemeKey].label}</strong>
	<button type="button" onclick={() => theme.reset()}>Reset default</button>
	<span class="sr-only" aria-live="polite">{THEME_REGISTRY[theme.selectedKey as ThemeKey].label} selected; active preset {THEME_REGISTRY[theme.effectiveKey as ThemeKey].label}</span>
</aside>

<style>
	.theme-explorer { display: grid; gap: 0.5rem; padding: 0.75rem 0; color: var(--theme-text); font: 0.75rem/1.2 var(--theme-font-caption); }
	select, button { min-height: 2.25rem; border: 1px solid var(--theme-rule); border-radius: var(--theme-radius); background: var(--theme-surface); color: inherit; font: inherit; padding: 0.35rem 0.5rem; }
	button { cursor: pointer; }
	.active-theme { color: var(--theme-text); font-weight: 700; }
	select:focus-visible, button:focus-visible { outline: 3px solid var(--theme-accent); outline-offset: 2px; }
	.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
	@media (max-width: 959px) { .theme-explorer { padding: 0; } }
</style>
