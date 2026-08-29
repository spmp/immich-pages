<script lang="ts">
	import { onMount } from 'svelte';
	import { reportJournalDebug } from './journal-debug';
	let { galleryId }: { galleryId: string } = $props();

	onMount(() => {
		let lightbox: { destroy: () => void } | undefined;
		let opener: HTMLElement | null = null;
		const previousOverflow = document.body.style.overflow;
		void (async () => {
			try {
				const { default: PhotoSwipeLightbox } = await import('photoswipe/lightbox');
				const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
				const instance = new PhotoSwipeLightbox({ gallery: `#${galleryId}`, children: 'a', pswpModule: () => import('photoswipe'), showHideAnimationType: reducedMotion ? 'none' : 'zoom' });
				lightbox = instance;
				instance.on('beforeOpen', () => { opener = document.activeElement as HTMLElement; document.body.style.overflow = 'hidden'; reportJournalDebug('lightbox', { status: 'opened' }); });
				instance.on('close', () => { document.body.style.overflow = previousOverflow; opener?.focus(); opener = null; reportJournalDebug('lightbox', { status: 'closed' }); });
				instance.init();
				reportJournalDebug('lightbox', { status: 'initialized' });
			} catch { reportJournalDebug('lightbox', { status: 'failure', errorContext: 'lightbox-load' }); }
		})();
		return () => { document.body.style.overflow = previousOverflow; lightbox?.destroy(); };
	});
</script>

<p class="sr-only" aria-live="polite">Images open in the full-screen viewer. Use Escape to close. <span aria-label="Close full-screen viewer"></span></p>

<style>.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }</style>
