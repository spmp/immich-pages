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
	requestId,
	outcome,
	method,
	pathname,
	status,
	metadataReason
}: {
	requestId: string;
	outcome: OutcomeKind;
	method: string;
	pathname: string;
	status?: number;
	metadataReason?: MetadataFailureReason;
}) {
	const resolvedStatus = status ?? statusByOutcome[outcome];
	const fields = {
		event: 'direct-share.outcome',
		requestId,
		outcomeKind: outcome,
		status: resolvedStatus,
		statusCategory: statusCategory(resolvedStatus),
		method,
		pathname: redactPathname(pathname),
		...(metadataReason ? { metadataReason } : {})
	};
	console.info(JSON.stringify(fields));
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

export function logShareMediaStatus({ requestId, media, status }: { requestId: string; media: 'thumbnail' | 'video'; status: 'success' | 'unauthorized' | 'not-found' | 'upstream-error' }) {
	console.info(JSON.stringify({ event: `direct-share.${media}`, requestId, status }));
}

export function logShareHeroSelection({ requestId, selection }: { requestId: string; selection: 'configured-filename' | 'configured-asset-id' | 'album-cover' | 'first-asset' | 'none' }) {
	console.info(JSON.stringify({ event: 'direct-share.hero-selection', requestId, selection }));
}
