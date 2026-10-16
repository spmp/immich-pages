import { json } from '@sveltejs/kit';
import { createImmichProvider } from '$server/immich/provider';

import { DEFAULT_SUPPORTED_IMMICH_VERSIONS, satisfiesVersionRange } from '$server/immich/version-range';

// An exact version or a range (e.g. ">=3.1.0 <4.0.0"); see version-range.ts. Informational only.
const supportedVersions = process.env.IMMICH_SUPPORTED_VERSION?.trim() || DEFAULT_SUPPORTED_IMMICH_VERSIONS;
const rendererVersion = process.env.npm_package_version ?? '0.1.0';

export async function GET({ fetch }: { fetch: typeof globalThis.fetch }) {
	try {
		const result = await createImmichProvider(fetch).getVersion();
		if (result.version) {
			const supported = satisfiesVersionRange(result.version, supportedVersions);
			return json({ rendererVersion, immichVersion: result.version, compatibility: supported ? 'supported' : 'unsupported', supportedVersions }, { status: supported ? 200 : 503 });
		}
		return json({ rendererVersion, immichVersion: null, compatibility: 'unavailable', failure: result.status === 401 || result.status === 403 ? 'unauthorized' : result.status === 404 ? 'not-found' : result.status === 422 ? 'malformed-response' : 'upstream-error' }, { status: 503 });
	} catch (error) {
		const failure = error instanceof DOMException && error.name === 'AbortError' ? 'timeout' : 'upstream-error';
		return json({ rendererVersion, immichVersion: null, compatibility: 'unavailable', failure }, { status: 503 });
	}
}
