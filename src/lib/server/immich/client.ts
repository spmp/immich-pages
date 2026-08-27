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
	if (declaredLength && Number(declaredLength) > maxBytes) throw new Error('response-too-large');
	const text = await response.text();
	if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error('response-too-large');
	return text;
}
