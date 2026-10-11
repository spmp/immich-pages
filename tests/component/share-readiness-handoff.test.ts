import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('share readiness handoff', () => {
	it('passes only the parsed server boolean through the real composition path', () => {
		const server = read('src/routes/share/[kind]/[ref]/+page.server.ts');
		const route = read('src/routes/share/[kind]/[ref]/+page.svelte');
		const journal = read('src/lib/components/journal/JournalPage.svelte');
		const indicator = read('src/lib/components/journal/ReadinessIndicator.svelte');
		expect(server).toContain('indicatorEnabled: indicator.enabled');
		expect(server).not.toContain('indicatorValue');
		expect(route).toContain('indicatorEnabled={data.indicatorEnabled}');
		expect(journal).toContain('indicatorEnabled = false');
		expect(journal).toContain('<ReadinessIndicator enabled={indicatorEnabled}');
		expect(indicator).toContain('window.location.pathname}/prewarm');
		expect(indicator).toContain("credentials: 'same-origin'");
		expect(indicator).not.toMatch(/process\.env|import\.meta\.env|HDR_PREWARM_INDICATOR/);
	});

	it('keeps SSR, SDR, navigation, and PhotoSwipe nonblocking', () => {
		const indicator = read('src/lib/components/journal/ReadinessIndicator.svelte');
		const journal = read('src/lib/components/journal/JournalPage.svelte');
		expect(indicator).toContain('onMount');
		expect(indicator).toContain('pointer-events: none');
		expect(indicator).toContain("readinessState === 'partial'");
		expect(indicator).toContain("readinessState === 'ready'");
		expect(indicator).toContain('prefers-reduced-motion');
		expect(journal).toContain('<JournalGallery');
		expect(journal).toContain('<MobileDrawer');
	});

	it('omits the element when disabled or there is no eligible target', () => {
		const indicator = read('src/lib/components/journal/ReadinessIndicator.svelte');
		expect(indicator).toContain('{#if enabled && activeAssetId && progress.targeted !== 0}');
		expect(indicator).toContain('aria-live="polite"');
		expect(indicator).toContain('role="status"');
		expect(indicator).toContain('aria-busy={readinessState === \'preparing\'}');
		expect(indicator).toContain('if (!response.ok)');
		expect(indicator).not.toMatch(/sourceIdentity|sourceBytes|cookie|authorization|requestId/);
	});

	// hdr-caching-uat-20261010 root_cause (3): the dot must reflect the status of the viewer's OWN
	// active asset, not only the aggregate prewarm window -- the server-computed activeAssetState
	// must be accepted by the response validator and passed through to resolveHdrReadiness, not
	// silently dropped by a shape check that only knows about the older aggregate fields.
	it('accepts and forwards the server\'s per-asset activeAssetState, not just the aggregate window', () => {
		const indicator = read('src/lib/components/journal/ReadinessIndicator.svelte');
		expect(indicator).toContain('activeAssetState');
		expect(indicator).toContain('resolveHdrReadiness(value,');
	});

	it('hides the dot only for an ineligible active asset or a genuinely empty legacy window, and re-polls on the per-asset state, not the raw aggregate one', () => {
		const indicator = read('src/lib/components/journal/ReadinessIndicator.svelte');
		expect(indicator).toContain("value.activeAssetState === 'ineligible'");
		// The re-poll decision must use the already-resolved, per-asset-aware progress.state --
		// using the raw aggregate value.state here would re-introduce root_cause (3): a window
		// that reports 'ready' while the one asset the viewer is actually waiting on is still
		// queued or running would stop polling before that photo is actually confirmed ready.
		expect(indicator).toContain("progress.state === 'preparing'");
	});
});
