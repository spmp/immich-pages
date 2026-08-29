import type { RequestHandler } from './$types';
import { authContextFromRequest } from '$server/immich/auth-context';
import { createImmichProvider } from '$server/immich/provider';
import { parseSharedLinkRef } from '$server/share/ref';
import { z } from 'zod';
import { logShareMediaStatus } from '$server/share/diagnostics';

const MAX_VIDEO_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_VIDEO_RANGE_BYTES = 8 * 1024 * 1024;
const RANGE = /^bytes=(\d+)-(\d+)$/;
const OPEN_RANGE = /^bytes=(\d+)-$/;

function rangeValue(value: string | null): { value?: string; max: number } | { invalid: true } {
	if (value === null) return { max: MAX_VIDEO_RESPONSE_BYTES };
	if (!/^[\x21-\x7e]+$/.test(value) || value.includes(',')) return { invalid: true };
	const closed = value.match(RANGE);
	const open = value.match(OPEN_RANGE);
	if (!closed && !open) return { invalid: true };
	if (closed) {
		const start = Number(closed[1]);
		const end = Number(closed[2]);
		if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start || end - start + 1 > MAX_VIDEO_RANGE_BYTES) return { invalid: true };
		return { value, max: MAX_VIDEO_RANGE_BYTES };
	}
	if (!Number.isSafeInteger(Number(open![1]))) return { invalid: true };
	return { value, max: MAX_VIDEO_RANGE_BYTES };
}

function safeHeaders(upstream: Response): Headers {
	const headers = new Headers();
	for (const name of ['content-type', 'content-range', 'accept-ranges']) {
		const value = upstream.headers.get(name);
		if (value) headers.set(name, value);
	}
	headers.set('cache-control', 'private, no-store');
	return headers;
}

async function boundedBody(response: Response, max: number, declared: number | null): Promise<ReadableStream<Uint8Array> | null> {
	if (!response.body) return null;
	const reader = response.body.getReader();
	let total = 0;
	return new ReadableStream({
		async pull(controller) {
			try {
				const { done, value } = await reader.read();
				if (done) { reader.releaseLock(); if (declared !== null && total !== declared) controller.error(new Error('video-response-truncated')); else controller.close(); return; }
				total += value.byteLength;
				if (total > max) { await reader.cancel('video-response-limit'); controller.error(new Error('video-response-limit')); return; }
				controller.enqueue(value);
			} catch (error) { controller.error(error); }
		},
		async cancel(reason) { await reader.cancel(reason); }
	});
}

export const GET: RequestHandler = async ({ params, request, locals, fetch }) => {
	const shareRef = parseSharedLinkRef(params.kind, params.ref);
	if (!shareRef || !z.uuidv4().safeParse(params.assetId).success) return new Response('Media not found', { status: 404 });
	const parsedRange = rangeValue(request.headers.get('range'));
	if ('invalid' in parsedRange) return new Response('Range not satisfiable', { status: 416, headers: { 'content-range': 'bytes */*', 'cache-control': 'private, no-store' } });
	let result: Awaited<ReturnType<ReturnType<typeof createImmichProvider>['getVideoPlayback']>>;
	try { result = await createImmichProvider(fetch).getVideoPlayback(authContextFromRequest(request, shareRef), params.assetId, parsedRange.value); }
	catch { logShareMediaStatus({ media: 'video', status: 'failure', failureCategory: 'upstream' }); return new Response('Immich is unavailable', { status: 502 }); }
	if (result.error === 'asset-mismatch' || result.error === 'not-video' || result.status === 404) { logShareMediaStatus({ media: 'video', status: 'failure', failureCategory: 'not-found' }); return new Response('Media not found', { status: 404 }); }
	if (result.status === 401 || result.status === 403) { logShareMediaStatus({ media: 'video', status: 'failure', failureCategory: 'unauthorized' }); return new Response('Media not authorized', { status: 403 }); }
	if (!result.response) { logShareMediaStatus({ media: 'video', status: 'failure', failureCategory: 'upstream' }); return new Response('Immich is unavailable', { status: 502 }); }
	if (result.status === 416) return new Response(null, { status: 416, headers: safeHeaders(result.response) });
	if (result.status !== 200 && result.status !== 206) return new Response('Immich is unavailable', { status: 502 });
	const lengthText = result.response.headers.get('content-length');
	const length = lengthText === null ? null : Number(lengthText);
	if (length !== null && (!Number.isSafeInteger(length) || length > parsedRange.max)) return new Response('Media response unavailable', { status: 502 });
	const contentRange = result.response.headers.get('content-range');
	if (result.status === 206 && (!contentRange || !/^bytes \d+-\d+\/\d+$/.test(contentRange))) return new Response('Media response unavailable', { status: 502 });
	if (result.status === 206 && contentRange) {
		const match = contentRange.match(/^bytes (\d+)-(\d+)\/(\d+|\*)$/);
		if (!match || Number(match[2]) < Number(match[1]) || Number(match[2]) - Number(match[1]) + 1 > MAX_VIDEO_RANGE_BYTES || (length !== null && Number(match[2]) - Number(match[1]) + 1 !== length)) return new Response('Media response unavailable', { status: 502 });
	}
	const body = await boundedBody(result.response, parsedRange.max, length);
	logShareMediaStatus({ media: 'video', status: 'success' });
	return new Response(body, { status: result.status, headers: safeHeaders(result.response) });
};
