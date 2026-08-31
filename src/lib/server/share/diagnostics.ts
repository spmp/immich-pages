import { redactPathname } from '../../../hooks.server';
import type { DirectShareOutcome, MetadataFailureReason } from '../immich/types';

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

export function logImmichRequest({ endpoint, status, failureCategory }: { endpoint: 'shared-link' | 'album-assets' | 'thumbnail' | 'video' | 'version' | 'map-markers'; status: number | 'failure'; failureCategory?: 'timeout' | 'network' | 'response-too-large' | 'invalid-response' }) {
	console.info(JSON.stringify({ event: 'direct-share.immich-request', endpoint, status, ...(failureCategory ? { failureCategory } : {}) }));
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

export function logModelOutput({ assetCount, imageCount, videoCount, heroPresent }: { assetCount: number; imageCount: number; videoCount: number; heroPresent: boolean }) {
	console.info(JSON.stringify({ event: 'direct-share.model-output', assetCount, imageCount, videoCount, heroPresent }));
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

export function logShareMediaStatus({ media, status, failureCategory }: { media: 'thumbnail' | 'video'; status: 'success' | 'failure'; failureCategory?: 'unauthorized' | 'not-found' | 'upstream' | 'oversized' | 'invalid-range' }) {
	console.info(JSON.stringify({ event: `direct-share.${media}`, status, ...(failureCategory ? { failureCategory } : {}) }));
}

export function logShareHeroSelection({ selection }: { selection: 'configured-filename' | 'configured-asset-id' | 'album-cover' | 'first-asset' | 'none' }) {
	console.info(JSON.stringify({ event: 'direct-share.hero-selection', selection }));
}
