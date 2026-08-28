import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authContextFromRequest } from '$server/immich/auth-context';
import { createImmichProvider } from '$server/immich/provider';
import { readBoundedBytes, IMMICH_MAX_MEDIA_BYTES } from '$server/immich/client';
import { parseSharedLinkRef } from '$server/share/ref';
import { z } from 'zod';

export const GET: RequestHandler = async ({ params, request, fetch }) => {
	const shareRef = parseSharedLinkRef(params.kind, params.ref);
	if (!shareRef || !z.uuidv4().safeParse(params.assetId).success) error(404, 'Media not found');
	const result = await createImmichProvider(fetch).getThumbnail(authContextFromRequest(request, shareRef), params.assetId);
	if (result.status === 401 || result.status === 403) error(403, 'Media not authorized');
	if (result.status === 404 || result.error === 'asset-mismatch') error(404, 'Media not found');
	if (!result.response?.ok) error(502, 'Immich is unavailable');
	try {
		const body = await readBoundedBytes(result.response, IMMICH_MAX_MEDIA_BYTES);
		const contentType = result.response.headers.get('content-type');
		return new Response(body.buffer as ArrayBuffer, { headers: { 'content-type': contentType?.startsWith('image/') ? contentType : 'application/octet-stream', 'cache-control': 'private, no-store' } });
	} catch {
		error(502, 'Immich response unavailable');
	}
};
