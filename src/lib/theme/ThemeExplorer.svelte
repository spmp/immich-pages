<script lang="ts">
	import { THEME_KEYS, THEME_REGISTRY, type ThemeKey } from './registry';
	import type { ThemeState } from './state.svelte';

	let { theme }: { theme: ThemeState } = $props();

	function selectTheme(value: string) {
		theme.select(value);
	}
</script>

<aside class="theme-explorer" aria-label="Temporary theme explorer">
	<label for="theme-choice">Explore theme</label>
	<select id="theme-choice" value={theme.selectedKey} onchange={(event) => selectTheme(event.currentTarget.value)}>
		{#each THEME_KEYS as key (key)}
			<option value={key}>{THEME_REGISTRY[key].label}</option>
		{/each}
	</select>
	<button type="button" onclick={() => theme.reset()}>Reset default</button>
	<span class="sr-only" aria-live="polite">{THEME_REGISTRY[theme.selectedKey as ThemeKey].label} selected</span>
</aside>

<style>
	.theme-explorer { display: flex; align-items: center; gap: 0.5rem; position: fixed; z-index: 20; right: 1rem; bottom: 1rem; padding: 0.5rem 0.625rem; border: 1px solid var(--theme-rule); border-radius: var(--theme-radius); background: var(--theme-surface); color: var(--theme-text); box-shadow: 0 0.5rem 2rem rgb(0 0 0 / 12%); font: 0.75rem/1.2 var(--theme-font-caption); }
	select, button { min-height: 2.25rem; border: 1px solid var(--theme-rule); border-radius: var(--theme-radius); background: var(--theme-surface); color: inherit; font: inherit; padding: 0.35rem 0.5rem; }
	button { cursor: pointer; }
	select:focus-visible, button:focus-visible { outline: 3px solid var(--theme-accent); outline-offset: 2px; }
	.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
	@media (max-width: 959px) { .theme-explorer { right: 0.75rem; bottom: 0.75rem; max-width: calc(100vw - 1.5rem); } }
	@media (prefers-reduced-motion: reduce) { .theme-explorer { transition: none; } }
</style>
