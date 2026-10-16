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
		/** Unless 'false', tints the lightbox zoom (magnifier) button for a photo with an HDR
		 * version: khaki while it loads, blue once it is showing. On by default -- see
		 * hdrZoomIndicatorEnabled in Lightbox.svelte. */
		PUBLIC_HDR_ZOOM_INDICATOR: string;
		/** When 'true', shows the on-screen HDR status line in the lightbox -- a debugging aid for
		 * whether a gain map was detected and whether its HDR media actually attached. Off by
		 * default -- see hdrDebugEnabled in Lightbox.svelte. */
		PUBLIC_HDR_DEBUG: string;
		/** Milliseconds the lightbox waits for an HDR video/AVIF conversion before giving up and
		 * settling for the SDR photo. Defaults to 60000 if unset/invalid; clamped to 600000 (10min)
		 * -- see hdrClientTimeoutMs in Lightbox.svelte. */
		PUBLIC_HDR_CLIENT_TIMEOUT_MS: string;
		/** How many background HDR prewarm fetches one browser tab issues in parallel. A
		 * per-client limit, separate from the server's own HDR_MAX_CONCURRENT (which bounds
		 * simultaneous native conversions across every client). Defaults to 2 if unset/invalid;
		 * clamped to 16 -- see maxConcurrent in JournalGallery.svelte. */
		PUBLIC_HDR_PREWARM_CONCURRENCY: string;
	}
}
}

export {};
