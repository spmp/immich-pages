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
	});
});
