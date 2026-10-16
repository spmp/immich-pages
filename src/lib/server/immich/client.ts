import { upstreamHeaders, type AuthContext } from './auth-context';
import { logImmichRedirect, logImmichRequest } from '$server/share/diagnostics';

export const IMMICH_REQUEST_TIMEOUT_MS = 5_000;
export const IMMICH_MAX_RESPONSE_BYTES = 1_048_576;
export const IMMICH_MAX_MEDIA_BYTES = 10 * 1_048_576;
export const IMMICH_MAX_ORIGINAL_BYTES = 100 * 1_048_576;

const IMAGE_MIME_TYPES = new Set(['image/avif', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']);

export function inferSafeImageMime(bytes: Uint8Array, declaredType: string | null): string | null {
	const type = declaredType?.split(';', 1)[0]?.trim().toLowerCase();
	if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
	if (bytes.length >= 8 && bytes.subarray(0, 8).every((byte, index) => byte === [137, 80, 78, 71, 13, 10, 26, 10][index])) return 'image/png';
	if (bytes.length >= 6 && (new TextDecoder().decode(bytes.subarray(0, 6)) === 'GIF87a' || new TextDecoder().decode(bytes.subarray(0, 6)) === 'GIF89a')) return 'image/gif';
	if (bytes.length >= 12 && new TextDecoder().decode(bytes.subarray(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.subarray(8, 12)) === 'WEBP') return 'image/webp';
	if (bytes.length >= 12 && new TextDecoder().decode(bytes.subarray(4, 8)) === 'ftyp') {
		const brand = new TextDecoder().decode(bytes.subarray(8, 12));
		if (['avif', 'avis'].includes(brand)) return 'image/avif';
		if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand)) return 'image/heif';
	}
	return type && IMAGE_MIME_TYPES.has(type) && bytes.length > 0 ? type : null;
}

export function immichOrigin(baseUrl: string): string {
	const parsed = new URL(baseUrl);
	if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
		throw new Error('invalid-immich-origin');
	}
	return parsed.origin;
}

export function shareQuery(context: AuthContext): string {
	if (!('shareRef' in context)) return '';
	return `${context.shareRef.kind}=${encodeURIComponent(context.shareRef.value)}`;
}

export async function requestImmich(
	baseUrl: string,
	path: string,
	context: AuthContext,
	fetchImpl: typeof fetch = fetch,
	options: { timeoutMs?: number; headers?: HeadersInit; method?: string; body?: BodyInit | null; redirect?: RequestRedirect; endpoint?: 'shared-link' | 'album-assets' | 'thumbnail' | 'video' | 'version' | 'map-markers' | 'current-user' | 'albums' | 'album'; sameOriginRedirectPathPrefix?: string } = {}
): Promise<Response> {
	const origin = immichOrigin(baseUrl);
	const apiPath = path.startsWith('/api/') ? path.slice(4) : path.startsWith('api/') ? path.slice(3) : path;
	const target = new URL(`/api/${apiPath.replace(/^\/+/, '')}`, origin);
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? IMMICH_REQUEST_TIMEOUT_MS);
	try {
		const headers = upstreamHeaders(context);
		for (const [name, value] of new Headers(options.headers)) headers.set(name, value);
		let response = await fetchImpl(target, { method: options.method ?? 'GET', body: options.body, headers, redirect: options.redirect, credentials: 'omit', signal: controller.signal });
		if (options.endpoint) logImmichRequest({ endpoint: options.endpoint, status: response.status });
		if (options.sameOriginRedirectPathPrefix && response.status >= 300 && response.status < 400) {
			const location = response.headers.get('location');
			if (!location) { logImmichRedirect({ endpoint: options.endpoint === 'thumbnail' || options.endpoint === 'video' ? options.endpoint : 'thumbnail', classification: 'missing' }); throw new Error('redirect-without-location'); }
			const redirected = new URL(location, origin);
			const classification = redirected.origin !== origin
				? 'external'
				: /\/original(?:\/|$)|\/download(?:\/|$)/.test(redirected.pathname)
					? 'original-or-download'
					: redirected.pathname === options.sameOriginRedirectPathPrefix ? 'same-origin-allowed' : 'other';
			logImmichRedirect({ endpoint: options.endpoint === 'thumbnail' || options.endpoint === 'video' ? options.endpoint : 'thumbnail', classification });
			if (classification !== 'same-origin-allowed') throw new Error('unsafe-fullsize-redirect');
			response = await fetchImpl(redirected, { method: options.method ?? 'GET', body: options.body, headers, redirect: 'error', credentials: 'omit', signal: controller.signal });
			if (options.endpoint) logImmichRequest({ endpoint: options.endpoint, status: response.status });
		}
		return response;
	} catch (error) {
		if (options.endpoint) logImmichRequest({ endpoint: options.endpoint, status: 'failure', failureCategory: error instanceof DOMException && error.name === 'AbortError' ? 'timeout' : 'network' });
		throw error;
	} finally {
		clearTimeout(timeout);
	}
}

export async function readBoundedText(response: Response, maxBytes = IMMICH_MAX_RESPONSE_BYTES): Promise<string> {
	return new TextDecoder().decode(await readBoundedBytes(response, maxBytes));
}

export async function readBoundedBytes(response: Response, maxBytes = IMMICH_MAX_RESPONSE_BYTES): Promise<Uint8Array> {
	const declaredLength = response.headers.get('content-length');
	const declaredBytes = declaredLength === null ? null : Number(declaredLength);
	if (declaredBytes !== null && Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
		throw new Error('response-too-large');
	}

	if (!response.body) return new Uint8Array();
	const reader = response.body.getReader();
	let bytes = 0;
	const chunks: Uint8Array[] = [];
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			bytes += value.byteLength;
			if (bytes > maxBytes) {
				await reader.cancel();
				throw new Error('response-too-large');
			}
			chunks.push(value);
		}
		const result = new Uint8Array(bytes);
		let offset = 0;
		for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
		return result;
	} finally {
		reader.releaseLock();
	}
}
