import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authContextFromRequest } from '$server/immich/auth-context';
import { createImmichProvider } from '$server/immich/provider';
import { readBoundedBytes, IMMICH_MAX_MEDIA_BYTES } from '$server/immich/client';
import { parseSharedLinkRef } from '$server/share/ref';
import { z } from 'zod';
import { logShareMediaStatus } from '$server/share/diagnostics';
import { extractImmichShareToken, PAGES_SESSION_COOKIE, sessionForShare } from '$server/share/session';

export const GET: RequestHandler = async ({ params, request, cookies, fetch }) => {
	const shareRef = parseSharedLinkRef(params.kind, params.ref);
	if (!shareRef || !z.uuidv4().safeParse(params.assetId).success) error(404, 'Media not found');
	const session = sessionForShare(cookies.get(PAGES_SESSION_COOKIE), shareRef);
	if (session.cookie) cookies.set(PAGES_SESSION_COOKIE, session.cookie.split(';')[0].split('=')[1] ?? '', { path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: session.token ? 86400 : 0 });
	const token = session.token ?? extractImmichShareToken(request.headers.get('cookie'));
	const context = { ...authContextFromRequest(request, shareRef), cookie: token ? `immich_shared_link_token=${token}` : null };
	let result: Awaited<ReturnType<ReturnType<typeof createImmichProvider>['getThumbnail']>>;
	try { result = await createImmichProvider(fetch).getThumbnail(context, params.assetId); } catch {
		logShareMediaStatus({ media: 'thumbnail', status: 'failure', failureCategory: 'upstream' });
		error(502, 'Immich is unavailable');
	}
	if (result.status === 401 || result.status === 403) { cookies.set(PAGES_SESSION_COOKIE, '', { path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: 0 }); logShareMediaStatus({ media: 'thumbnail', status: 'failure', failureCategory: 'unauthorized' }); error(403, 'Media not authorized'); }
	if (result.status === 404 || result.error === 'asset-mismatch') { logShareMediaStatus({ media: 'thumbnail', status: 'failure', failureCategory: 'not-found' }); error(404, 'Media not found'); }
	if (!result.response?.ok) { logShareMediaStatus({ media: 'thumbnail', status: 'failure', failureCategory: 'upstream' }); error(502, 'Immich is unavailable'); }
	try {
		const body = await readBoundedBytes(result.response, IMMICH_MAX_MEDIA_BYTES);
		const contentType = result.response.headers.get('content-type');
		logShareMediaStatus({ media: 'thumbnail', status: 'success' });
		// body is a Buffer, which for small allocations is a view into Node's shared pool --
		// body.buffer would be the whole pool slab (leaking unrelated adjacent memory), not just
		// these bytes. slice() copies exactly this view's own byte range into a fresh ArrayBuffer.
		return new Response(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer, { headers: { 'content-type': contentType?.startsWith('image/') ? contentType : 'application/octet-stream', 'cache-control': 'private, no-store' } });
	} catch {
		logShareMediaStatus({ media: 'thumbnail', status: 'failure', failureCategory: 'oversized' });
		error(502, 'Immich response unavailable');
	}
};
