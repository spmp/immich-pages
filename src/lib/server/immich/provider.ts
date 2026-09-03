import { readBoundedText, requestImmich, shareQuery } from './client';
import { AlbumResponseSchema, AssetResponseSchema, MapMarkerResponseArraySchema, SearchResponseSchema, SharedLinkResponseSchema, UserResponseSchema, type SharedLinkResponse } from './types';
import type { AuthContext, UserSessionContext } from './auth-context';
import { logAlbumAssetsRequest, logAlbumAssetsResponse, logMapMarkersResponse, logSharedLinkResponse, logShareAssetProjection } from '$server/share/diagnostics';

export type ImmichProvider = {
	getCurrentUser: (context: UserSessionContext) => Promise<{ status: number; data?: import('./types').UserResponse; error?: 'malformed' }>; 
	listAlbums: (context: UserSessionContext) => Promise<{ status: number; data?: import('./types').AlbumResponse[]; error?: 'malformed' }>;
	getAlbum: (context: UserSessionContext, albumId: string) => Promise<{ status: number; data?: import('./types').AlbumResponse; error?: 'malformed' }>;
	getAlbumAssets: (context: UserSessionContext, albumId: string) => Promise<{ status: number; data?: import('./types').SharedAsset[]; error?: 'malformed' }>;
	loginSharedLink: (context: AuthContext, password: string) => Promise<{ status: number; token?: string }>;
	getSharedLink: (context: AuthContext) => Promise<{ status: number; data?: SharedLinkResponse; error?: 'malformed' }>;
	getThumbnail: (context: AuthContext, assetId: string) => Promise<{ status: number; response?: Response; error?: 'malformed' | 'asset-mismatch' }>;
	getUserThumbnail: (context: UserSessionContext, assetId: string) => Promise<{ status: number; response?: Response }>;
	getVideoPlayback: (context: AuthContext, assetId: string, range?: string) => Promise<{ status: number; response?: Response; error?: 'malformed' | 'asset-mismatch' | 'not-video' }>;
	getMapMarkers: (context: AuthContext, albumId: string) => Promise<{ status: number; data?: unknown; error?: 'malformed' }>;
	getVersion: () => Promise<{ status: number; version?: string }>;
};

export function createImmichProvider(fetchImpl: typeof fetch = fetch, baseUrl = process.env.IMMICH_BASE_URL): ImmichProvider {
	if (!baseUrl) throw new Error('IMMICH_BASE_URL is required');
	return {
		async getCurrentUser(context) { return getJson(requestImmich(baseUrl, '/api/users/me', context, fetchImpl, { endpoint: 'current-user' }), UserResponseSchema); },
		async listAlbums(context) { return getJsonArray(requestImmich(baseUrl, '/api/albums', context, fetchImpl, { endpoint: 'albums' }), AlbumResponseSchema); },
		async getAlbum(context, albumId) { return getJson(requestImmich(baseUrl, `/api/albums/${encodeURIComponent(albumId)}`, context, fetchImpl, { endpoint: 'album' }), AlbumResponseSchema); },
		async getAlbumAssets(context, albumId) { return getJson(requestImmich(baseUrl, '/api/search/metadata', context, fetchImpl, { method: 'POST', body: JSON.stringify({ albumIds: [albumId], page: 1, size: 1000, withExif: false }), headers: { 'content-type': 'application/json' }, endpoint: 'album-assets' }), SearchResponseSchema).then((result) => ({ ...result, data: result.data?.assets.items })); },
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
				if (data.type === 'ALBUM' && data.assets.length === 0 && data.album) {
					const albumAssets = await fetchAlbumAssets(baseUrl, context, data.album.id, data.album.assetCount ?? 0, fetchImpl);
					if (!albumAssets) return { status: 502 };
					data = { ...data, assets: albumAssets };
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
		async getUserThumbnail(context, assetId) {
			const response = await requestImmich(baseUrl, `/api/assets/${encodeURIComponent(assetId)}/thumbnail`, context, fetchImpl, { endpoint: 'thumbnail' });
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

async function fetchAlbumAssets(baseUrl: string, context: AuthContext, albumId: string, declaredCount: number, fetchImpl: typeof fetch): Promise<SharedLinkResponse['assets'] | null> {
		let response: Response;
		try {
			response = await requestImmich(baseUrl, `/api/search/metadata?${shareQuery(context)}`, context, fetchImpl, {
			method: 'POST',
			body: JSON.stringify({ albumIds: [albumId], page: 1, size: 1000 }),
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
			return parsed.data.assets.items;
		} catch (error) {
			logAlbumAssetsRequest({ status: 'failure', failureCategory: error instanceof Error && error.message === 'response-too-large' ? 'response-too-large' : 'invalid-response' });
			return null;
		}
}
