import { env } from '$env/dynamic/public';

/** Escape hatch for the heuristic below: when set, every HDR-eligible asset serves the AVIF
 * gain-map candidate regardless of display/engine, relying entirely on the format's own
 * automatic SDR degrade on decoders that don't understand the gain map. Useful for gathering
 * real-world results across devices faster than the allowlist below can be hand-maintained. */
export const HDR_FORCE_AVIF = env.PUBLIC_HDR_FORCE_AVIF === 'true';

/** No browser API reports "this decoder honors AVIF gain maps as real HDR" -- a standards-
 * compliant AVIF decoder that ignores the gain map still decodes successfully, just flat/SDR, so
 * decode-success probing (see probeImageDecode below) can't distinguish the two cases either.
 * This is therefore a hand-maintained allowlist based on direct real-device observation:
 * Chromium (desktop, confirmed) renders the gain map correctly; Safari's support threshold is
 * still being pinned down (WebKit 18.6 confirmed NOT to show real HDR; iOS 26 is the first
 * version under live test). Update AVIF_GAINMAP_MIN_SAFARI_VERSION once that result is in. */
const AVIF_GAINMAP_MIN_SAFARI_VERSION = 26;

function safariVersion(ua: string): number | null {
	if (!/Safari\//.test(ua) || /Chrome\/|Chromium\/|CriOS\/|FxiOS\/|EdgiOS\//.test(ua)) return null;
	const match = ua.match(/Version\/(\d+)/);
	return match ? Number(match[1]) : null;
}

export function supportsAvifGainMapHdr(): boolean {
	if (HDR_FORCE_AVIF) return true;
	if (typeof navigator === 'undefined') return false;
	const ua = navigator.userAgent;
	if (/Chrome\/|Chromium\//.test(ua) && !/Edg\//.test(ua)) return true;
	const safari = safariVersion(ua);
	return safari !== null && safari >= AVIF_GAINMAP_MIN_SAFARI_VERSION;
}

/** Browser-only capability checks. They are presentation hints, never auth decisions. */
export function supportsHdrDisplay(): boolean {
	return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(dynamic-range: high)').matches;
}

export function supportsWideColorGamut(): boolean {
	if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
	return window.matchMedia('(color-gamut: p3)').matches || window.matchMedia('(color-gamut: rec2020)').matches;
}

function isSameOriginPath(src: string): boolean {
	if (!src.startsWith('/') || src.startsWith('//')) return false;
	if (typeof window === 'undefined') return true;
	try {
		return new URL(src, window.location.origin).origin === window.location.origin;
	} catch {
		return false;
	}
}

export async function probeImageDecode(src: string, timeoutMs = 1500): Promise<boolean> {
	if (typeof Image === 'undefined' || !isSameOriginPath(src)) return false;
	const boundedTimeout = Number.isFinite(timeoutMs) ? Math.max(1, Math.min(timeoutMs, 5000)) : 1500;
	return new Promise((resolve) => {
		const image = new Image();
		let settled = false;
		const finish = (result: boolean) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(result);
		};
		const timer = setTimeout(() => finish(false), boundedTimeout);
		image.onload = () => finish(true);
		image.onerror = () => finish(false);
		image.src = src;
	});
}
