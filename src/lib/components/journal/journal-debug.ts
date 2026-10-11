import { env } from '$env/dynamic/public';

type JournalDebugEvent = 'page-model-load' | 'hero-load' | 'media-load' | 'media-failure' | 'media-resolution' | 'gallery-state' | 'fallback' | 'empty' | 'lightbox' | 'presentation-state' | 'route-failure' | 'hdr-prewarm' | 'hdr-media';
type JournalDebugDetails = {
	category?: 'image' | 'video' | 'hero' | 'gallery';
	status?: 'success' | 'failure' | 'initialized' | 'opened' | 'closed' | 'unavailable' | 'empty' | 'fallback' | 'invalid' | 'temporary' | 'started' | 'ended' | 'loading' | 'ready' | 'changed' | 'promoted' | 'given-up';
	decision?: 'thumbnail' | 'fullsize';
	slotWidth?: number;
	intrinsicWidth?: number | null;
	dpr?: number;
	requiredWidth?: number;
	layoutMeasured?: boolean;
	measuringCompleted?: boolean;
	fullsizeAvailable?: boolean;
	promotionFailed?: boolean;
	fallbackActive?: boolean;
	assetCount?: number;
	heroPresent?: boolean;
	template?: 'journal';
	errorContext?: 'page-model' | 'hero-load' | 'gallery-load' | 'image-load' | 'video-load' | 'video-playback' | 'lightbox-load';
	failureCategory?: 'http' | 'network' | 'timeout' | 'decode' | 'playback' | 'unsupported-metadata';
	statusCode?: number;
	durationMs?: number;
	imageCount?: number;
	videoCount?: number;
	assetIndex?: number;
	assetTotal?: number;
	urlKind?: 'hdr-video' | 'hdr-avif' | 'fullsize';
	requestPhase?: 'start' | 'end' | 'schedule' | 'reuse';
	bytes?: number | null;
	cacheReuse?: boolean;
	prewarmReuse?: boolean;
	photoSwipeType?: 'image' | 'video' | 'hdr-image';
	srcKind?: 'thumbnail' | 'fullsize' | 'hdr-video' | 'hdr-avif' | 'unknown';
	spinner?: 'start' | 'stop';
	hdrReason?: 'image-load' | 'video-load' | 'video-playback' | 'timeout' | 'cached' | 'unsupported' | 'unknown';
	nativeErrorCode?: number | null;
	slideIndex?: number;
	slideTotal?: number;
	routeWarning?: 'brouter-profile-unsupported' | 'brouter-endpoint-unsafe' | 'brouter-timeout' | 'brouter-response-too-large' | 'map-route-limit' | 'brouter-route-rejected' | 'brouter-request-failed' | 'brouter-response-invalid' | 'map-route-invalid' | 'brouter-permalink-invalid' | 'brouter-permalink-unsupported' | 'map-source-unsupported';
	routeAction?: 'check-profile' | 'check-endpoint' | 'check-road-access' | 'reduce-route-size' | 'check-permalink' | 'check-map-source';
	// hdr-caching-uat-20261010 finding 6c: the readiness control-plane's own decision-making,
	// relayed to the server so a stuck/incorrect dot can be debugged from server logs alone.
	// Deliberately NO asset ID anywhere here -- this file's own documented convention (see the
	// comment on the forwarding fetch below) is that no asset IDs cross this boundary client-side.
	readinessState?: 'idle' | 'unsupported' | 'empty' | 'preparing' | 'ready' | 'partial';
	targeted?: number;
	completed?: number;
	failed?: number;
	skipped?: number;
	activeAssetState?: 'ineligible' | 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'unavailable';
};

export const journalDebugEnabled = env.PUBLIC_PAGES_DEBUG === 'true';
const counts = new Map<JournalDebugEvent, number>();
const serverCounts = new Map<JournalDebugEvent, number>();
const clientSession = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);

/** Emit only bounded, allowlisted browser diagnostics for review deployments. */
export function reportJournalDebug(event: JournalDebugEvent, details: JournalDebugDetails = {}): void {
	if (!journalDebugEnabled) return;

	const count = Math.min((counts.get(event) ?? 0) + 1, 99);
	counts.set(event, count);
	const payload = {
		event,
		count,
		...(details.category ? { category: details.category } : {}),
		...(details.status ? { status: details.status } : {}),
		...(details.decision ? { decision: details.decision } : {}),
		...(details.slotWidth === undefined ? {} : { slotWidth: boundedDimension(details.slotWidth) }),
		...(details.intrinsicWidth === undefined ? {} : { intrinsicWidth: boundedDimension(details.intrinsicWidth) }),
		...(details.dpr === undefined ? {} : { dpr: boundedDpr(details.dpr) }),
		...(details.requiredWidth === undefined ? {} : { requiredWidth: boundedDimension(details.requiredWidth) }),
		...(details.layoutMeasured === undefined ? {} : { layoutMeasured: details.layoutMeasured }),
		...(details.measuringCompleted === undefined ? {} : { measuringCompleted: details.measuringCompleted }),
		...(details.fullsizeAvailable === undefined ? {} : { fullsizeAvailable: details.fullsizeAvailable }),
		...(details.promotionFailed === undefined ? {} : { promotionFailed: details.promotionFailed }),
		...(details.fallbackActive === undefined ? {} : { fallbackActive: details.fallbackActive }),
		...(details.assetCount === undefined ? {} : { assetCount: Math.max(0, Math.min(10000, Math.floor(details.assetCount))) }),
		...(details.heroPresent === undefined ? {} : { heroPresent: details.heroPresent }),
		...(details.template ? { template: details.template } : {}),
		...(details.errorContext ? { errorContext: details.errorContext } : {}),
		...(details.failureCategory ? { failureCategory: details.failureCategory } : {}),
		...(details.statusCode === undefined ? {} : { statusCode: Math.max(0, Math.min(599, Math.trunc(details.statusCode))) }),
		...(details.durationMs === undefined ? {} : { durationMs: Math.max(0, Math.min(120_000, Math.trunc(details.durationMs))) }),
		...(details.imageCount === undefined ? {} : { imageCount: Math.max(0, Math.min(10000, Math.floor(details.imageCount))) }),
		...(details.videoCount === undefined ? {} : { videoCount: Math.max(0, Math.min(10000, Math.floor(details.videoCount))) }),
		...(details.assetIndex === undefined ? {} : { assetIndex: Math.max(0, Math.min(10000, Math.floor(details.assetIndex))) }),
		...(details.assetTotal === undefined ? {} : { assetTotal: Math.max(0, Math.min(10000, Math.floor(details.assetTotal))) }),
		...(details.urlKind ? { urlKind: details.urlKind } : {}),
		...(details.requestPhase ? { requestPhase: details.requestPhase } : {}),
		...(details.bytes === undefined ? {} : { bytes: details.bytes === null ? null : Math.max(0, Math.min(100_000_000, Math.trunc(details.bytes))) }),
		...(details.cacheReuse === undefined ? {} : { cacheReuse: details.cacheReuse }),
		...(details.prewarmReuse === undefined ? {} : { prewarmReuse: details.prewarmReuse }),
		...(details.photoSwipeType ? { photoSwipeType: details.photoSwipeType } : {}),
		...(details.srcKind ? { srcKind: details.srcKind } : {}),
		...(details.spinner ? { spinner: details.spinner } : {}),
		...(details.hdrReason ? { hdrReason: details.hdrReason } : {}),
		...(details.nativeErrorCode === undefined ? {} : { nativeErrorCode: details.nativeErrorCode === null ? null : Math.max(0, Math.min(4, Math.trunc(details.nativeErrorCode))) }),
		...(details.slideIndex === undefined ? {} : { slideIndex: Math.max(0, Math.min(10000, Math.floor(details.slideIndex))) }),
		...(details.slideTotal === undefined ? {} : { slideTotal: Math.max(0, Math.min(10000, Math.floor(details.slideTotal))) }),
		...(details.routeWarning ? { routeWarning: details.routeWarning } : {}),
		...(details.routeAction ? { routeAction: details.routeAction } : {}),
		...(details.readinessState ? { readinessState: details.readinessState } : {}),
		...(details.targeted === undefined ? {} : { targeted: Math.max(0, Math.min(10000, Math.floor(details.targeted))) }),
		...(details.completed === undefined ? {} : { completed: Math.max(0, Math.min(10000, Math.floor(details.completed))) }),
		...(details.failed === undefined ? {} : { failed: Math.max(0, Math.min(10000, Math.floor(details.failed))) }),
		...(details.skipped === undefined ? {} : { skipped: Math.max(0, Math.min(10000, Math.floor(details.skipped))) }),
		...(details.activeAssetState ? { activeAssetState: details.activeAssetState } : {})
	};
	console.info('[immich-pages-debug]', JSON.stringify(payload));
	// Browser console output is not present in the server/container log. Forward only the first
	// bounded set of each event while debug is explicitly enabled, with no URLs, asset IDs, or
	// request headers, so server logs can correlate decode/playback outcomes with media responses.
	const serverCount = serverCounts.get(event) ?? 0;
	if (serverCount < 200 && typeof fetch === 'function') {
		serverCounts.set(event, serverCount + 1);
		void fetch('/debug/client', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...payload, clientSession }), keepalive: true }).catch(() => {});
	}
}

function boundedDimension(value: number | null): number | null {
	if (value === null || !Number.isFinite(value)) return null;
	return Math.max(0, Math.min(100000, Math.round(value)));
}

function boundedDpr(value: number): number {
	return Math.max(0, Math.min(10, Math.round(value * 100) / 100));
}
