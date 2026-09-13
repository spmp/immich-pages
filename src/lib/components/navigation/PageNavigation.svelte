<script lang="ts">
	import type { NavigationEntry } from '$server/library/model';
	import { resolve } from '$app/paths';
	import ThemeExplorer from '$lib/theme/ThemeExplorer.svelte';
	import type { ThemeState } from '$lib/theme/state.svelte';

	let { entries = [], activeHref, theme }: { entries?: NavigationEntry[]; activeHref?: string; theme?: ThemeState } = $props();
	let navigationState = $state({ expanded: true });

	function toggleExpanded() {
		navigationState.expanded = !navigationState.expanded;
	}

	const safeHref = (href: string) => href.startsWith('/') && !href.startsWith('//') ? href : '/';
	const safeThumbnail = (thumbnail?: string) => thumbnail && thumbnail.startsWith('/') && !thumbnail.startsWith('//') ? thumbnail : undefined;
	const dateLabel = (date?: NavigationEntry['date']) => {
		if (!date) return undefined;
		const start = date.start.slice(0, 10);
		const end = date.end.slice(0, 10);
		return start === end ? start : `${start} — ${end}`;
	};
</script>

<aside class:collapsed={!navigationState.expanded} class="page-navigation" aria-label="Published journeys">
	<header class="navigation-header">
		{#if navigationState.expanded}<h2>Journeys</h2>{/if}
		<button class="collapse" type="button" aria-label={navigationState.expanded ? 'Collapse journeys' : 'Expand journeys'} aria-expanded={navigationState.expanded} onclick={toggleExpanded}>
			<span aria-hidden="true">{navigationState.expanded ? '←' : '→'}</span>
		</button>
	</header>
	{#if navigationState.expanded}
		<nav aria-label="Journey pages">
			<ul>
				{#each entries as entry (entry.href)}
					<li>
						<a class:active={safeHref(entry.href) === activeHref} href={resolve(safeHref(entry.href) as any)} aria-current={safeHref(entry.href) === activeHref ? 'page' : undefined}>
							{#if safeThumbnail(entry.thumbnail)}<img src={safeThumbnail(entry.thumbnail)} alt="" loading="lazy" />{/if}
							<span class="entry-copy"><strong>{entry.title}</strong>{#if dateLabel(entry.date)}<small>{dateLabel(entry.date)}</small>{/if}</span>
						</a>
					</li>
				{/each}
			</ul>
		</nav>
		{#if theme}<ThemeExplorer {theme} selectId="desktop-theme-choice" />{/if}
	{/if}
</aside>

<style>
	.page-navigation { width: 280px; flex: 0 0 280px; min-height: 100svh; padding: 24px 16px; color: var(--theme-text); background: var(--theme-nav-bg); transition: width 180ms ease, flex-basis 180ms ease; }
	.page-navigation.collapsed { width: 64px; flex-basis: 64px; }
	.navigation-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 20px; }
	h2 { margin: 0; font: 600 14px/1.3 ui-sans-serif, system-ui, sans-serif; letter-spacing: .08em; text-transform: uppercase; }
	.collapse { min-width: 44px; min-height: 44px; border: 1px solid var(--theme-rule, #b7b0a5); color: inherit; background: var(--theme-control-bg); cursor: pointer; }
	.collapse:focus-visible, a:focus-visible { outline: 3px solid var(--theme-accent, #c96b4b); outline-offset: 3px; }
	ul { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
	a { display: flex; align-items: center; gap: 10px; min-height: 60px; padding: 8px; color: inherit; text-decoration: none; border-left: 3px solid transparent; }
	a.active { border-left-color: var(--theme-accent); background: var(--theme-surface); }
	a:hover { background: color-mix(in srgb, var(--theme-surface, #f6f3ee) 70%, transparent); }
	img { width: 48px; height: 48px; flex: 0 0 48px; object-fit: cover; background: var(--theme-rule, #d5cec2); }
	.entry-copy { min-width: 0; display: grid; gap: 3px; }
	strong, small { overflow-wrap: anywhere; }
	strong { font: 600 14px/1.25 ui-sans-serif, system-ui, sans-serif; }
	small { color: var(--theme-muted, #626860); font-size: 12px; }
	@media (max-width: 959px) { .page-navigation { display: none; } }
	@media (prefers-reduced-motion: reduce) { .page-navigation { transition: none; } }
</style>
