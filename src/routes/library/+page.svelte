<script lang="ts">
	import PageNavigation from '$lib/components/navigation/PageNavigation.svelte';
	import MobileDrawer from '$lib/components/navigation/MobileDrawer.svelte';
	import PresentationState from '$lib/components/journal/PresentationState.svelte';
	import { resolve } from '$app/paths';
	import type { NavigationEntry } from '$server/library/model';
	import { onMount } from 'svelte';
	import '$lib/styles/theme.css';
	import ThemeRoot from '$lib/components/journal/ThemeRoot.svelte';
	import { createThemeState } from '$lib/theme/state.svelte';

	let { data } = $props();
	const library = $derived(data.library);
	const theme = createThemeState();

	onMount(() => theme.hydrate());

	const safeHref = (href: string) => href.startsWith('/') && !href.startsWith('//') ? href : '/';
	const safeThumbnail = (thumbnail?: string) => thumbnail && thumbnail.startsWith('/') && !thumbnail.startsWith('//') ? thumbnail : undefined;
	const dateLabel = (date?: NavigationEntry['date']) => {
		if (!date) return undefined;
		const start = date.start.slice(0, 10);
		const end = date.end.slice(0, 10);
		return start === end ? start : `${start} — ${end}`;
	};
</script>

<svelte:head><title>Published journeys</title></svelte:head>


<ThemeRoot themeKey={theme.effectiveKey}>
{#if library.kind === 'ready'}
	<div class="library-shell">
		<PageNavigation entries={library.entries} {theme} />
		<div class="mobile-navigation"><MobileDrawer entries={library.entries} {theme} /></div>
		<main aria-labelledby="library-title">
			<header class="library-header">
				<p class="eyebrow">Immich Pages</p>
				<h1 id="library-title">Published journeys</h1>
				<p class="intro">Choose a journey to begin.</p>
			</header>
			{#if library.warnings.length}<p class="notice" role="status">Some journeys are temporarily unavailable.</p>{/if}
			<ul class="journey-grid" aria-label="Published journeys">
				{#each library.entries as entry, index (index)}
					<li>
						<a class="journey-card" href={resolve(safeHref(entry.href) as any)}>
							{#if safeThumbnail(entry.thumbnail)}
								<img src={safeThumbnail(entry.thumbnail)} alt="" loading="lazy" />
							{:else}
								<span class="thumbnail-placeholder" aria-hidden="true">✦</span>
							{/if}
							<span class="card-copy">
								<strong>{entry.title}</strong>
								{#if dateLabel(entry.date)}<small>{dateLabel(entry.date)}</small>{/if}
								<span class="card-action">Open journey <span aria-hidden="true">→</span></span>
							</span>
						</a>
					</li>
				{/each}
			</ul>
		</main>
	</div>
{:else if library.kind === 'access'}
	<PresentationState copy={{ heading: 'Your library is private', body: 'Open a shared journey in Pages to add it to your private library.', action: 'Try again' }} retryHref="." />
{:else if library.kind === 'empty'}
	<PresentationState copy={{ heading: 'No published journeys yet', body: 'Open a shared journey to add it to your private Pages library.', action: 'Try again' }} retryHref="." />
{:else}
	<PresentationState copy={{ heading: 'Your library is unavailable right now', body: 'Please try again in a moment.', action: 'Try again' }} retryHref="." />
{/if}
</ThemeRoot>

<style>
	.library-shell { min-height: 100svh; display: flex; color: var(--theme-text); background: var(--theme-gradient); }
	main { flex: 1; min-width: 0; padding: 64px clamp(24px, 7vw, 96px) 80px; }
	.library-header { display: grid; gap: 16px; max-width: 760px; }
	.eyebrow { margin: 0; color: var(--theme-accent); font: 600 13px/1.3 ui-sans-serif, system-ui, sans-serif; letter-spacing: .08em; text-transform: uppercase; }
	h1 { max-width: 14ch; margin: 0; font: 400 clamp(42px, 8vw, 84px)/.98 ui-serif, Georgia, serif; }
	.intro, .notice { max-width: 42ch; margin: 0; color: var(--theme-muted); }
	.notice { padding: 12px 16px; border-left: 3px solid var(--theme-accent); background: var(--theme-surface); }
	.journey-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr)); gap: 20px; max-width: 1100px; margin: 56px 0 0; padding: 0; list-style: none; }
	.journey-card { display: grid; min-height: 280px; color: inherit; text-decoration: none; background: var(--theme-card); border: 1px solid var(--theme-rule); border-radius: var(--theme-radius); transition: transform 180ms ease, box-shadow 180ms ease; }
	.journey-card:hover { transform: translateY(-3px); box-shadow: 0 14px 30px rgba(32, 37, 34, .12); }
	.journey-card:focus-visible { outline: 3px solid var(--theme-focus); outline-offset: 4px; }
	.journey-card img, .thumbnail-placeholder { width: 100%; height: 170px; object-fit: cover; background: var(--theme-rule); }
	.thumbnail-placeholder { display: grid; place-items: center; color: var(--theme-accent); font-size: 42px; }
	.card-copy { display: grid; align-content: start; gap: 8px; padding: 20px; }
	.card-copy strong { font: 400 27px/1.08 ui-serif, Georgia, serif; overflow-wrap: anywhere; }
	.card-copy small { color: var(--theme-muted); }
	.card-action { margin-top: 8px; color: var(--theme-accent); font: 600 12px/1.3 ui-sans-serif, system-ui, sans-serif; letter-spacing: .05em; text-transform: uppercase; }
	.mobile-navigation { display: none; position: fixed; z-index: 10; top: 16px; right: 16px; }
	@media (min-width: 640px) { main { padding-left: 32px; padding-right: 32px; } }
	@media (max-width: 959px) { .library-shell { display: block; } .mobile-navigation { display: block; } main { min-height: 100svh; padding-top: 96px; padding-bottom: 48px; } .journey-grid { margin-top: 40px; } }
	@media (min-width: 1200px) { main { padding-left: 48px; padding-right: 48px; } }
	@media (prefers-reduced-motion: reduce) { .journey-card { transform: none !important; transition: none; } }
</style>
