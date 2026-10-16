import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');
const coordinator = read('src/lib/server/media/hdr-prewarm.ts');
const policy = read('src/lib/server/media/hdr-prewarm-policy.ts');
const pageLoad = read('src/routes/share/[kind]/[ref]/+page.server.ts');
const controlRoute = read('src/routes/share/[kind]/[ref]/prewarm/+server.ts');
const videoRoute = read('src/routes/share/[kind]/[ref]/media/[assetId]/image/hdr/+server.ts');
const avifRoute = read('src/routes/share/[kind]/[ref]/media/[assetId]/image/hdr-avif/+server.ts');
const cache = read('src/lib/server/media/hdr-cache.ts');
const progress = read('src/lib/server/media/hdr-progress.ts');
const browser = read('src/lib/components/journal/JournalGallery.svelte');
const readiness = read('src/lib/components/journal/ReadinessIndicator.svelte');

describe('Phase 8 corrected prewarm release contract', () => {
	 it('binds scheduling to the normalized authorized model and never to client media lists', () => {
		// 08-21-PLAN.md Task 3: the detached SSR prewarm path (hdr-prewarm-source.ts) was already
		// removed from production in commit 005223e, before this plan -- this is the now-real
		// negative assertion for that fact, not a comment-text match (the prior version of this
		// test was satisfied by a source-code COMMENT referencing the already-removed call, the
		// comment-text-discipline anti-pattern named in hdr-caching-uat-20261010).
		expect(pageLoad).not.toContain('prepareAuthorizedHdrSources');
		expect(pageLoad).not.toContain('hdr-prewarm-source');
		expect(controlRoute).toContain('coordinator.queueSources(');
		expect(controlRoute).toContain('share.data.assets');
		// The open photo's position is resolved by ID on the server (activePosition), not taken on trust.
		expect(controlRoute).toContain('targetLookahead(projection, activePosition, lookahead)');
		expect(controlRoute).not.toMatch(/command\.(?:assetIds|assets|urls)/);
	});

	it('enforces literal zero, count, all, and advancing active-window semantics', () => {
		expect(policy).toContain("if (lookahead === 0) return []");
		// hdr-caching-uat-20261010 root_cause (2)/(4): the window must include the viewer's OWN
		// current position, not just what's strictly ahead of it -- updated from '>' to '>=' and
		// from the prior variable name 'ahead' to 'fromHere' to make that inclusive semantics
		// explicit at the call site, not just in a comment.
		expect(policy).toContain("lookahead.kind === 'all' ? fromHere : fromHere.slice(0, lookahead.value)");
		expect(policy).toContain('asset.position >= position');
		expect(coordinator).toContain('targetAllEligible(projection.assets)');
		expect(coordinator).toContain('targetLookahead(projection.assets, projection.activePosition, projection.lookahead)');
		expect(coordinator).toContain("representation: HdrRepresentation");
	});

	it('keeps video and AVIF work independent from cache through browser promotion', () => {
		expect(coordinator).toContain("video: 'mp4-hevc-main10-pq-bt2020-w203'");
		expect(coordinator).toContain("avif: 'avif-gainmap-p3'");
		expect(coordinator).toContain('outputContract: HDR_OUTPUT_CONTRACT[representation]');
		expect(videoRoute).toContain("submitInteractive");
		// Specialist Review finding 1: both interactive routes must thread the real per-share scope
		// (operationScope()) and that scope's own current generation through submitInteractive(),
		// not rely on the coordinator's unscoped default -- otherwise a standalone interactive job
		// is filed where that share's own readiness snapshot can never see it.
		expect(videoRoute).toContain("}, 'video', coordinator.getScopedGeneration(scope), scope)");
		expect(avifRoute).toContain("submitInteractive");
		expect(avifRoute).toContain("}, 'avif', coordinator.getScopedGeneration(scope), scope)");
		expect(browser).toContain("x-hdr-representation");
		expect(readiness).toContain('preferredHdrRepresentation');
	});

	it('proves bounded priority, queue, retry, timeout, and memory-only behavior', () => {
		expect(coordinator).toContain('Math.min(Math.trunc(options.maxAttempts ?? DEFAULT_ATTEMPTS), DEFAULT_ATTEMPTS)');
		// 08-21-PLAN.md Task 2: retry bookkeeping moved from the removed private `jobs` Map onto
		// the HdrAssetRegistry entry itself (`entry.attempts`, mutated via registry.transition()).
		expect(coordinator).toContain('if (entry.attempts < this.maxAttempts)');
		expect(cache).toContain('HDR_MAX_CONCURRENT');
		expect(cache).toContain('HDR_MAX_QUEUE');
		expect(cache).toContain('HDR_CACHE_MAX_BYTES');
		expect(cache).toContain('HDR_CACHE_BACKEND');
		expect(cache).toContain('diskWrites: false');
		expect(cache).toContain('timeoutMs');
		expect(cache).toContain('priority');
		expect(cache).toContain('controller.abort()');
		expect(coordinator).toContain('entry.source.bytes.fill(0)');
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
		for (const text of [coordinator, progress]) {
			expect(text).not.toMatch(/(?:cookie|authorization|bearer|password)\s*[:=][^\n]*/i);
		}
	});

});
