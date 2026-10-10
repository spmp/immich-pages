import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/public';

const eventNames = new Set(['page-model-load', 'hero-load', 'media-load', 'media-failure', 'media-resolution', 'gallery-state', 'fallback', 'empty', 'lightbox', 'presentation-state', 'route-failure', 'hdr-prewarm', 'hdr-media']);
const fields = new Set(['count', 'category', 'status', 'decision', 'slotWidth', 'intrinsicWidth', 'dpr', 'requiredWidth', 'layoutMeasured', 'measuringCompleted', 'fullsizeAvailable', 'promotionFailed', 'fallbackActive', 'assetCount', 'heroPresent', 'template', 'errorContext', 'failureCategory', 'statusCode', 'durationMs', 'imageCount', 'videoCount', 'assetIndex', 'assetTotal', 'urlKind', 'requestPhase', 'bytes', 'cacheReuse', 'prewarmReuse', 'photoSwipeType', 'srcKind', 'spinner', 'hdrReason', 'nativeErrorCode', 'slideIndex', 'slideTotal']);

export const POST: RequestHandler = async ({ request, locals }) => {
	if (env.PUBLIC_PAGES_DEBUG !== 'true') return new Response(null, { status: 404 });
	const contentLength = Number(request.headers.get('content-length') ?? 0);
	if (contentLength > 16_384) return new Response(null, { status: 413 });
	let input: unknown;
	try {
		const body = await request.text();
		if (body.length > 16_384) return new Response(null, { status: 413 });
		input = JSON.parse(body);
	} catch { return new Response(null, { status: 400 }); }
	if (!input || typeof input !== 'object') return new Response(null, { status: 400 });
	const record = input as Record<string, unknown>;
	if (typeof record.event !== 'string' || !eventNames.has(record.event)) return new Response(null, { status: 400 });
	const output: Record<string, unknown> = { event: 'direct-share.client-debug', clientEvent: record.event, requestId: locals.requestId };
	for (const field of fields) {
		const value = record[field];
		if (typeof value === 'string' && value.length <= 80) output[field] = value;
		else if (typeof value === 'boolean') output[field] = value;
		else if (typeof value === 'number' && Number.isFinite(value)) output[field] = Math.max(-100_000_000, Math.min(100_000_000, Math.trunc(value)));
		else if (value === null) output[field] = null;
	}
	const session = record.clientSession;
	if (typeof session === 'string') output.clientSession = session.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 80);
	console.info(JSON.stringify(output));
	return new Response(null, { status: 204 });
};
