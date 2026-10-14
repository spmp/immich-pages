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
	.prose :global(a) { color: var(--theme-text); text-decoration: underline; text-decoration-color: var(--theme-rule); text-decoration-thickness: 2px; text-underline-offset: 3px; }
	.prose :global(a):focus-visible { outline: 3px solid var(--theme-focus); outline-offset: 3px; }
	.prose :global(blockquote) { padding-left: 16px; border-left: 4px solid var(--theme-rule); color: var(--theme-muted); }
	/* LaTeX maths arrives as MathML (presentation/markdown.ts) and is drawn by the browser itself.
	   Fences only stretch and accents only sit right in a font with an OpenType MATH table, and the
	   generic 'math' family can resolve to one without; these are the ones platforms actually ship,
	   all local -- nothing is downloaded. */
	.prose :global(math) { font-family: 'STIX Two Math', 'Cambria Math', 'Latin Modern Math', 'Noto Sans Math', 'DejaVu Math TeX Gyre', math; }
	.prose :global(math[display='block']) { margin: 16px 0; overflow-x: auto; overflow-y: hidden; }
	/* Chromium implements MathML Core, which has no columnalign: emulate the patterns KaTeX emits.
	   aligned/alignat: right, left, right, left... An align block adds an empty 'glue' column first,
	   which shifts the pattern by one. cases: left throughout. Safari and Firefox honour the
	   attribute natively, and these rules agree with it. */
	.prose :global(mtable[columnalign^='right'] > mtr > mtd:nth-child(odd)) { text-align: right; }
	.prose :global(mtable[columnalign^='right'] > mtr > mtd:nth-child(even)) { text-align: left; }
	.prose :global(mtable[columnalign^='right'] > mtr:has(> mtd.mtr-glue) > mtd:nth-child(even)) { text-align: right; }
	.prose :global(mtable[columnalign^='right'] > mtr:has(> mtd.mtr-glue) > mtd:nth-child(odd)) { text-align: left; }
	.prose :global(mtable[columnalign^='left'] > mtr > mtd) { text-align: left; }
	.prose :global(mtd.mtr-glue) { width: 50%; }
	@media (min-width: 640px) { .narrative { padding-left: 24px; padding-right: 24px; max-width: 688px; } }
	@media (min-width: 960px) { .narrative { max-width: 784px; padding-left: 32px; padding-right: 32px; } }
	@media (min-width: 1200px) { .narrative { padding-left: 48px; padding-right: 48px; } }
</style>
