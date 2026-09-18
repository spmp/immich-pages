import type { RequestHandler } from './$types';
import { authContextFromRequest } from '$server/immich/auth-context';
import { createImmichProvider } from '$server/immich/provider';
import { inferSafeImageMime, readBoundedBytes, IMMICH_MAX_ORIGINAL_BYTES } from '$server/immich/client';
import { parseSharedLinkRef } from '$server/share/ref';
import { z } from 'zod';
import { extractImmichShareToken, PAGES_SESSION_COOKIE, sessionForShare } from '$server/share/session';
import { logShareMediaStatus } from '$server/share/diagnostics';
import { composeHdr, encodeHdrMp4, nativeFailureDetail, nativeFailureReason } from '$server/media/hdr-compositor';
import { getOrCreateHdr, withHdrConcurrency } from '$server/media/hdr-cache';
import { extractAppleHdrMetadata } from '$server/media/hdr-metadata';

const noStore = { 'cache-control': 'private, no-store' };
const unavailable = () => new Response('HDR unavailable', { status: 404, headers: noStore });

export const GET: RequestHandler = async ({ params, request, cookies, fetch }) => {
	const shareRef = parseSharedLinkRef(params.kind, params.ref);
	if (!shareRef || !z.uuidv4().safeParse(params.assetId).success) return new Response('Media not found', { status: 404, headers: noStore });
	const session = sessionForShare(cookies.get(PAGES_SESSION_COOKIE), shareRef);
	if (session.cookie) cookies.set(PAGES_SESSION_COOKIE, session.cookie.split(';')[0].split('=')[1] ?? '', { path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: session.token ? 86400 : 0 });
	const token = session.token ?? extractImmichShareToken(request.headers.get('cookie'));
	const context = { ...authContextFromRequest(request, shareRef), cookie: token ? `immich_shared_link_token=${token}` : null };
	const provider = createImmichProvider(fetch);
	let source: Awaited<ReturnType<typeof provider.getFullsizeImage>>;
	try { source = await provider.getFullsizeImage(context, params.assetId); } catch { return new Response('Immich is unavailable', { status: 502, headers: { 'cache-control': 'private, no-store' } }); }
	if (source.status === 401 || source.status === 403) { cookies.set(PAGES_SESSION_COOKIE, '', { path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: 0 }); return new Response('Media not authorized', { status: 403, headers: noStore }); }
	if (source.error === 'asset-mismatch' || source.error === 'not-image' || source.status === 404) return unavailable();
	if (!source.response?.ok) return new Response('Immich is unavailable', { status: 502, headers: { 'cache-control': 'private, no-store' } });
	try {
		const input = await readBoundedBytes(source.response, IMMICH_MAX_ORIGINAL_BYTES);
		const mime = inferSafeImageMime(input, source.response.headers.get('content-type'));
		if (!mime || !['image/heic', 'image/heif'].includes(mime)) {
			logShareMediaStatus({ media: 'fullsize', status: 'failure', statusCode: 404, contentType: mime ?? undefined, byteLength: input.byteLength, failureCategory: 'not-found' });
			return unavailable();
		}
		let metadata;
		try { metadata = await extractAppleHdrMetadata(input); } catch { return unavailable(); }
		if (!metadata) return unavailable();
		let output;
		try {
			output = await getOrCreateHdr(`apple-gainmap-v2:${params.assetId}:${metadata.version}:${metadata.sourceProfile}:${metadata.sourceTransfer}`, async () => {
				return withHdrConcurrency(async () => {
					const compositorPpm = await composeHdr(input, metadata);
					return { body: await encodeHdrMp4(compositorPpm), contentType: 'video/mp4' };
				});
			});
		} catch (error) {
			const failureReason = nativeFailureReason(error);
			logShareMediaStatus({ media: 'fullsize', status: 'failure', statusCode: 502, contentType: mime, byteLength: input.byteLength, failureCategory: 'conversion', failureReason, failureDetail: nativeFailureDetail(error) });
			return new Response('HDR conversion unavailable', { status: 502, headers: noStore });
		}
		logShareMediaStatus({ media: 'fullsize', status: 'success', contentType: output.contentType, byteLength: output.body.byteLength });
		return new Response(output.body.buffer as ArrayBuffer, { headers: { 'content-type': output.contentType, 'content-length': String(output.body.byteLength), ...noStore } });
	} catch { logShareMediaStatus({ media: 'fullsize', status: 'failure', failureCategory: 'upstream' }); return unavailable(); }
};
