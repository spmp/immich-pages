import type { RequestHandler } from './$types';
import { authContextFromRequest } from '$server/immich/auth-context';
import { createImmichProvider } from '$server/immich/provider';
import { inferSafeImageMime, readBoundedBytes, IMMICH_MAX_ORIGINAL_BYTES } from '$server/immich/client';
import { parseSharedLinkRef } from '$server/share/ref';
import { z } from 'zod';
import { extractImmichShareToken, PAGES_SESSION_COOKIE, sessionForShare } from '$server/share/session';
import { logShareMediaStatus } from '$server/share/diagnostics';
import { composeHdr, encodeHdrMp4, nativeFailureDetail, nativeFailureReason } from '$server/media/hdr-compositor';
import { buildHdrCacheKey, getOrCreateHdr, withHdrConcurrency } from '$server/media/hdr-cache';
import { extractAppleHdrMetadata } from '$server/media/hdr-metadata';
import { buildHdrMetadataCacheKey, getCachedHdrMetadata, getOrExtractHdrMetadata } from '$server/media/hdr-metadata-cache';

const noStore = { 'cache-control': 'private, no-store' };
const unavailable = () => new Response('HDR unavailable', { status: 404, headers: noStore });

// Safari/WebKit's native <video> element is markedly stricter than Chromium about a server
// actually honoring Range requests before it will play a source at all -- it commonly probes
// with a Range request to establish seekability/duration before starting playback, and a plain
// 200-with-full-body response to that probe can make it refuse to ever start. The whole HDR
// video is already fully buffered in memory by the time this runs, so honoring Range here is
// just slicing that buffer, not proxying/coordinating with anything upstream.
function hdrVideoResponse(body: Uint8Array, rangeHeader: string | null): Response {
	const total = body.byteLength;
	const headers = { 'content-type': 'video/mp4', 'accept-ranges': 'bytes', ...noStore };
	if (!rangeHeader) {
		// body.buffer is a view into Node's shared pool slab for small allocations, not just
		// these bytes -- slice() copies exactly this view's own byte range into a fresh ArrayBuffer.
		return new Response(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer, { headers: { ...headers, 'content-length': String(total) } });
	}
	const match = /^bytes=(\d+)-(\d+)?$/.exec(rangeHeader);
	const start = match ? Number(match[1]) : NaN;
	const end = match ? (match[2] !== undefined ? Number(match[2]) : total - 1) : NaN;
	if (!match || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= total) {
		return new Response(null, { status: 416, headers: { ...headers, 'content-range': `bytes */${total}` } });
	}
	const boundedEnd = Math.min(end, total - 1);
	const slice = body.subarray(start, boundedEnd + 1);
	return new Response(slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength) as ArrayBuffer, {
		status: 206,
		headers: { ...headers, 'content-length': String(slice.byteLength), 'content-range': `bytes ${start}-${boundedEnd}/${total}` }
	});
}

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
	try {
		const input = await readBoundedBytes(source.response, IMMICH_MAX_ORIGINAL_BYTES);
		const requestUrl = new URL(request.url);
		const requestedWidth = boundedDimension(requestUrl.searchParams.get('width'));
		const requestedHeight = boundedDimension(requestUrl.searchParams.get('height'));
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
				return withHdrConcurrency(async () => {
					const compositorPpm = bridgeEnabled
						? await composeHdr(input, metadata, { executable: process.env.HDR_COMPOSITOR_PATH, invocationId: params.assetId })
						: await composeHdr(input, metadata);
					const body = bridgeEnabled
						? await encodeHdrMp4(compositorPpm, { executable: process.env.HDR_FFMPEG_PATH, invocationId: params.assetId })
						: await encodeHdrMp4(compositorPpm);
					return { body, contentType: 'video/mp4' };
				});
			});
		} catch (error) {
			const failureReason = nativeFailureReason(error);
			logShareMediaStatus({ media: 'fullsize', status: 'failure', statusCode: 502, contentType: mime, byteLength: input.byteLength, failureCategory: 'conversion', failureReason, failureDetail: nativeFailureDetail(error) });
			return new Response('HDR conversion unavailable', { status: 502, headers: noStore });
		}
		logShareMediaStatus({ media: 'fullsize', status: 'success', contentType: output.contentType, byteLength: output.body.byteLength });
		return hdrVideoResponse(output.body, request.headers.get('range'));
	} catch { logShareMediaStatus({ media: 'fullsize', status: 'failure', failureCategory: 'upstream' }); return unavailable(); }
	};

function boundedDimension(value: string | null): number | undefined {
		if (!value || !/^\d+$/.test(value)) return undefined;
		const parsed = Number(value);
		return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 8192 ? parsed : undefined;
}
