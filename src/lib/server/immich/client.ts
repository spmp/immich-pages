import { upstreamHeaders, type AuthContext } from './auth-context';

export async function requestImmich(
	baseUrl: string,
	path: string,
	context: AuthContext,
	fetchImpl: typeof fetch = fetch
): Promise<Response> {
	const target = new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
	return fetchImpl(target, { headers: upstreamHeaders(context) });
}
