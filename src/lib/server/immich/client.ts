import { upstreamHeaders, type AuthContext } from './auth-context';
import { logImmichRequest } from '$server/share/diagnostics';

export const IMMICH_REQUEST_TIMEOUT_MS = 5_000;
export const IMMICH_MAX_RESPONSE_BYTES = 1_048_576;
export const IMMICH_MAX_MEDIA_BYTES = 10 * 1_048_576;

export function immichOrigin(baseUrl: string): string {
	const parsed = new URL(baseUrl);
	if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
		throw new Error('invalid-immich-origin');
	}
	return parsed.origin;
}

export function shareQuery(context: AuthContext): string {
	return `${context.shareRef.kind}=${encodeURIComponent(context.shareRef.value)}`;
}

export async function requestImmich(
	baseUrl: string,
	path: string,
	context: AuthContext,
	fetchImpl: typeof fetch = fetch,
	options: { timeoutMs?: number; headers?: HeadersInit; method?: string; body?: BodyInit | null; endpoint?: 'shared-link' | 'album-assets' | 'thumbnail' | 'video' | 'version' } = {}
): Promise<Response> {
	const origin = immichOrigin(baseUrl);
	const apiPath = path.startsWith('/api/') ? path.slice(4) : path.startsWith('api/') ? path.slice(3) : path;
	const target = new URL(`/api/${apiPath.replace(/^\/+/, '')}`, origin);
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? IMMICH_REQUEST_TIMEOUT_MS);
	try {
		const headers = upstreamHeaders(context);
		for (const [name, value] of new Headers(options.headers)) headers.set(name, value);
		const response = await fetchImpl(target, { method: options.method ?? 'GET', body: options.body, headers, signal: controller.signal });
		if (options.endpoint) logImmichRequest({ endpoint: options.endpoint, status: response.status });
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
