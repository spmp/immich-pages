import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');
const debugModule = read('src/lib/components/journal/journal-debug.ts');
const debugRoute = read('src/routes/debug/client/+server.ts');
const indicator = read('src/lib/components/journal/ReadinessIndicator.svelte');

/**
 * hdr-caching-uat-20261010 finding 6c: a client-side readiness/control-plane debug event was
 * explicitly requested ("There may need to be more client logging pushed back to the server in
 * order to properly debug") so the readiness dot's own decision-making is visible in server logs
 * too, not only the server's own hdr-prewarm-request logging added for finding 6b. The 'hdr-
 * prewarm' event name and its field names already existed in both allowlists below (reserved,
 * unused by any call site) -- this closes that gap.
 *
 * Source-contract style, matching this repo's established convention for PUBLIC_PAGES_DEBUG-gated
 * code (see share-readiness-handoff.test.ts, journal-gallery.test.ts): $env/dynamic/public
 * resolves to an empty snapshot outside a running SvelteKit adapter server, so the debug gate
 * itself is not meaningfully executable in this harness -- confirmed directly against this
 * project's vite.config.ts/sveltekit() setup before choosing this approach.
 */
describe('HDR readiness client-debug relay', () => {
	it('reports a bounded hdr-prewarm readiness event, never an asset ID, from the real poll loop', () => {
		expect(indicator).toContain("reportJournalDebug('hdr-prewarm'");
		expect(indicator).not.toMatch(/reportJournalDebug\('hdr-prewarm'[^)]*(?:activeAssetId|currentAssetId)\b/);
	});

	it('allowlists the per-asset-readiness fields server-side, not just the event name', () => {
		expect(debugRoute).toContain("'hdr-prewarm'");
		for (const field of ['readinessState', 'targeted', 'completed', 'failed', 'skipped', 'activeAssetState']) {
			expect(debugRoute).toContain(`'${field}'`);
		}
		// This relay must never accept an asset identifier from the client, regardless of event.
		expect(debugRoute).not.toMatch(/'activeAssetId'|'assetId'/);
	});

	it('builds the readiness debug payload field-by-field in journal-debug.ts, with the same bounding discipline as every other field', () => {
		expect(debugModule).toContain('readinessState');
		expect(debugModule).toContain('activeAssetState');
		expect(debugModule).not.toMatch(/activeAssetId|currentAssetId/);
	});
});
