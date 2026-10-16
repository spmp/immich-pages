const STYLE_ENV_KEYS = {
	'quiet-atlas': 'MAP_STYLE_URL_QUIET_ATLAS'
} as const;

export type MapStyleName = keyof typeof STYLE_ENV_KEYS;

// Used when the deployment sets no URL for a style, so a minimal V1 deployment (IMMICH_BASE_URL
// plus the two cookie secrets) still draws a basemap. OpenFreeMap needs no API key. The style
// URL remains deployment-owned either way: album descriptions can never supply one.
export const DEFAULT_STYLE_URLS: Record<MapStyleName, string> = {
	'quiet-atlas': 'https://tiles.openfreemap.org/styles/liberty'
};

export type MapStyleResolution =
	| { kind: 'resolved'; name: MapStyleName; url: string }
	| { kind: 'warning'; warning: 'content-controlled-style-url' | 'unknown-style' | 'invalid-style-url' };

function isStyleName(value: unknown): value is MapStyleName {
	return typeof value === 'string' && Object.hasOwn(STYLE_ENV_KEYS, value);
}

function isTrustedStyleUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return (url.protocol === 'https:' || url.protocol === 'http:') && Boolean(url.hostname) && !url.username && !url.password;
	} catch {
		return false;
	}
}

/** Resolve a presentation style name using deployment-owned configuration only. */
export function resolveMapStyle(input: unknown, env: Record<string, string | undefined> = process.env): MapStyleResolution {
	if (!input || typeof input !== 'object' || Array.isArray(input)) return { kind: 'warning', warning: 'unknown-style' };
	if (Object.hasOwn(input, 'styleUrl')) return { kind: 'warning', warning: 'content-controlled-style-url' };

	const styleName = (input as { styleName?: unknown }).styleName;
	if (!isStyleName(styleName)) return { kind: 'warning', warning: 'unknown-style' };

	const configuredUrl = env[STYLE_ENV_KEYS[styleName]]?.trim() || DEFAULT_STYLE_URLS[styleName];
	if (!isTrustedStyleUrl(configuredUrl)) return { kind: 'warning', warning: 'invalid-style-url' };

	return { kind: 'resolved', name: styleName, url: configuredUrl };
}
