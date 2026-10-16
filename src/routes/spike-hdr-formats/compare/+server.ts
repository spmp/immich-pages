import type { RequestHandler } from './$types';
import { SPIKE_HDR_ENABLED } from '$server/media/spike-hdr-formats';

/** Bare /spike-hdr-formats/compare with no fixture/format: default straight to the real 2.HEIF
 * fixture against AVIF, the current focus candidate, instead of making the user know the full
 * nested URL. */
export const GET: RequestHandler = ({ url }) => {
	if (!SPIKE_HDR_ENABLED) return new Response('Not found', { status: 404, headers: { 'cache-control': 'private, no-store' } });
	const target = new URL('/spike-hdr-formats/compare/ref/avif-hdr.avif', url);
	target.search = url.search;
	return new Response(null, { status: 302, headers: { location: target.pathname + target.search, 'cache-control': 'private, no-store' } });
};
