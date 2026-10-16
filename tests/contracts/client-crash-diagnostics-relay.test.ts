import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');
const debugModule = read('src/lib/components/journal/journal-debug.ts');
const debugRoute = read('src/routes/debug/client/+server.ts');
const lightbox = read('src/lib/components/journal/Lightbox.svelte');
const clientHooks = () => read('src/hooks.client.ts');

/**
 * lightbox-mobile-crash: the lightbox on a real phone intermittently reloads the page or lands
 * back on the library, with no devtools available to see why. These events exist so the cause
 * can be read from the server log alone.
 *
 * Source-contract style, matching this repo's convention for PUBLIC_PAGES_DEBUG-gated code (see
 * hdr-readiness-debug-relay.test.ts for why the gate itself is not executable in this harness).
 * The behavior behind these events is executed for real in tests/unit/client-diagnostics.test.ts.
 */
const events = ['client-error', 'page-entry', 'previous-session', 'page-exit', 'visibility', 'history', 'navigation', 'resource-gauge', 'dev-reload'];

describe('client crash diagnostics relay', () => {
	it('allowlists every crash-diagnostic event in both the client module and the server route', () => {
		for (const event of events) {
			expect(debugModule).toContain(`'${event}'`);
			expect(debugRoute).toContain(`'${event}'`);
		}
	});

	it('accepts the crash-diagnostic fields server-side', () => {
		for (const field of ['seq', 'tMs', 'errorKind', 'errorName', 'errorMessage', 'errorStack', 'navType', 'routeKind', 'historyLength', 'historyAction', 'modalHistory', 'exitCause', 'persisted', 'lightboxOpen', 'navToRoute', 'decodedMegapixels', 'lightboxMegapixels', 'retainedHdr', 'liveVideos', 'slidesViewed', 'prevExit', 'prevIdleMs', 'prevLastEvent', 'prevSession']) {
			expect(debugRoute).toContain(`'${field}'`);
		}
		// Free-form error text is redacted again on the server, not trusted from the client.
		expect(debugRoute).toContain('redactDiagnosticText');
		expect(debugRoute).not.toMatch(/'activeAssetId'|'assetId'/);
	});

	it('does not let the diagnostic events fall silent in a long session', () => {
		expect(debugModule).toMatch(/uncappedEvents/);
	});

	it('keeps the HDR media lifecycle visible to the end of a session, and reports what state the held videos are in', () => {
		// pages-lightbox-weirdness_01: both tab kills came long after hdr-media had spent its
		// relay budget, so the slides that went black left no trace of their own.
		expect(debugModule).toMatch(/uncappedEvents = new Set[^\n]*'hdr-media'[^\n]*'media-failure'/);
		for (const field of ['videosHeld', 'videosWithFrame', 'videosFrameless', 'videosPlaying', 'videosErrored']) {
			expect(debugModule).toContain(field);
			expect(debugRoute).toContain(`'${field}'`);
		}
		expect(lightbox).toContain('measureVideoStates');
	});

	it('installs global capture once for the whole client app, and reports SvelteKit and dev-server reloads', () => {
		const hooks = clientHooks();
		expect(hooks).toContain('installClientDiagnostics');
		expect(hooks).toContain('handleError');
		expect(hooks).toContain('vite:beforeFullReload');
	});

	it('traces the lightbox history handshake, leaving the page, and what it is holding in memory', () => {
		expect(lightbox).toContain("reportJournalDebug('history'");
		expect(lightbox).toContain("reportJournalDebug('navigation'");
		expect(lightbox).toContain("reportJournalDebug('resource-gauge'");
		expect(lightbox).toContain('beforeNavigate');
		expect(lightbox).toContain("setExitCause('lightbox-close-back')");
		// The init failure used to be swallowed by a bare catch.
		expect(lightbox).toContain("reportError('lightbox-init'");
		expect(lightbox).not.toMatch(/reportJournalDebug\('(?:history|navigation|resource-gauge)'[^)]*(?:assetId|href|src:)/);
	});
});
