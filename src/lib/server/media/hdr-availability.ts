import { inferSafeImageMime, readBoundedBytes, IMMICH_MAX_ORIGINAL_BYTES } from '$server/immich/client';
import type { AppleHdrMetadata } from './hdr-metadata';
import { getCachedHdrMetadata, getOrExtractHdrMetadata } from './hdr-metadata-cache';

const headers = (value: 'available' | 'none') => ({ 'x-pages-hdr': value, 'cache-control': 'private, no-store' });

/**
 * Answers "does this photo have an HDR version?" for the HDR media routes' `?probe=1`, without
 * converting anything. The lightbox asks first, so a photo with no HDR data simply stays the
 * standard photo instead of being offered an HDR version that then fails. Uses the same metadata
 * check and cache as the conversion itself, so the answer and the conversion can never disagree,
 * and a photo is read at most once.
 *
 * 204 + `x-pages-hdr: available`, or 404 + `x-pages-hdr: none`. Share membership and
 * authorization are checked by the route before this is reached.
 */
export async function probeHdrAvailability(source: Response, metadataCacheKey: string, extract: (bytes: Uint8Array) => Promise<AppleHdrMetadata | undefined>): Promise<Response> {
	const cached = getCachedHdrMetadata(metadataCacheKey);
	if (cached.hit) {
		await source.body?.cancel().catch(() => {});
		return cached.value ? new Response(null, { status: 204, headers: headers('available') }) : new Response(null, { status: 404, headers: headers('none') });
	}
	try {
		const bytes = await readBoundedBytes(source, IMMICH_MAX_ORIGINAL_BYTES);
		const mime = inferSafeImageMime(bytes, source.headers.get('content-type'));
		if (!mime || !['image/heic', 'image/heif'].includes(mime)) return new Response(null, { status: 404, headers: headers('none') });
		const metadata = await getOrExtractHdrMetadata(metadataCacheKey, () => extract(bytes));
		return metadata ? new Response(null, { status: 204, headers: headers('available') }) : new Response(null, { status: 404, headers: headers('none') });
	} catch {
		// Unknown, not "none": the lightbox then tries the HDR version as before.
		return new Response(null, { status: 502, headers: { 'cache-control': 'private, no-store' } });
	}
}
