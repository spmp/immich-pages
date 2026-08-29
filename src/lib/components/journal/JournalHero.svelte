<script lang="ts">
	import { onMount } from 'svelte';
	import type { NormalizedPageModel } from '$server/presentation/model';

	let { title, hero, date, onExplore }: {
		title: string;
		hero: NormalizedPageModel['hero'];
		date?: { start: string; end: string };
		onExplore: () => void;
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
</script>

<header class="hero" aria-labelledby="page-title">
	{#if hero}
		<img class="hero-image" src={hero.thumbnail} alt="" fetchpriority="high" />
	{:else}
		<div class="hero-fallback" aria-hidden="true"></div>
	{/if}
	<div class="hero-shade" aria-hidden="true"></div>
	<div class="hero-copy">
		<p class="eyebrow">Journey gallery</p>
		<h1 id="page-title">{title}</h1>
		{#if dateIso && endDateIso}<p class="date" aria-label="Journey dates" data-date-iso={date?.start}><span class="date-value">{dateLabel ?? (dateIso === endDateIso ? dateIso : `${dateIso} — ${endDateIso}`)}</span></p>{/if}
		<button class="explore" type="button" onclick={onExplore}>Explore the gallery</button>
	</div>
</header>

<style>
	.hero { position: relative; min-height: 56svh; max-height: 520px; display: grid; align-items: end; overflow: hidden; color: #fffdf8; background: #202522; }
	.hero-image, .hero-fallback, .hero-shade { position: absolute; inset: 0; width: 100%; height: 100%; }
	.hero-image { display: block; object-fit: cover; }
	.hero-fallback { background: #626860; }
	.hero-shade { background: linear-gradient(180deg, rgba(32, 37, 34, 0.05) 25%, rgba(32, 37, 34, 0.94) 100%); }
	.hero-copy { position: relative; z-index: 1; width: min(100%, 1280px); margin: 0 auto; padding: 32px 16px; }
	.eyebrow, .date { margin: 0 0 8px; font-size: 14px; line-height: 1.3; font-weight: 600; }
	.date { margin-top: 8px; margin-bottom: 24px; font-variant-numeric: tabular-nums; }
	h1 { max-width: 18ch; margin: 0; overflow-wrap: anywhere; font: 400 clamp(36px, 6vw, 48px)/1.05 ui-serif, Georgia, serif; }
	.explore { min-height: 44px; margin-top: 24px; padding: 8px 16px; border: 0; border-radius: 2px; color: #fffdf8; background: #c96b4b; font: 600 14px/1.3 ui-sans-serif, system-ui, sans-serif; cursor: pointer; }
	.explore:focus-visible { outline: 3px solid #fffdf8; outline-offset: 4px; }
	@media (min-width: 640px) { .hero { min-height: 60svh; max-height: none; } .hero-copy { padding: 48px 24px; } }
	@media (min-width: 960px) { .hero-copy { padding-left: 32px; padding-right: 32px; } }
	@media (min-width: 1200px) { .hero { max-height: 720px; } .hero-copy { padding-left: 48px; padding-right: 48px; } }
	@media (prefers-reduced-motion: reduce) { .explore { transition: none; } }
</style>
