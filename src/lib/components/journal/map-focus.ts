export type MarkerActivation = 'gallery' | 'lightbox';

/** Move map selection into the already-rendered, authorized gallery. */
export function focusGalleryAsset(assetId: string, allowedIds: ReadonlySet<string> | readonly string[], activation: MarkerActivation = 'gallery'): boolean {
	const allowed = allowedIds instanceof Set ? allowedIds.has(assetId) : allowedIds.includes(assetId);
	if (!allowed || typeof document === 'undefined') return false;
	const figure = document.getElementById(`asset-${assetId}`);
	if (!figure) return false;
	window.location.hash = `asset-${assetId}`;
	figure.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
	if (!figure.hasAttribute('tabindex')) figure.setAttribute('tabindex', '-1');
	figure.focus({ preventScroll: true });
	figure.classList.remove('map-focus-highlight');
	void figure.offsetWidth;
	figure.classList.add('map-focus-highlight');
	window.setTimeout(() => figure.classList.remove('map-focus-highlight'), 2200);
	if (activation === 'lightbox') figure.querySelector<HTMLAnchorElement>('a')?.click();
	return true;
}
