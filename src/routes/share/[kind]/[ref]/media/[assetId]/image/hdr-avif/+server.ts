import type { RequestHandler } from './$types';
import { authContextFromRequest } from '$server/immich/auth-context';
import { createImmichProvider } from '$server/immich/provider';
import { inferSafeImageMime, readBoundedBytes, IMMICH_MAX_ORIGINAL_BYTES } from '$server/immich/client';
import { parseSharedLinkRef } from '$server/share/ref';
import { z } from 'zod';
import { extractImmichShareToken, PAGES_SESSION_COOKIE, sessionForShare } from '$server/share/session';
import { logHdrDiagnostic, logShareMediaStatus } from '$server/share/diagnostics';
import { nativeFailureDetail, nativeFailureReason } from '$server/media/hdr-compositor';
import { buildHdrCacheKey, getCachedHdr, HDR_CACHE_TTL_MS } from '$server/media/hdr-cache';
import { getHdrInteractiveCoordinator } from '$server/media/hdr-prewarm';
import { extractAppleHdrMetadata } from '$server/media/hdr-metadata';
import { buildHdrMetadataCacheKey, getCachedHdrMetadata, getOrExtractHdrMetadata } from '$server/media/hdr-metadata-cache';

const noStore = { 'cache-control': 'private, no-store' };
const unavailable = () => new Response('HDR unavailable', { status: 404, headers: noStore });
// Successful media only (never the auth/error paths above, which stay no-store). Decided
// tradeoff: a revoked share's AVIF lingering in the one browser that already legitimately viewed
// it, for at most as long as the server's own result cache promises identical bytes, requires
// already knowing that exact per-share media URL -- the benefit (no re-download on revisit)
// outweighs that bounded, device-local exposure. 'private' still forbids any shared/proxy cache.
const mediaCacheControl = { 'cache-control': `private, max-age=${Math.floor(HDR_CACHE_TTL_MS / 1000)}` };

export const GET: RequestHandler = async ({ params, request, cookies, fetch, locals }) => {
	const requestStartedAt = Date.now();
	const requestId = locals?.requestId;
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
	// Shares the same metadata cache keyspace as /image/hdr (video) -- whether an asset has Apple
	// HDR gain-map metadata is a property of its bytes, not of which output format we're producing.
	const headerSourceIdentity = [
		source.response.headers.get('etag'),
		source.response.headers.get('last-modified'),
		source.response.headers.get('content-length')
	].filter(Boolean).join('|') || `asset-${params.assetId}`;
	const metadataCacheKey = buildHdrMetadataCacheKey({ assetId: params.assetId, sourceIdentity: headerSourceIdentity });
	logHdrDiagnostic({ event: 'request', assetId: params.assetId, requestId, phase: 'lookup', status: 'started', source: 'upstream' });
	const cachedMetadata = getCachedHdrMetadata(metadataCacheKey);
	if (cachedMetadata.hit && !cachedMetadata.value) {
		logShareMediaStatus({ media: 'fullsize', status: 'failure', statusCode: 404, failureCategory: 'not-found', failureReason: 'metadata-invalid' });
		return unavailable();
	}
	// See /image/hdr's identical comment: a revisit of a photo whose HDR AVIF is already cached
	// was paying for the entire original download just to recompute a cache key that would then
	// hit and discard those bytes. The key only needs header-level identity (already have it)
	// plus the already-cached metadata fields -- check the cache before paying for the body.
	if (cachedMetadata.hit && cachedMetadata.value) {
		const metadata = cachedMetadata.value;
		const sourceIdentity = [
			source.response.headers.get('etag'),
			source.response.headers.get('last-modified'),
			source.response.headers.get('content-length'),
			metadata.version,
			metadata.sourceProfile,
			metadata.sourceTransfer,
			metadata.orientation
		].filter(Boolean).join('|');
		const cached = sourceIdentity ? getCachedHdr(buildHdrCacheKey({ assetId: params.assetId, sourceIdentity, outputContract: 'avif-gainmap-p3' })) : undefined;
		if (cached) {
			await source.response.body?.cancel().catch(() => {});
			logHdrDiagnostic({ event: 'source', assetId: params.assetId, requestId, phase: 'lookup', source: 'cache', status: 'hit', contentType: cached.contentType, byteLength: cached.body.byteLength, durationMs: Date.now() - requestStartedAt });
			logShareMediaStatus({ media: 'fullsize', status: 'success', contentType: cached.contentType, byteLength: cached.body.byteLength });
			logHdrDiagnostic({ event: 'response', assetId: params.assetId, requestId, phase: 'served', source: 'cache', status: 'success', statusCode: 200, contentType: cached.contentType, byteLength: cached.body.byteLength });
			return new Response(cached.body.buffer.slice(cached.body.byteOffset, cached.body.byteOffset + cached.body.byteLength) as ArrayBuffer, { headers: { 'content-type': cached.contentType, 'content-length': String(cached.body.byteLength), ...mediaCacheControl } });
		}
	}
	logHdrDiagnostic({ event: 'source', assetId: params.assetId, requestId, phase: 'lookup', source: 'conversion', status: 'miss', durationMs: Date.now() - requestStartedAt });
	try {
		const input = await readBoundedBytes(source.response, IMMICH_MAX_ORIGINAL_BYTES);
		const mime = inferSafeImageMime(input, source.response.headers.get('content-type'));
		if (!mime || !['image/heic', 'image/heif'].includes(mime)) {
			logShareMediaStatus({ media: 'fullsize', status: 'failure', statusCode: 404, contentType: mime ?? undefined, byteLength: input.byteLength, failureCategory: 'not-found' });
			return unavailable();
		}
		const bridgeEnabled = Boolean(process.env.HDR_METADATA_PATH || process.env.HDR_AVIF_DECODE_PATH || process.env.HDR_AVIF_ENCODE_PATH);
		let metadata;
		try {
			metadata = cachedMetadata.hit
				? cachedMetadata.value
				: await getOrExtractHdrMetadata(metadataCacheKey, () => bridgeEnabled
					? extractAppleHdrMetadata(input, { executable: process.env.HDR_METADATA_PATH, invocationId: params.assetId })
					: extractAppleHdrMetadata(input));
		} catch { return unavailable(); }
		if (!metadata) {
			logShareMediaStatus({ media: 'fullsize', status: 'failure', statusCode: 404, failureCategory: 'not-found', failureReason: 'metadata-invalid' });
			return unavailable();
		}
		let output;
		try {
			const sourceIdentity = [
				source.response.headers.get('etag'),
				source.response.headers.get('last-modified'),
				source.response.headers.get('content-length'),
				metadata.version,
				metadata.sourceProfile,
				metadata.sourceTransfer,
				metadata.orientation
			].filter(Boolean).join('|') || `bytes-${input.byteLength}`;
			output = await getHdrInteractiveCoordinator().submitInteractive({ id: params.assetId, eligible: true, position: 0, sourceIdentity, sourceBytes: input.slice(), metadata }, 'avif');
		} catch (error) {
			const failureReason = nativeFailureReason(error);
			logHdrDiagnostic({ event: 'conversion', assetId: params.assetId, requestId, phase: 'failed', source: 'conversion', status: 'failure', reason: nativeFailureDetail(error), durationMs: Date.now() - requestStartedAt });
			logShareMediaStatus({ media: 'fullsize', status: 'failure', statusCode: 502, contentType: mime, byteLength: input.byteLength, failureCategory: 'conversion', failureReason, failureDetail: nativeFailureDetail(error) });
			return new Response('HDR conversion unavailable', { status: 502, headers: noStore });
		}
		logShareMediaStatus({ media: 'fullsize', status: 'success', contentType: output.contentType, byteLength: output.body.byteLength });
		logHdrDiagnostic({ event: 'conversion', assetId: params.assetId, requestId, phase: 'stored', source: 'conversion', status: 'success', contentType: output.contentType, byteLength: output.body.byteLength, durationMs: Date.now() - requestStartedAt });
		logHdrDiagnostic({ event: 'response', assetId: params.assetId, requestId, phase: 'served', source: 'conversion', status: 'success', statusCode: 200, contentType: output.contentType, byteLength: output.body.byteLength });
		// output.body is a Buffer; for small allocations .buffer is a view into Node's shared
		// pool slab (leaking unrelated adjacent memory), not just these bytes. slice() copies
		// exactly this view's own byte range into a fresh ArrayBuffer.
		return new Response(output.body.buffer.slice(output.body.byteOffset, output.body.byteOffset + output.body.byteLength) as ArrayBuffer, { headers: { 'content-type': output.contentType, 'content-length': String(output.body.byteLength), ...mediaCacheControl } });
	} catch { logShareMediaStatus({ media: 'fullsize', status: 'failure', failureCategory: 'upstream' }); return unavailable(); }
};
