import { redactPathname } from '../../../hooks.server';
import type { DirectShareOutcome, MetadataFailureReason } from '../immich/types';
import type { MapWarning } from '../map/types';

type OutcomeKind = DirectShareOutcome['kind'];

const statusByOutcome: Record<OutcomeKind, number> = {
	page: 200,
	'presentation-error': 422,
	'non-page': 404,
	'invalid-metadata': 422,
	'password-required': 401,
	unauthorized: 403,
	'not-found': 404,
	unsupported: 502,
	'upstream-error': 502
};

const statusCategory = (status: number) => {
	if (status >= 200 && status < 300) return 'success';
	if (status >= 400 && status < 500) return 'client-error';
	if (status >= 500 && status < 600) return 'server-error';
	return 'other';
};

export function logDirectShareOutcome({
	outcome,
	method,
	pathname,
	status,
	metadataReason
}: {
	outcome: OutcomeKind;
	method: string;
	pathname: string;
	status?: number;
	metadataReason?: MetadataFailureReason;
}) {
	const resolvedStatus = status ?? statusByOutcome[outcome];
	const fields = {
		event: 'direct-share.outcome',
		outcomeKind: outcome,
		status: resolvedStatus,
		statusCategory: statusCategory(resolvedStatus),
		method,
		pathname: redactPathname(pathname),
		...(metadataReason ? { metadataReason } : {})
	};
	console.info(JSON.stringify(fields));
}

export function logDirectShareBoundary({ phase, method, pathname, status }: { phase: 'start' | 'end'; method: string; pathname: string; status?: number }) {
	console.info(JSON.stringify({ event: `direct-share.request-${phase}`, method, pathname: redactPathname(pathname), ...(status === undefined ? {} : { status, statusCategory: statusCategory(status) }) }));
}

export function logImmichRequest({ endpoint, status, failureCategory }: { endpoint: 'shared-link' | 'album-assets' | 'thumbnail' | 'video' | 'version' | 'map-markers' | 'current-user' | 'albums' | 'album'; status: number | 'failure'; failureCategory?: 'timeout' | 'network' | 'response-too-large' | 'invalid-response' }) {
	console.info(JSON.stringify({ event: 'direct-share.immich-request', endpoint, status, ...(failureCategory ? { failureCategory } : {}) }));
}

export function logImmichRedirect({ endpoint, classification }: { endpoint: 'thumbnail' | 'video'; classification: 'same-origin-allowed' | 'external' | 'original-or-download' | 'other' | 'missing' }) {
	console.info(JSON.stringify({ event: 'direct-share.immich-redirect', endpoint, classification }));
}

export function logMapMarkersResponse({ normalizedCount }: { normalizedCount: number }) {
	console.info(JSON.stringify({ event: 'direct-share.map-markers-response', normalizedCount }));
}

type RouteAdapter = 'auto' | 'waypoints' | 'geojson' | 'brouter-web';
type RouteDiagnosticCategory = 'resolved' | 'unsupported-profile' | 'malformed-route' | 'endpoint-configuration' | 'timeout' | 'upstream-failure' | 'response-limit';

const routeCategoryByWarning: Partial<Record<MapWarning, RouteDiagnosticCategory>> = {
	'brouter-profile-unsupported': 'unsupported-profile',
	'brouter-permalink-invalid': 'malformed-route',
	'brouter-permalink-unsupported': 'malformed-route',
	'map-route-invalid': 'malformed-route',
	'brouter-endpoint-unsafe': 'endpoint-configuration',
	'brouter-timeout': 'timeout',
	'brouter-request-failed': 'upstream-failure',
	'brouter-response-invalid': 'upstream-failure',
	'brouter-response-too-large': 'response-limit',
	'map-route-limit': 'response-limit',
	'map-source-unsupported': 'malformed-route'
};

export function logMapRouteResult({ adapter, warnings, durationMs }: { adapter: RouteAdapter; warnings: readonly MapWarning[]; durationMs: number }) {
	const category = warnings.map((warning) => routeCategoryByWarning[warning]).find((value): value is RouteDiagnosticCategory => Boolean(value)) ?? 'resolved';
	const safeDurationMs = Number.isFinite(durationMs) ? Math.max(0, Math.min(60_000, Math.trunc(durationMs))) : 0;
	console.info(JSON.stringify({ event: 'direct-share.route-result', adapter, category, durationMs: safeDurationMs }));
}

export function logAlbumAssetsRequest({ status, failureCategory }: { status: number | 'failure'; failureCategory?: 'timeout' | 'network' | 'response-too-large' | 'invalid-response' }) {
	console.info(JSON.stringify({ event: 'direct-share.album-assets-request', status, ...(failureCategory ? { failureCategory } : {}) }));
}

export function logAlbumAssetsResponse({ declaredCount, normalizedCount }: { declaredCount: number; normalizedCount: number }) {
	console.info(JSON.stringify({ event: 'direct-share.album-assets-response', declaredCount, normalizedCount }));
}

export function logSharedLinkResponse({ type, topLevelAssetCount, nestedAlbumAssetCount, normalizedAssetCount }: { type: 'ALBUM' | 'INDIVIDUAL'; topLevelAssetCount: number; nestedAlbumAssetCount: number; normalizedAssetCount: number }) {
	console.info(JSON.stringify({ event: 'direct-share.response-parsed', type, topLevelAssetCount, nestedAlbumAssetCount, normalizedAssetCount }));
}

export function logMetadataParse({ result, reason }: { result: 'absent' | 'unrelated' | 'valid' | 'invalid'; reason?: MetadataFailureReason }) {
	console.info(JSON.stringify({ event: 'direct-share.metadata-parse', result, ...(reason ? { reason } : {}) }));
}

export function logModelOutput({ assetCount, imageCount, videoCount, heroPresent, markerCount, routeReady }: { assetCount: number; imageCount: number; videoCount: number; heroPresent: boolean; markerCount: number; routeReady: boolean }) {
	console.info(JSON.stringify({ event: 'direct-share.model-output', assetCount, imageCount, videoCount, heroPresent, markerCount, routeReady }));
}

export function logShareAssetProjection({ requestId, type, topLevelAssetCount, nestedAlbumAssetCount, normalizedAssetCount, heroSelection }: {
	requestId?: string;
	type: 'ALBUM' | 'INDIVIDUAL';
	topLevelAssetCount: number;
	nestedAlbumAssetCount: number;
	normalizedAssetCount: number;
	heroSelection?: 'configured-filename' | 'configured-asset-id' | 'album-cover' | 'first-asset' | 'none';
}) {
	console.info(JSON.stringify({ event: 'direct-share.asset-projection', ...(requestId ? { requestId } : {}), type, topLevelAssetCount, nestedAlbumAssetCount, normalizedAssetCount, ...(heroSelection ? { heroSelection } : {}) }));
}

export function logShareMediaStatus({ media, status, statusCode, contentType, byteLength, failureCategory, failureReason, failureDetail }: { media: 'thumbnail' | 'video' | 'fullsize'; status: 'success' | 'failure'; statusCode?: number; contentType?: string; byteLength?: number; failureCategory?: 'unauthorized' | 'not-found' | 'upstream' | 'conversion' | 'oversized' | 'invalid-range'; failureReason?: 'read' | 'primary-decode' | 'gain-map-missing' | 'gain-map-decode' | 'metadata-invalid' | 'png-encode' | 'ffmpeg' | 'compositor-timeout' | 'ffmpeg-timeout' | 'compositor-spawn' | 'ffmpeg-spawn' | 'compositor-exit' | 'ffmpeg-exit' | 'unknown'; failureDetail?: string }) {
  console.info(JSON.stringify({ event: `direct-share.${media}`, status, ...(statusCode === undefined ? {} : { statusCode: Math.max(0, Math.min(999, Math.trunc(statusCode))) }), ...(contentType ? { contentType: contentType.split(';', 1)[0]?.trim().slice(0, 64) } : {}), ...(byteLength === undefined ? {} : { byteLength: Math.max(0, Math.min(10 * 1024 * 1024, Math.trunc(byteLength))) }), ...(failureCategory ? { failureCategory } : {}), ...(failureReason ? { failureReason } : {}), ...(failureDetail ? { failureDetail: failureDetail.slice(0, 160) } : {}) }));
}

export function logShareHeroSelection({ selection }: { selection: 'configured-filename' | 'configured-asset-id' | 'album-cover' | 'first-asset' | 'none' }) {
	console.info(JSON.stringify({ event: 'direct-share.hero-selection', selection }));
}

export function logVisitedShareRegistry({ phase, result, entryCount }: {
	phase: 'register' | 'decode';
	result: 'success' | 'unavailable' | 'empty';
	entryCount?: number;
}) {
	console.info(JSON.stringify({ event: 'direct-share.visited-share-registry', phase, result, ...(entryCount === undefined ? {} : { entryCount }) }));
}
