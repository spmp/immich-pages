<script lang="ts">
	import { tick } from 'svelte';
	import { resolve } from '$app/paths';
	import type { NavigationEntry } from '$server/library/model';
	import ThemeExplorer from '$lib/theme/ThemeExplorer.svelte';
	import type { ThemeState } from '$lib/theme/state.svelte';

	let { entries = [], activeHref, theme }: { entries?: NavigationEntry[]; activeHref?: string; theme?: ThemeState } = $props();
	let open = $state(false);
	let dialog = $state<HTMLDialogElement>();
	let opener = $state<HTMLButtonElement>();

	const safeHref = (href: string) => href.startsWith('/') && !href.startsWith('//') ? href : '/';
	const safeThumbnail = (thumbnail?: string) => thumbnail && thumbnail.startsWith('/') && !thumbnail.startsWith('//') ? thumbnail : undefined;
	const dateLabel = (date?: NavigationEntry['date']) => date ? (date.start.slice(0, 10) === date.end.slice(0, 10) ? date.start.slice(0, 10) : `${date.start.slice(0, 10)} — ${date.end.slice(0, 10)}`) : undefined;
	const focusables = () => [...(dialog?.querySelectorAll<HTMLElement>('header button, nav a[href]') ?? [])].filter((element) => !element.hasAttribute('disabled'));

	async function openDrawer() {
		opener = document.activeElement instanceof HTMLButtonElement ? document.activeElement : undefined;
		open = true;
		await tick();
		focusables()[0]?.focus();
	}

	function closeDrawer() {
		open = false;
		void tick().then(() => opener?.focus());
	}

	function trap(event: KeyboardEvent) {
		if (event.key === 'Escape') { event.preventDefault(); closeDrawer(); return; }
		if (event.key !== 'Tab') return;
		const items = focusables();
		if (!items.length) return;
		const first = items[0]; const last = items[items.length - 1];
		if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
		else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
	}
</script>

<button class="open-drawer" bind:this={opener} type="button" aria-label="Open journeys" aria-haspopup="dialog" aria-expanded={open} onclick={openDrawer}><span aria-hidden="true"><i></i><i></i><i></i></span></button>
{#if open}
	<div class="drawer-layer">
		<button class="backdrop" type="button" aria-label="Close journey navigation" onclick={closeDrawer}></button>
		<dialog open class="drawer" bind:this={dialog} aria-modal="true" aria-labelledby="mobile-navigation-title" tabindex="-1" onkeydown={trap}>
			<header><h2 id="mobile-navigation-title">Journeys</h2><button type="button" class="close" aria-label="Close journey navigation" onclick={closeDrawer}>×</button></header>
			<nav aria-label="Journey pages"><ul>{#each entries as entry (entry.href)}<li><a href={resolve(safeHref(entry.href) as any)} aria-current={safeHref(entry.href) === activeHref ? 'page' : undefined} onclick={closeDrawer}>{#if safeThumbnail(entry.thumbnail)}<img src={safeThumbnail(entry.thumbnail)} alt="" loading="lazy" />{/if}<span><strong>{entry.title}</strong>{#if dateLabel(entry.date)}<small>{dateLabel(entry.date)}</small>{/if}</span></a></li>{/each}</ul></nav>
			{#if theme}<ThemeExplorer {theme} selectId="mobile-theme-choice" />{/if}
		</dialog>
	</div>
{/if}

<style>
	.open-drawer { display: none; position: absolute; z-index: 2; top: 16px; right: 16px; width: 44px; height: 44px; padding: 10px; border: 1px solid var(--theme-rule); color: var(--theme-text); background: var(--theme-surface); cursor: pointer; }
	.open-drawer span, .open-drawer i { display: block; }
	.open-drawer span { display: grid; gap: 4px; }
	.open-drawer i { height: 2px; background: currentColor; }
	.open-drawer:focus-visible, .close:focus-visible, a:focus-visible { outline: 3px solid var(--theme-accent, #c96b4b); outline-offset: 3px; }
	.drawer-layer { position: fixed; z-index: 20; inset: 0; display: grid; }
	.backdrop { position: absolute; inset: 0; border: 0; background: var(--theme-backdrop); cursor: pointer; }
	.drawer { position: relative; width: min(88vw, 360px); height: 100%; margin-left: auto; overflow-y: auto; padding: 24px 20px; color: var(--theme-text); background: var(--theme-nav-bg); box-shadow: -8px 0 32px color-mix(in srgb, var(--theme-text) 18%, transparent); }
	.drawer header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
	h2 { margin: 0; font: 400 28px/1.1 ui-serif, Georgia, serif; }
	.close { min-width: 44px; min-height: 44px; border: 0; color: inherit; background: transparent; font-size: 28px; cursor: pointer; }
	ul { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
	a { display: flex; align-items: center; gap: 12px; min-height: 64px; padding: 8px; color: inherit; text-decoration: none; }
	a[aria-current='page'] { background: var(--theme-surface, #ebe6dd); }
	img { width: 48px; height: 48px; object-fit: cover; background: var(--theme-rule, #d5cec2); }
	a span { display: grid; gap: 3px; min-width: 0; } strong, small { overflow-wrap: anywhere; } small { color: var(--theme-muted, #626860); font-size: 12px; }
	@media (min-width: 960px) { .drawer-layer, .open-drawer { display: none; } }
	@media (max-width: 959px) { .open-drawer { display: block; } }
	@media (prefers-reduced-motion: reduce) { .drawer { transition: none; } }
</style>
