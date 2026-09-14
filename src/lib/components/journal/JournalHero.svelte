<script lang="ts">
import { onMount } from 'svelte';
import type { Snippet } from 'svelte';
	import type { NormalizedPageModel } from '$server/presentation/model';
	import { reportJournalDebug } from './journal-debug';

	let { title, hero, date, mobileNavigation }: {
		title: string;
		hero: NormalizedPageModel['hero'];
		date?: { start: string; end: string };
		mobileNavigation?: Snippet;
	} = $props();

	function stableDate(value: string): string | undefined {
		const parsed = new Date(value);
		return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
	}

	const dateIso = $derived(date ? stableDate(date.start) : undefined);
	const endDateIso = $derived(date ? stableDate(date.end) : undefined);
	let dateLabel = $state<string | undefined>();

	onMount(() => {
		if (!dateIso || !endDateIso) return;
		const formatter = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
		const start = formatter.format(new Date(`${dateIso}T00:00:00.000Z`));
		const end = formatter.format(new Date(`${endDateIso}T00:00:00.000Z`));
		dateLabel = dateIso === endDateIso ? start : `${start} — ${end}`;
	});

	function reportHero(status: 'success' | 'failure') {
		reportJournalDebug('hero-load', { category: 'hero', status, ...(status === 'failure' ? { errorContext: 'hero-load' as const } : {}) });
	}
</script>

<header class="hero" aria-labelledby="page-title">
	{#if mobileNavigation}{@render mobileNavigation()}{/if}
	{#if hero}
		<img class="hero-image" src={hero.thumbnail} alt="" fetchpriority="high" onload={() => reportHero('success')} onerror={() => reportHero('failure')} />
	{:else}
		<div class="hero-fallback" aria-hidden="true"></div>
	{/if}
	<div class="hero-shade" aria-hidden="true"></div>
	<div class="hero-copy">
		{#if !hero}<p class="eyebrow">Journey gallery</p>{/if}
		<h1 id="page-title">{title}</h1>
		{#if dateIso && endDateIso}<p class="date" aria-label="Journey dates" data-date-iso={date?.start}><span class="date-value">{dateLabel ?? (dateIso === endDateIso ? dateIso : `${dateIso} — ${endDateIso}`)}</span></p>{/if}
	</div>
</header>

<style>
	.hero { position: relative; min-height: 56svh; max-height: 520px; display: grid; align-items: end; overflow: hidden; color: var(--theme-hero-text, var(--theme-surface)); background: var(--theme-bg); }
	.hero-image, .hero-fallback, .hero-shade { position: absolute; inset: 0; width: 100%; height: 100%; }
	.hero-image { display: block; object-fit: cover; }
	.hero-fallback { background: var(--theme-gradient); }
	.hero-shade { background: linear-gradient(180deg, color-mix(in srgb, var(--theme-overlay) 5%, transparent) 25%, color-mix(in srgb, var(--theme-overlay) 94%, transparent) 100%); }
	.hero-copy { position: relative; z-index: 1; width: min(100%, 1280px); margin: 0 auto; padding: 32px 16px; }
	.eyebrow, .date { margin: 0 0 8px; font-size: 14px; line-height: 1.3; font-weight: 600; }
	.date { margin-top: 8px; margin-bottom: 24px; font-variant-numeric: tabular-nums; }
	h1 { max-width: 18ch; margin: 0; overflow-wrap: anywhere; font: 400 clamp(36px, 6vw, 48px)/1.05 ui-serif, Georgia, serif; }
	@media (min-width: 640px) { .hero { min-height: 60svh; max-height: none; } .hero-copy { padding: 48px 24px; } }
	@media (min-width: 960px) { .hero-copy { padding-left: 32px; padding-right: 32px; } }
	@media (min-width: 1200px) { .hero { max-height: 720px; } .hero-copy { padding-left: 48px; padding-right: 48px; } }
</style>
