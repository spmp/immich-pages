declare global {
	namespace App {
	interface Locals {
		requestId: string;
	}

	/** Public, non-secret build flag used only to opt into redacted browser diagnostics. */
	interface PublicEnv {
		PUBLIC_PAGES_DEBUG: string;
		/** When 'true', bypasses the Safari/Chromium AVIF-gain-map-support allowlist and always
		 * serves the AVIF HDR candidate for HDR-eligible assets -- see HDR_FORCE_AVIF in
		 * $lib/media/capabilities.ts. */
		PUBLIC_HDR_FORCE_AVIF: string;
	}
}
}

export {};
