import { json } from '@sveltejs/kit';
import { createImmichProvider } from '$server/immich/provider';
import { IMMICH_REQUEST_TIMEOUT_MS } from '$server/immich/client';

const expectedVersion = (process.env.IMMICH_SUPPORTED_VERSION ?? '1.143.1').replace(/^v/, '');
const rendererVersion = process.env.npm_package_version ?? '0.1.0';

export async function GET({ fetch }: { fetch: typeof globalThis.fetch }) {
	try {
		const result = await createImmichProvider(fetch).getVersion();
		if (result.version) {
			const observedVersion = result.version.replace(/^v/, '');
			return json({ rendererVersion, immichVersion: result.version, compatibility: observedVersion === expectedVersion ? 'supported' : 'unsupported' }, { status: observedVersion === expectedVersion ? 200 : 503 });
		}
		return json({ rendererVersion, immichVersion: null, compatibility: 'unavailable', failure: result.status === 401 || result.status === 403 ? 'unauthorized' : result.status === 404 ? 'not-found' : result.status === 422 ? 'malformed-response' : 'upstream-error' }, { status: 503 });
	} catch (error) {
		const failure = error instanceof DOMException && error.name === 'AbortError' ? 'timeout' : 'upstream-error';
		return json({ rendererVersion, immichVersion: null, compatibility: 'unavailable', failure, timeoutMs: failure === 'timeout' ? IMMICH_REQUEST_TIMEOUT_MS : undefined }, { status: 503 });
	}
}
