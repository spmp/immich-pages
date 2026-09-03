import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { userSessionContextFromRequest } from '$server/immich/auth-context';
import { createImmichProvider } from '$server/immich/provider';
import { readBoundedBytes, IMMICH_MAX_MEDIA_BYTES } from '$server/immich/client';
import { decodeLibraryLocator } from '$server/immich/locator';
import { z } from 'zod';

const assetIdSchema = z.uuidv4();

export const GET: RequestHandler = async ({ params, request, fetch, setHeaders }) => {
	setHeaders({ 'cache-control': 'private, no-store' });
	const locator = decodeLibraryLocator(params.locator);
	if (!locator || !assetIdSchema.safeParse(params.assetId).success) error(404, 'Media not found');
	const context = userSessionContextFromRequest(request);
	if (!context.cookie && !context.authorization) error(403, 'Media not authorized');
	const provider = createImmichProvider(fetch);
	try {
		const [album, assets] = await Promise.all([
			provider.getAlbum(context, locator.albumId),
			provider.getAlbumAssets(context, locator.albumId)
		]);
		if (!album.data || !assets.data || album.status === 401 || album.status === 403 || assets.status === 401 || assets.status === 403) error(403, 'Media not authorized');
		if (!assets.data.some((asset) => asset.id === params.assetId)) error(404, 'Media not found');
		const result = await provider.getUserThumbnail(context, params.assetId);
		if (result.status === 401 || result.status === 403) error(403, 'Media not authorized');
		if (result.status === 404 || !result.response?.ok) error(404, 'Media not found');
		const body = await readBoundedBytes(result.response, IMMICH_MAX_MEDIA_BYTES);
		const upstreamType = result.response.headers.get('content-type');
		return new Response(body.buffer as ArrayBuffer, {
			headers: {
				'content-type': upstreamType?.startsWith('image/') ? upstreamType : 'application/octet-stream',
				'cache-control': 'private, no-store'
			}
		});
	} catch (cause) {
		if (cause instanceof Response || (typeof cause === 'object' && cause !== null && 'status' in cause && typeof cause.status === 'number')) throw cause;
		error(502, 'Immich response unavailable');
	}
};
