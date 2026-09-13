<script lang="ts">
	let { html }: { html: string } = $props();
</script>

<article class="narrative" aria-label="The journey">
	<div class="prose">{@html html}</div>
</article>

<style>
	.narrative { max-width: 720px; margin: 0 auto; padding: 48px 16px; }
	.prose { color: var(--theme-text); font: 400 16px/1.5 var(--theme-font-body); overflow-wrap: anywhere; }
	.prose :global(p), .prose :global(ul), .prose :global(ol), .prose :global(blockquote) { margin: 0 0 16px; }
	.prose :global(h1), .prose :global(h2), .prose :global(h3) { margin: 24px 0 8px; font: 600 20px/1.2 ui-serif, Georgia, serif; }
	.prose :global(a) { color: var(--theme-text); text-decoration: underline; }
	.prose :global(blockquote) { padding-left: 16px; border-left: 4px solid var(--theme-rule); color: var(--theme-muted); }
	@media (min-width: 640px) { .narrative { padding-left: 24px; padding-right: 24px; max-width: 688px; } }
	@media (min-width: 960px) { .narrative { max-width: 784px; padding-left: 32px; padding-right: 32px; } }
	@media (min-width: 1200px) { .narrative { padding-left: 48px; padding-right: 48px; } }
</style>
