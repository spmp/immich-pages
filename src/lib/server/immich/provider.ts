import { readBoundedText, requestImmich } from './client';
import { AssetResponseSchema, SharedLinkResponseSchema, type SharedLinkResponse } from './types';
import type { AuthContext } from './auth-context';

export type ImmichProvider = {
	getSharedLink: (context: AuthContext) => Promise<{ status: number; data?: SharedLinkResponse; error?: 'malformed' }>;
	getThumbnail: (context: AuthContext, assetId: string) => Promise<{ status: number; response?: Response; error?: 'malformed' | 'asset-mismatch' }>;
	getVersion: () => Promise<{ status: number; version?: string }>;
};

export function createImmichProvider(fetchImpl: typeof fetch = fetch, baseUrl = process.env.IMMICH_BASE_URL): ImmichProvider {
	if (!baseUrl) throw new Error('IMMICH_BASE_URL is required');
	return {
		async getSharedLink(context) {
			const url = `/api/shared-links/me?${context.shareRef.kind}=${encodeURIComponent(context.shareRef.value)}`;
			const response = await requestImmich(baseUrl, url, context, fetchImpl);
			if (!response.ok) return { status: response.status };
			try {
				const parsed = SharedLinkResponseSchema.safeParse(JSON.parse(await readBoundedText(response)));
				return parsed.success ? { status: response.status, data: parsed.data } : { status: 422, error: 'malformed' };
			} catch {
				return { status: 422, error: 'malformed' };
			}
		},
		async getThumbnail(context, assetId) {
			const share = await this.getSharedLink(context);
			if (!share.data) return { status: share.status, error: share.error };
			if (!share.data.assets.some((asset) => asset.id === assetId && AssetResponseSchema.safeParse(asset).success)) return { status: 404, error: 'asset-mismatch' };
			const response = await requestImmich(baseUrl, `/api/assets/${encodeURIComponent(assetId)}/thumbnail`, context, fetchImpl);
			return { status: response.status, response };
		},
		async getVersion() {
			const response = await requestImmich(baseUrl, '/api/server/version', { shareRef: { kind: 'key', value: 'health' }, cookie: null, authorization: null }, fetchImpl);
			if (!response.ok) return { status: response.status };
			try {
				const body = JSON.parse(await readBoundedText(response)) as unknown;
				const version = typeof body === 'string' ? body : typeof body === 'object' && body !== null && 'version' in body && typeof body.version === 'string' ? body.version : null;
				return version ? { status: response.status, version } : { status: 422 };
			} catch {
				return { status: 422 };
			}
		}
	};
}
