import { env } from '$env/dynamic/public';

type JournalDebugEvent = 'media-failure' | 'fallback' | 'empty';
type JournalDebugDetails = {
	category?: 'image' | 'video' | 'hero' | 'gallery';
	status?: 'unavailable' | 'empty' | 'fallback';
};

const enabled = env.PUBLIC_PAGES_DEBUG === 'true';
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
		...(details.status ? { status: details.status } : {})
	}));
}
