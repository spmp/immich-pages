import type { RequestHandler } from './$types';
import { authContextFromRequest } from '$server/immich/auth-context';
import { createImmichProvider } from '$server/immich/provider';
import { inferSafeImageMime, readBoundedBytes, IMMICH_MAX_ORIGINAL_BYTES } from '$server/immich/client';
import { parseSharedLinkRef } from '$server/share/ref';
import { z } from 'zod';
import { extractImmichShareToken, PAGES_SESSION_COOKIE, sessionForShare } from '$server/share/session';
import { logHdrDiagnostic, logShareMediaStatus } from '$server/share/diagnostics';
import { composeHdr, encodeHdrMp4, nativeFailureDetail, nativeFailureReason } from '$server/media/hdr-compositor';
import { buildHdrCacheKey, getCachedHdr, getHdrCacheState, getOrCreateHdr, withHdrConcurrency, HDR_CACHE_TTL_MS } from '$server/media/hdr-cache';
import { extractAppleHdrMetadata } from '$server/media/hdr-metadata';
import { buildHdrMetadataCacheKey, getCachedHdrMetadata, getOrExtractHdrMetadata } from '$server/media/hdr-metadata-cache';

const noStore = { 'cache-control': 'private, no-store' };
const unavailable = () => new Response('HDR unavailable', { status: 404, headers: noStore });
// Successful media only (never the auth/error paths, which stay no-store). Decided tradeoff: a
// revoked share's video lingering in the one browser that already legitimately viewed it, for at
// most as long as the server's own result cache promises identical bytes, requires already
// knowing that exact per-share media URL -- the benefit (no re-download on revisit) outweighs
// that bounded, device-local exposure. 'private' still forbids any shared/proxy cache.
const mediaCacheControl = { 'cache-control': `private, max-age=${Math.floor(HDR_CACHE_TTL_MS / 1000)}` };

// Safari/WebKit's native <video> element is markedly stricter than Chromium about a server
// actually honoring Range requests before it will play a source at all -- it commonly probes
// with a Range request to establish seekability/duration before starting playback, and a plain
// 200-with-full-body response to that probe can make it refuse to ever start. The whole HDR
// video is already fully buffered in memory by the time this runs, so honoring Range here is
// just slicing that buffer, not proxying/coordinating with anything upstream.
function hdrVideoResponse(body: Uint8Array, rangeHeader: string | null, context: { assetId: string; requestId?: string; source: 'cache' | 'conversion' }): Response {
	const total = body.byteLength;
	const headers = { 'content-type': 'video/mp4', 'accept-ranges': 'bytes', ...mediaCacheControl };
	// Diagnostic only: everything server-side has checked out clean (correct bytes, correct
	// container structure) while the client still reports the video failing to load, with no
	// client-visible reason why. Logging exactly what was asked for and what was answered turns
	// the next report from a guess into a fact -- bounded/sanitized the same way the rest of this
	// module's request-scoped diagnostics are.
	const logHdrVideoResponse = (status: number, contentRange?: string) => logHdrDiagnostic({ event: 'response', assetId: context.assetId, requestId: context.requestId, phase: 'served', source: context.source, status: status >= 200 && status < 300 ? 'success' : 'failure', statusCode: status, range: rangeHeader?.slice(0, 64) ?? null, contentRange, byteLength: status === 206 && contentRange ? Number(contentRange.split(' ')[1]?.split('-')[1]) - Number(contentRange.split(' ')[1]?.split('-')[0]) + 1 : total });
	if (!rangeHeader) {
		logHdrVideoResponse(200);
		// body.buffer is a view into Node's shared pool slab for small allocations, not just
		// these bytes -- slice() copies exactly this view's own byte range into a fresh ArrayBuffer.
		return new Response(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer, { headers: { ...headers, 'content-length': String(total) } });
	}
	const match = /^bytes=(\d+)-(\d+)?$/.exec(rangeHeader);
	const start = match ? Number(match[1]) : NaN;
	const end = match ? (match[2] !== undefined ? Number(match[2]) : total - 1) : NaN;
	if (!match || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= total) {
		logHdrVideoResponse(416, `bytes */${total}`);
		// Not a successful media byte delivery -- no reason to let a client cache a 416.
		return new Response(null, { status: 416, headers: { ...headers, ...noStore, 'content-range': `bytes */${total}` } });
	}
	const boundedEnd = Math.min(end, total - 1);
	const slice = body.subarray(start, boundedEnd + 1);
	const contentRange = `bytes ${start}-${boundedEnd}/${total}`;
	logHdrVideoResponse(206, contentRange);
	return new Response(slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength) as ArrayBuffer, {
		status: 206,
		headers: { ...headers, 'content-length': String(slice.byteLength), 'content-range': contentRange }
	});
}

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
	// Whether this asset has Apple HDR gain-map metadata is a property of its bytes, checkable
	// from response-header identity alone -- before reading a body that can be up to 100MB. Most
	// HEIC photos are not HDR, so a cached negative result here skips the full re-download of the
	// original (already fetched once by /image/fullsize) and the exiftool spawn entirely, instead
	// of redoing both on every single click as before.
	const headerSourceIdentity = [
		source.response.headers.get('etag'),
		source.response.headers.get('last-modified'),
		source.response.headers.get('content-length')
	].filter(Boolean).join('|') || `asset-${params.assetId}`;
	const metadataCacheKey = buildHdrMetadataCacheKey({ assetId: params.assetId, sourceIdentity: headerSourceIdentity });
	const cachedMetadata = getCachedHdrMetadata(metadataCacheKey);
	if (cachedMetadata.hit && !cachedMetadata.value) {
		logShareMediaStatus({ media: 'fullsize', status: 'failure', statusCode: 404, failureCategory: 'not-found', failureReason: 'metadata-invalid' });
		return unavailable();
	}
	const requestUrl = new URL(request.url);
	const requestedWidth = boundedDimension(requestUrl.searchParams.get('width'));
	const requestedHeight = boundedDimension(requestUrl.searchParams.get('height'));
	const conversionPriority = requestUrl.searchParams.get('priority') === 'interactive' ? 'interactive' : 'background';
	logHdrDiagnostic({ event: 'request', assetId: params.assetId, requestId, phase: 'lookup', status: 'started', range: request.headers.get('range'), width: requestedWidth, height: requestedHeight });
	// A revisit of a photo whose HDR video is already cached was paying for the ENTIRE original
	// download (up to 100MB) and a full read into memory on every single request -- including a
	// bare Range byte-probe -- just to recompute a cache key that would then hit and discard
	// those bytes. The cache key only needs header-level identity (already have it, no body
	// read required) plus the already-cached metadata fields: if both are in hand, check the
	// cache before paying for the body at all.
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
		const cached = sourceIdentity ? getCachedHdr(buildHdrCacheKey({ assetId: params.assetId, sourceIdentity, width: requestedWidth, height: requestedHeight })) : undefined;
		if (cached) {
			await source.response.body?.cancel().catch(() => {});
			logHdrDiagnostic({ event: 'source', assetId: params.assetId, requestId, phase: 'lookup', source: 'cache', status: 'hit', contentType: cached.contentType, byteLength: cached.body.byteLength, durationMs: Date.now() - requestStartedAt, width: requestedWidth, height: requestedHeight });
			logShareMediaStatus({ media: 'fullsize', status: 'success', contentType: cached.contentType, byteLength: cached.body.byteLength });
			return hdrVideoResponse(cached.body, request.headers.get('range'), { assetId: params.assetId, requestId, source: 'cache' });
		}
		logHdrDiagnostic({ event: 'source', assetId: params.assetId, requestId, phase: 'lookup', source: 'conversion', status: 'miss', durationMs: Date.now() - requestStartedAt, width: requestedWidth, height: requestedHeight });
	}
	try {
		const input = await readBoundedBytes(source.response, IMMICH_MAX_ORIGINAL_BYTES);
		const mime = inferSafeImageMime(input, source.response.headers.get('content-type'));
		if (!mime || !['image/heic', 'image/heif'].includes(mime)) {
			logShareMediaStatus({ media: 'fullsize', status: 'failure', statusCode: 404, contentType: mime ?? undefined, byteLength: input.byteLength, failureCategory: 'not-found' });
			return unavailable();
		}
		const bridgeEnabled = Boolean(process.env.HDR_METADATA_PATH || process.env.HDR_COMPOSITOR_PATH || process.env.HDR_FFMPEG_PATH);
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
			const cacheKey = buildHdrCacheKey({ assetId: params.assetId, sourceIdentity, width: requestedWidth, height: requestedHeight });
			output = await getOrCreateHdr(cacheKey, async () => {
				logHdrDiagnostic({ event: 'conversion', assetId: params.assetId, requestId, phase: 'queued', source: 'conversion', status: 'started', queueDepth: getHdrCacheState().waitingConversions, activeConversions: getHdrCacheState().activeConversions });
				return withHdrConcurrency(async () => {
					const conversionStartedAt = Date.now();
					logHdrDiagnostic({ event: 'conversion', assetId: params.assetId, requestId, phase: 'started', source: 'conversion', status: 'started', queueDepth: getHdrCacheState().waitingConversions, activeConversions: getHdrCacheState().activeConversions });
					const compositorPpm = bridgeEnabled
						? await composeHdr(input, metadata, { executable: process.env.HDR_COMPOSITOR_PATH, invocationId: params.assetId })
						: await composeHdr(input, metadata);
					logHdrDiagnostic({ event: 'conversion', assetId: params.assetId, requestId, phase: 'compositor', source: 'conversion', status: 'success', durationMs: Date.now() - conversionStartedAt });
					const body = bridgeEnabled
						? await encodeHdrMp4(compositorPpm, { executable: process.env.HDR_FFMPEG_PATH, invocationId: params.assetId })
						: await encodeHdrMp4(compositorPpm);
					logHdrDiagnostic({ event: 'conversion', assetId: params.assetId, requestId, phase: 'encoder', source: 'conversion', status: 'success', byteLength: body.byteLength, durationMs: Date.now() - conversionStartedAt });
					return { body, contentType: 'video/mp4' };
				}, { priority: conversionPriority, queueKey: cacheKey });
			}, Date.now(), conversionPriority);
		} catch (error) {
			const failureReason = nativeFailureReason(error);
			logHdrDiagnostic({ event: 'conversion', assetId: params.assetId, requestId, phase: 'failed', source: 'conversion', status: 'failure', reason: nativeFailureDetail(error), durationMs: Date.now() - requestStartedAt });
			logShareMediaStatus({ media: 'fullsize', status: 'failure', statusCode: 502, contentType: mime, byteLength: input.byteLength, failureCategory: 'conversion', failureReason, failureDetail: nativeFailureDetail(error) });
			return new Response('HDR conversion unavailable', { status: 502, headers: noStore });
		}
		logHdrDiagnostic({ event: 'conversion', assetId: params.assetId, requestId, phase: 'stored', source: 'conversion', status: 'success', contentType: output.contentType, byteLength: output.body.byteLength, durationMs: Date.now() - requestStartedAt });
		logShareMediaStatus({ media: 'fullsize', status: 'success', contentType: output.contentType, byteLength: output.body.byteLength });
		return hdrVideoResponse(output.body, request.headers.get('range'), { assetId: params.assetId, requestId, source: 'conversion' });
	} catch { logShareMediaStatus({ media: 'fullsize', status: 'failure', failureCategory: 'upstream' }); return unavailable(); }
	};

function boundedDimension(value: string | null): number | undefined {
		if (!value || !/^\d+$/.test(value)) return undefined;
		const parsed = Number(value);
		return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 8192 ? parsed : undefined;
}
