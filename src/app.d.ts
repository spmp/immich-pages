declare global {
	namespace App {
	interface Locals {
		requestId: string;
	}

	/** Public, non-secret build flag used only to opt into redacted browser diagnostics. */
	interface PublicEnv {
		PUBLIC_PAGES_DEBUG: string;
	}
}
}

export {};
