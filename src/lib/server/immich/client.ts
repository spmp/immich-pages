import { upstreamHeaders, type AuthContext } from './auth-context';

export const IMMICH_REQUEST_TIMEOUT_MS = 5_000;
export const IMMICH_MAX_RESPONSE_BYTES = 1_048_576;

export async function requestImmich(
	baseUrl: string,
	path: string,
	context: AuthContext,
	fetchImpl: typeof fetch = fetch,
	options: { timeoutMs?: number } = {}
): Promise<Response> {
	const target = new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? IMMICH_REQUEST_TIMEOUT_MS);
	try {
		return await fetchImpl(target, { headers: upstreamHeaders(context), signal: controller.signal });
	} finally {
		clearTimeout(timeout);
	}
}

export async function readBoundedText(response: Response, maxBytes = IMMICH_MAX_RESPONSE_BYTES): Promise<string> {
	const declaredLength = response.headers.get('content-length');
	const declaredBytes = declaredLength === null ? null : Number(declaredLength);
	if (declaredBytes !== null && Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
		throw new Error('response-too-large');
	}

	if (!response.body) return '';
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let bytes = 0;
	let text = '';
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			bytes += value.byteLength;
			if (bytes > maxBytes) {
				await reader.cancel();
				throw new Error('response-too-large');
			}
			text += decoder.decode(value, { stream: true });
		}
		return text + decoder.decode();
	} finally {
		reader.releaseLock();
	}
}
