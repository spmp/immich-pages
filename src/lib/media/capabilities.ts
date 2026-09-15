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
