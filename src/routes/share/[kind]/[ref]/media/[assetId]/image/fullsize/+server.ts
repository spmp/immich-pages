import type { RequestHandler } from './$types';
import { authContextFromRequest } from '$server/immich/auth-context';
import { createImmichProvider } from '$server/immich/provider';
import { inferSafeImageMime, readBoundedBytes, IMMICH_MAX_ORIGINAL_BYTES } from '$server/immich/client';
import { parseSharedLinkRef } from '$server/share/ref';
import { z } from 'zod';
import { extractImmichShareToken, PAGES_SESSION_COOKIE, sessionForShare } from '$server/share/session';
import { logShareMediaStatus } from '$server/share/diagnostics';
import { convertHeicToJpeg, SdrConvertError } from '$server/media/sdr-compositor';
import { buildSdrCacheKey, getOrCreateSdr, withSdrConcurrency } from '$server/media/sdr-cache';

const HEIC_MIME_TYPES = new Set(['image/heic', 'image/heif']);

export const GET: RequestHandler = async ({ params, request, cookies, fetch }) => {
	const shareRef = parseSharedLinkRef(params.kind, params.ref);
	if (!shareRef || !z.uuidv4().safeParse(params.assetId).success) return new Response('Media not found', { status: 404 });
	const session = sessionForShare(cookies.get(PAGES_SESSION_COOKIE), shareRef);
	if (session.cookie) cookies.set(PAGES_SESSION_COOKIE, session.cookie.split(';')[0].split('=')[1] ?? '', { path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: session.token ? 86400 : 0 });
	const token = session.token ?? extractImmichShareToken(request.headers.get('cookie'));
	const context = { ...authContextFromRequest(request, shareRef), cookie: token ? `immich_shared_link_token=${token}` : null };
	let result: Awaited<ReturnType<ReturnType<typeof createImmichProvider>['getFullsizeImage']>>;
	try { result = await createImmichProvider(fetch).getFullsizeImage(context, params.assetId); } catch { logShareMediaStatus({ media: 'fullsize', status: 'failure', statusCode: 502, failureCategory: 'upstream' }); return new Response('Immich is unavailable', { status: 502, headers: { 'cache-control': 'private, no-store' } }); }
	if (result.status === 401 || result.status === 403) { cookies.set(PAGES_SESSION_COOKIE, '', { path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: 0 }); logShareMediaStatus({ media: 'fullsize', status: 'failure', statusCode: 403, failureCategory: 'unauthorized' }); return new Response('Media not authorized', { status: 403 }); }
	if (result.error === 'asset-mismatch' || result.error === 'not-image' || result.status === 404) { logShareMediaStatus({ media: 'fullsize', status: 'failure', statusCode: 404, failureCategory: 'not-found' }); return new Response('Media not found', { status: 404 }); }
	if (!result.response || result.status < 200 || result.status >= 300) { logShareMediaStatus({ media: 'fullsize', status: 'failure', statusCode: 502, failureCategory: 'upstream' }); return new Response('Immich is unavailable', { status: 502 }); }
	try {
		const body = await readBoundedBytes(result.response, IMMICH_MAX_ORIGINAL_BYTES);
		const sourceContentType = inferSafeImageMime(body, result.response.headers.get('content-type'));
		if (!sourceContentType) { logShareMediaStatus({ media: 'fullsize', status: 'failure', statusCode: 502, contentType: result.response.headers.get('content-type') ?? undefined, byteLength: body.byteLength, failureCategory: 'upstream' }); return new Response('Media response unavailable', { status: 502 }); }

		if (!HEIC_MIME_TYPES.has(sourceContentType)) {
			const headers = new Headers({ 'content-type': sourceContentType, 'cache-control': 'private, no-store' });
			if (body.byteLength > 0) headers.set('content-length', String(body.byteLength));
			logShareMediaStatus({ media: 'fullsize', status: 'success', statusCode: result.status, contentType: sourceContentType, byteLength: body.byteLength });
			return new Response(body.buffer as ArrayBuffer, { headers });
		}

		// Most non-Safari browsers cannot decode HEIC/HEIF in <img>; convert to a universally
		// displayable JPEG. On any conversion failure, degrade the same way the client already
		// does for a broken fullsize source: an error response lets GalleryAsset fall back to
		// the thumbnail rather than serving an undecodable format.
		try {
			const sourceIdentity = [
				result.response.headers.get('etag'),
				result.response.headers.get('last-modified'),
				result.response.headers.get('content-length')
			].filter(Boolean).join('|') || `bytes-${body.byteLength}`;
			const cacheKey = buildSdrCacheKey({ assetId: params.assetId, sourceIdentity });
			const converted = await getOrCreateSdr(cacheKey, () => withSdrConcurrency(async () => ({
				body: await convertHeicToJpeg(body),
				contentType: 'image/jpeg'
			})));
			const headers = new Headers({ 'content-type': converted.contentType, 'content-length': String(converted.body.byteLength), 'cache-control': 'private, no-store' });
			logShareMediaStatus({ media: 'fullsize', status: 'success', statusCode: result.status, contentType: converted.contentType, byteLength: converted.body.byteLength });
			return new Response(converted.body.buffer as ArrayBuffer, { headers });
		} catch (error) {
			logShareMediaStatus({ media: 'fullsize', status: 'failure', statusCode: 502, contentType: sourceContentType, byteLength: body.byteLength, failureCategory: 'conversion', failureReason: error instanceof SdrConvertError ? error.reason : 'unknown' });
			return new Response('Media conversion unavailable', { status: 502, headers: { 'cache-control': 'private, no-store' } });
		}
	} catch { logShareMediaStatus({ media: 'fullsize', status: 'failure', statusCode: 502, failureCategory: 'upstream' }); return new Response('Media response unavailable', { status: 502, headers: { 'cache-control': 'private, no-store' } }); }
};
