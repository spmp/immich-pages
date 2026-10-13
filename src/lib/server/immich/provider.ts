import { readBoundedText, requestImmich, shareQuery } from './client';
import { AssetResponseSchema, MapMarkerResponseArraySchema, SearchResponseSchema, SharedLinkResponseSchema, type SharedLinkResponse } from './types';
import type { AuthContext } from './auth-context';
import { logAlbumAssetsRequest, logAlbumAssetsResponse, logMapMarkersResponse, logShareAssetProjectionMismatch, logSharedLinkResponse, logShareAssetProjection } from '$server/share/diagnostics';

export type ImmichProvider = {
	loginSharedLink: (context: AuthContext, password: string) => Promise<{ status: number; token?: string }>;
	getSharedLink: (context: AuthContext) => Promise<{ status: number; data?: SharedLinkResponse; error?: 'malformed' }>;
	getThumbnail: (context: AuthContext, assetId: string) => Promise<{ status: number; response?: Response; error?: 'malformed' | 'asset-mismatch' }>;
	getFullsizeImage: (context: AuthContext, assetId: string) => Promise<{ status: number; response?: Response; error?: 'malformed' | 'asset-mismatch' | 'not-image' }>;
	getVideoPlayback: (context: AuthContext, assetId: string, range?: string) => Promise<{ status: number; response?: Response; error?: 'malformed' | 'asset-mismatch' | 'not-video' }>;
	getMapMarkers: (context: AuthContext, albumId: string) => Promise<{ status: number; data?: unknown; error?: 'malformed' }>;
	getVersion: () => Promise<{ status: number; version?: string }>;
};

/**
 * The nested album projection is the only projection that carries album order -- but it is
 * reconciled against top-level membership, never trusted as-is (WR-01, REVIEW.md): the
 * returned list's ID set is always EXACTLY topLevel's, because data.assets after this call
 * feeds every downstream membership check in this file (e.g. getFullsizeImage's
 * share.data.assets.find(...)). An ID nested has but topLevel doesn't is dropped -- surfacing
 * an asset the share's own top-level list never declared would be an authorization-adjacent
 * leak, not just an ordering quirk. An ID topLevel has but nested omits is retained, appended
 * in topLevel's own relative order after the agreed intersection -- membership never narrows.
 */
export function selectAuthoritativeAlbumAssets<T extends { id: string }>(topLevel: readonly T[], nested: readonly T[] | undefined): readonly T[] {
	if (!nested || nested.length === 0) return topLevel;
	// An empty top-level `assets` is not "zero members" -- it's Immich (confirmed on both v3.1.0,
	// the original operator deployment, and v3.3.1 against a real server via
	// tests/e2e/real-immich/) simply not populating that field for ALBUM shares at all, with nested
	// album.assets as the only real membership/order source. There is nothing to reconcile
	// against; trust nested fully, exactly as before this fix (hdr-caching-uat-20261010's root
	// cause (1) depends on this exact path).
	if (topLevel.length === 0) return nested;
	const topLevelIds = new Set(topLevel.map((asset) => asset.id));
	const reconciled = nested.filter((asset) => topLevelIds.has(asset.id));
	const reconciledIds = new Set(reconciled.map((asset) => asset.id));
	const missingFromNested = topLevel.filter((asset) => !reconciledIds.has(asset.id));
	if (missingFromNested.length > 0 || reconciled.length !== nested.length) {
		logShareAssetProjectionMismatch({ topLevelCount: topLevel.length, nestedCount: nested.length, reconciledCount: reconciled.length + missingFromNested.length });
	}
	return [...reconciled, ...missingFromNested];
}

export function createImmichProvider(fetchImpl: typeof fetch = fetch, baseUrl = process.env.IMMICH_BASE_URL): ImmichProvider {
	if (!baseUrl) throw new Error('IMMICH_BASE_URL is required');
	return {
		async loginSharedLink(context, password) {
			const response = await requestImmich(baseUrl, `/api/shared-links/login?${shareQuery(context)}`, context, fetchImpl, { method: 'POST', body: JSON.stringify({ password }), headers: { 'content-type': 'application/json' }, endpoint: 'shared-link' });
			if (!response.ok) return { status: response.status };
			const cookie = response.headers.get('set-cookie');
			const token = cookie?.match(/(?:^|;\s*)immich_shared_link_token=([^;\s]+)/)?.[1];
			return token ? { status: response.status, token } : { status: 502 };
		},
		async getSharedLink(context) {
			const url = `/api/shared-links/me?${shareQuery(context)}`;
			const response = await requestImmich(baseUrl, url, context, fetchImpl, { endpoint: 'shared-link' });
			if (!response.ok) return { status: response.status };
			try {
				const parsed = SharedLinkResponseSchema.safeParse(JSON.parse(await readBoundedText(response)));
				if (!parsed.success) return { status: 422, error: 'malformed' };
				let data = parsed.data;
				if (data.type === 'ALBUM' && data.album) {
					const authoritative = selectAuthoritativeAlbumAssets(data.assets, data.album.assets);
					if (authoritative.length > 0) {
						data = { ...data, assets: [...authoritative] };
					} else {
						// No version of Immich exposes a manual per-asset album order through this
						// endpoint or any other (confirmed: GET /api/albums/{id} dropped its own
						// `assets` field entirely in v3, and manual drag-to-reorder remains an open,
						// unimplemented Immich feature request). The album's own `order` field is the
						// only ordering control Immich actually has -- a global chronological
						// direction, not a position -- so the best recoverable approximation of "the
						// viewer's album order" is to request the SAME direction the album itself is
						// configured to display, rather than leaving it unspecified and taking
						// whatever direction the search endpoint defaults to on its own.
						const albumAssets = await fetchAlbumAssets(baseUrl, context, data.album.id, data.album.assetCount ?? 0, data.album.order ?? 'desc', fetchImpl);
						if (!albumAssets) return { status: 502 };
						data = { ...data, assets: albumAssets };
					}
				}
				logShareAssetProjection({ type: data.type, topLevelAssetCount: parsed.data.assets.length, nestedAlbumAssetCount: data.album?.assets?.length ?? 0, normalizedAssetCount: data.assets.length });
				logSharedLinkResponse({ type: data.type, topLevelAssetCount: parsed.data.assets.length, nestedAlbumAssetCount: data.album?.assets?.length ?? 0, normalizedAssetCount: data.assets.length });
				return { status: response.status, data };
			} catch {
				return { status: 422, error: 'malformed' };
			}
		},
		async getThumbnail(context, assetId) {
			const share = await this.getSharedLink(context);
			if (!share.data) return { status: share.status, error: share.error };
			if (!share.data.assets.some((asset) => asset.id === assetId && AssetResponseSchema.safeParse(asset).success)) return { status: 404, error: 'asset-mismatch' };
			const response = await requestImmich(baseUrl, `/api/assets/${encodeURIComponent(assetId)}/thumbnail?${shareQuery(context)}`, context, fetchImpl, { endpoint: 'thumbnail' });
			return { status: response.status, response };
		},
		async getFullsizeImage(context, assetId) {
			const share = await this.getSharedLink(context);
			if (!share.data) return { status: share.status, error: share.error };
			const asset = share.data.assets.find((candidate) => candidate.id === assetId);
			if (!asset || !AssetResponseSchema.safeParse(asset).success) return { status: 404, error: 'asset-mismatch' };
			if (asset.type === 'VIDEO') return { status: 404, error: 'not-image' };
			const response = await requestImmich(baseUrl, `/api/assets/${encodeURIComponent(assetId)}/original?${shareQuery(context)}`, context, fetchImpl, { endpoint: 'thumbnail' });
			return { status: response.status, response };
		},
		async getVideoPlayback(context, assetId, range) {
			const share = await this.getSharedLink(context);
			if (!share.data) return { status: share.status, error: share.error };
			const asset = share.data.assets.find((candidate) => candidate.id === assetId);
			if (!asset) return { status: 404, error: 'asset-mismatch' };
			if (asset.type !== 'VIDEO') return { status: 404, error: 'not-video' };
			const response = await requestImmich(baseUrl, `/api/assets/${encodeURIComponent(assetId)}/video/playback?${shareQuery(context)}`, context, fetchImpl, { endpoint: 'video', headers: range ? { Range: range } : undefined });
			return { status: response.status, response };
		},
		async getMapMarkers(context, albumId) {
			const response = await requestImmich(baseUrl, `/api/albums/${encodeURIComponent(albumId)}/map-markers?${shareQuery(context)}`, context, fetchImpl, { endpoint: 'map-markers' });
			if (!response.ok) return { status: response.status };
			try {
				const parsed = MapMarkerResponseArraySchema.safeParse(JSON.parse(await readBoundedText(response)));
				if (!parsed.success) return { status: 422, error: 'malformed' };
				logMapMarkersResponse({ normalizedCount: parsed.data.length });
				return { status: response.status, data: parsed.data };
			} catch { return { status: 422, error: 'malformed' }; }
		},
		async getVersion() {
			const response = await requestImmich(baseUrl, '/api/server/version', { shareRef: { kind: 'key', value: 'health' }, cookie: null, authorization: null }, fetchImpl, { endpoint: 'version' });
			if (!response.ok) return { status: response.status };
			try {
				const body = JSON.parse(await readBoundedText(response)) as unknown;
				const version = typeof body === 'string'
					? body
					: typeof body === 'object' && body !== null && 'version' in body && typeof body.version === 'string'
						? body.version
						: typeof body === 'object' && body !== null && 'major' in body && 'minor' in body && 'patch' in body && [body.major, body.minor, body.patch].every((part) => Number.isInteger(part))
							? `${body.major}.${body.minor}.${body.patch}`
							: null;
				return version ? { status: response.status, version } : { status: 422 };
			} catch {
				return { status: 422 };
			}
		}
	};
}

async function getJson<T>(responsePromise: Promise<Response>, schema: { safeParse: (value: unknown) => { success: boolean; data?: T } }): Promise<{ status: number; data?: T; error?: 'malformed' }> {
	const response = await responsePromise;
	if (!response.ok) return { status: response.status };
	try { const parsed = schema.safeParse(JSON.parse(await readBoundedText(response))); return parsed.success ? { status: response.status, data: parsed.data } : { status: 422, error: 'malformed' }; } catch { return { status: 422, error: 'malformed' }; }
}

async function getJsonArray<T>(responsePromise: Promise<Response>, schema: { safeParse: (value: unknown) => { success: boolean; data?: T } }): Promise<{ status: number; data?: T[]; error?: 'malformed' }> {
	const response = await responsePromise;
	if (!response.ok) return { status: response.status };
	try { const value = JSON.parse(await readBoundedText(response)); if (!Array.isArray(value)) return { status: 422, error: 'malformed' }; const data = value.map((item) => schema.safeParse(item)); return data.every((item) => item.success) ? { status: response.status, data: data.map((item) => item.data) as T[] } : { status: 422, error: 'malformed' }; } catch { return { status: 422, error: 'malformed' }; }
}

async function fetchAlbumAssets(baseUrl: string, context: AuthContext, albumId: string, declaredCount: number, order: 'asc' | 'desc', fetchImpl: typeof fetch): Promise<SharedLinkResponse['assets'] | null> {
		let response: Response;
		try {
			response = await requestImmich(baseUrl, `/api/search/metadata?${shareQuery(context)}`, context, fetchImpl, {
			method: 'POST',
			body: JSON.stringify({ albumIds: [albumId], page: 1, size: 1000, order }),
			headers: { 'content-type': 'application/json' },
			endpoint: 'album-assets'
			});
		} catch (error) {
			logAlbumAssetsRequest({ status: 'failure', failureCategory: error instanceof Error && error.message === 'response-too-large' ? 'response-too-large' : error instanceof DOMException && error.name === 'AbortError' ? 'timeout' : 'network' });
			return null;
		}
		logAlbumAssetsRequest({ status: response.status });
		if (!response.ok) return null;
		try {
			const parsed = SearchResponseSchema.safeParse(JSON.parse(await readBoundedText(response)));
			if (!parsed.success) {
				logAlbumAssetsRequest({ status: 'failure', failureCategory: 'invalid-response' });
				return null;
			}
			logAlbumAssetsResponse({ declaredCount, normalizedCount: parsed.data.assets.items.length });
			// The adapter must preserve the upstream sequence once the requested `order` direction
			// has been applied server-side by Immich. Search metadata is the fallback response
			// supplied by Immich; reordering by dates or IDs again here on top of that would
			// silently change the viewer's album order a second time and make ties unstable.
			return parsed.data.assets.items;
		} catch (error) {
			logAlbumAssetsRequest({ status: 'failure', failureCategory: error instanceof Error && error.message === 'response-too-large' ? 'response-too-large' : 'invalid-response' });
			return null;
		}
}
