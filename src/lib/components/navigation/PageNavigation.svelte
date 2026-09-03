<script lang="ts">
	import type { NavigationEntry } from '$server/library/model';
	import { resolve } from '$app/paths';

	let { entries = [], activeHref }: { entries?: NavigationEntry[]; activeHref?: string } = $props();
	let expanded = $state(true);

	const safeHref = (href: string) => href.startsWith('/') && !href.startsWith('//') ? href : '/';
	const safeThumbnail = (thumbnail?: string) => thumbnail && thumbnail.startsWith('/') && !thumbnail.startsWith('//') ? thumbnail : undefined;
	const dateLabel = (date?: NavigationEntry['date']) => {
		if (!date) return undefined;
		const start = date.start.slice(0, 10);
		const end = date.end.slice(0, 10);
		return start === end ? start : `${start} — ${end}`;
	};
</script>

<aside class:collapsed={!expanded} class="page-navigation" aria-label="Published journeys">
	<header class="navigation-header">
		{#if expanded}<h2>Journeys</h2>{/if}
		<button class="collapse" type="button" aria-label={expanded ? 'Collapse journeys' : 'Expand journeys'} aria-expanded={expanded} onclick={() => expanded = !expanded}>
			<span aria-hidden="true">{expanded ? '←' : '→'}</span>
		</button>
	</header>
	{#if expanded}
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
	{/if}
</aside>

<style>
	.page-navigation { width: 280px; flex: 0 0 280px; min-height: 100svh; padding: 24px 16px; color: #202522; background: #ebe6dd; transition: width 180ms ease, flex-basis 180ms ease; }
	.page-navigation.collapsed { width: 64px; flex-basis: 64px; }
	.navigation-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 20px; }
	h2 { margin: 0; font: 600 14px/1.3 ui-sans-serif, system-ui, sans-serif; letter-spacing: .08em; text-transform: uppercase; }
	.collapse { min-width: 44px; min-height: 44px; border: 1px solid #b7b0a5; color: #202522; background: transparent; cursor: pointer; }
	.collapse:focus-visible, a:focus-visible { outline: 3px solid #c96b4b; outline-offset: 3px; }
	ul { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
	a { display: flex; align-items: center; gap: 10px; min-height: 60px; padding: 8px; color: inherit; text-decoration: none; border-left: 3px solid transparent; }
	a.active { border-left-color: #c96b4b; background: #f6f3ee; }
	a:hover { background: rgba(246, 243, 238, .7); }
	img { width: 48px; height: 48px; flex: 0 0 48px; object-fit: cover; background: #d5cec2; }
	.entry-copy { min-width: 0; display: grid; gap: 3px; }
	strong, small { overflow-wrap: anywhere; }
	strong { font: 600 14px/1.25 ui-sans-serif, system-ui, sans-serif; }
	small { color: #626860; font-size: 12px; }
	@media (max-width: 959px) { .page-navigation { display: none; } }
	@media (prefers-reduced-motion: reduce) { .page-navigation { transition: none; } }
</style>
