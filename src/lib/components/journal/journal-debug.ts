import { env } from '$env/dynamic/public';

type JournalDebugEvent = 'page-model-load' | 'hero-load' | 'media-load' | 'media-failure' | 'gallery-state' | 'fallback' | 'empty' | 'lightbox' | 'presentation-state';
type JournalDebugDetails = {
	category?: 'image' | 'video' | 'hero' | 'gallery';
	status?: 'success' | 'failure' | 'initialized' | 'opened' | 'closed' | 'unavailable' | 'empty' | 'fallback' | 'invalid' | 'temporary';
	assetCount?: number;
	heroPresent?: boolean;
	template?: 'journal';
	errorContext?: 'page-model' | 'hero-load' | 'gallery-load' | 'image-load' | 'video-load' | 'lightbox-load';
	imageCount?: number;
	videoCount?: number;
};

const enabled = env.PUBLIC_PAGES_DEBUG !== 'false';
const counts = new Map<JournalDebugEvent, number>();

/** Emit only bounded, allowlisted browser diagnostics for review deployments. */
export function reportJournalDebug(event: JournalDebugEvent, details: JournalDebugDetails = {}): void {
	if (!enabled) return;

	const count = Math.min((counts.get(event) ?? 0) + 1, 99);
	counts.set(event, count);
	console.info('[immich-pages-debug]', JSON.stringify({
		event,
		count,
		...(details.category ? { category: details.category } : {}),
		...(details.status ? { status: details.status } : {}),
		...(details.assetCount === undefined ? {} : { assetCount: Math.max(0, Math.min(10000, Math.floor(details.assetCount))) }),
		...(details.heroPresent === undefined ? {} : { heroPresent: details.heroPresent }),
		...(details.template ? { template: details.template } : {}),
		...(details.errorContext ? { errorContext: details.errorContext } : {}),
		...(details.imageCount === undefined ? {} : { imageCount: Math.max(0, Math.min(10000, Math.floor(details.imageCount))) }),
		...(details.videoCount === undefined ? {} : { videoCount: Math.max(0, Math.min(10000, Math.floor(details.videoCount))) })
	}));
}
