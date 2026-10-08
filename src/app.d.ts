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
		/** When 'true', shows the lightbox zoom-button HDR tri-state tint (white/khaki/blue) and
		 * the on-screen HDR status line -- debugging aids for whether a gain map was detected and
		 * whether its HDR media actually attached, not something a regular viewer should see. Off
		 * by default -- see hdrDebugEnabled in Lightbox.svelte. */
		PUBLIC_HDR_DEBUG: string;
		/** Milliseconds the lightbox waits for an HDR video/AVIF conversion before giving up and
		 * settling for the SDR photo. Defaults to 60000 if unset/invalid; clamped to 600000 (10min)
		 * -- see hdrClientTimeoutMs in Lightbox.svelte. */
		PUBLIC_HDR_CLIENT_TIMEOUT_MS: string;
	}
}
}

export {};
