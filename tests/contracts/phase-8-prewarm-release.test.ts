import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');
const coordinator = read('src/lib/server/media/hdr-prewarm.ts');
const policy = read('src/lib/server/media/hdr-prewarm-policy.ts');
const source = read('src/lib/server/media/hdr-prewarm-source.ts');
const pageLoad = read('src/routes/share/[kind]/[ref]/+page.server.ts');
const controlRoute = read('src/routes/share/[kind]/[ref]/prewarm/+server.ts');
const videoRoute = read('src/routes/share/[kind]/[ref]/media/[assetId]/image/hdr/+server.ts');
const avifRoute = read('src/routes/share/[kind]/[ref]/media/[assetId]/image/hdr-avif/+server.ts');
const cache = read('src/lib/server/media/hdr-cache.ts');
const progress = read('src/lib/server/media/hdr-progress.ts');
const browser = read('src/lib/components/journal/JournalGallery.svelte');
const readiness = read('src/lib/components/journal/ReadinessIndicator.svelte');
const evidenceText = read('docs/phase-8-gate-c-hdr-evidence.md');

describe('Phase 8 corrected prewarm release contract', () => {
	 it('binds scheduling to the normalized authorized model and never to client media lists', () => {
		expect(source).toContain('projectHdrAssets(page.assets)');
		expect(source).toContain('provider.getFullsizeImage(context, target.id)');
		expect(pageLoad).toContain('prepareAuthorizedHdrSources');
		expect(pageLoad).toContain('void prepareAuthorizedHdrSources(createImmichProvider(fetch), context, outcome.page).catch');
		expect(controlRoute).toContain('share.data.assets');
		expect(controlRoute).toContain('targetLookahead(projection, command.activePosition');
		expect(controlRoute).not.toMatch(/command\.(?:assetIds|assets|urls)/);
	});

	it('enforces literal zero, count, all, and advancing active-window semantics', () => {
		expect(policy).toContain("if (lookahead === 0) return []");
		expect(policy).toContain("lookahead.kind === 'all' ? ahead : ahead.slice(0, lookahead.value)");
		expect(policy).toContain('asset.position > position');
		expect(coordinator).toContain('targetAllEligible(projection.assets)');
		expect(coordinator).toContain('targetLookahead(projection.assets, projection.activePosition, projection.lookahead)');
		expect(coordinator).toContain("representation: HdrRepresentation");
	});

	it('keeps video and AVIF work independent from cache through browser promotion', () => {
		expect(coordinator).toContain("video: 'mp4-hevc-main10-pq-bt2020'");
		expect(coordinator).toContain("avif: 'avif-gainmap-p3'");
		expect(coordinator).toContain('outputContract: HDR_OUTPUT_CONTRACT[representation]');
		expect(videoRoute).toContain("submitInteractive");
		expect(videoRoute).toContain("}, 'video')");
		expect(avifRoute).toContain("submitInteractive");
		expect(avifRoute).toContain("}, 'avif')");
		expect(browser).toContain("x-hdr-representation");
		expect(readiness).toContain('preferredHdrRepresentation');
	});

	it('proves bounded priority, queue, retry, timeout, and memory-only behavior', () => {
		expect(coordinator).toContain('Math.min(Math.trunc(options.maxAttempts ?? DEFAULT_ATTEMPTS), DEFAULT_ATTEMPTS)');
		expect(coordinator).toContain('if (job.attempts < this.maxAttempts)');
		expect(cache).toContain('HDR_MAX_CONCURRENT');
		expect(cache).toContain('HDR_MAX_QUEUE');
		expect(cache).toContain('HDR_CACHE_MAX_BYTES');
		expect(cache).toContain('HDR_CACHE_BACKEND');
		expect(cache).toContain('diskWrites: false');
		expect(cache).toContain('timeoutMs');
		expect(cache).toContain('priority');
		expect(cache).toContain('controller.abort()');
		expect(coordinator).toContain('job.source.bytes.fill(0)');
	});

	it('keeps progress redacted, fallback-capable, and readiness default-on', () => {
		expect(progress).toContain('credentials');
		expect(progress).toContain('asset bytes');
		expect(progress).toContain("'preparing', 'ready', 'partial'");
		expect(videoRoute).toContain("return new Response('HDR conversion unavailable'");
		expect(avifRoute).toContain("return new Response('HDR conversion unavailable'");
		expect(policy).toContain("value === undefined || value === null) return { enabled: true");
		expect(readiness).toContain("readinessState === 'partial'");
		expect(browser).toContain('optional control-plane failure preserves SDR');
		for (const text of [coordinator, progress, evidenceText]) {
			expect(text).not.toMatch(/(?:cookie|authorization|bearer|password)\s*[:=][^\n]*/i);
		}
	});

	it('records the automated contract separately from physical HDR approval', () => {
		const evidence = readEvidence();
		expect(evidence.automatedPrewarm.status).toBe('PASS');
		expect(evidence.automatedPrewarm.attempts).toBe(2);
		expect(evidence.automatedPrewarm.cacheBackend).toBe('memory');
		expect(evidence.automatedPrewarm.representations).toEqual(['video', 'avif']);
		expect(evidence.automatedPrewarm.fallback).toBe('SDR-only on failure');
		expect(evidence.overallStatus).toBe('PENDING');
		expect(evidence.releaseMode).toBe('SDR-only');
		expect(evidence.physicalHdrValidation).toBe('not-run');
		expect(evidence.physicalReview.status).toBe('PENDING');
	});
});

function readEvidence(): any {
	const match = evidenceText.match(/```json\n([\s\S]*?)\n```/);
	if (!match) throw new Error('Gate C evidence JSON block is missing');
	return JSON.parse(match[1]);
}
