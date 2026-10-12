import { describe, expect, it, vi } from 'vitest';
import { HdrPrewarmCoordinator, HDR_OUTPUT_CONTRACT, type AuthorizedHdrProjection } from '../../src/lib/server/media/hdr-prewarm';
import { buildHdrCacheKey } from '../../src/lib/server/media/hdr-cache';
import { redactHdrProgress, redactHdrProgressEvent } from '../../src/lib/server/media/hdr-progress';

const projection = (generation = 0, sourceIdentity = 'etag-1'): AuthorizedHdrProjection => ({
	generation,
	activePosition: 0,
	lookahead: { kind: 'count', value: 1 },
	assets: [{ id: 'asset-1', eligible: true, position: 1, sourceIdentity, sourceBytes: new Uint8Array([1, 2, 3]), width: 100, height: 80 }]
});

describe('HDR prewarm coordinator', () => {
	it('coalesces one authorized projection and releases source bytes before completion', async () => {
		const complete = vi.fn();
		const convert = vi.fn(async ({ sourceBytes }: { sourceBytes: Uint8Array }) => ({ body: new Uint8Array([9]), contentType: 'video/mp4', width: 100, height: 80, sourceBytes } as never));
		const coordinator = new HdrPrewarmCoordinator({ convert, onComplete: complete });
		const source = projection();
		coordinator.schedule(source, 'video');
		coordinator.schedule(source, 'video');
		await vi.waitFor(() => expect(complete).toHaveBeenCalled());
		expect(convert).toHaveBeenCalledTimes(1);
		expect(coordinator.inspectSourceBytes()).toBe(0);
		expect(complete.mock.lastCall?.[0].state).toBe('ready');
	});

	it('keeps video and AVIF jobs independent', async () => {
		const convert = vi.fn(async () => ({ body: new Uint8Array([1]), contentType: 'video/mp4' }));
		const coordinator = new HdrPrewarmCoordinator({ convert });
		coordinator.schedule(projection(0, 'etag-video'), 'video');
		coordinator.schedule(projection(), 'avif');
		await vi.waitFor(() => expect(convert).toHaveBeenCalledTimes(2));
	});

	it('drains an all-assets batch beyond the bounded scheduler queue', async () => {
		const convert = vi.fn(async () => {
			await new Promise((resolve) => setTimeout(resolve, 1));
			return { body: new Uint8Array([1]), contentType: 'video/mp4' };
		});
		const coordinator = new HdrPrewarmCoordinator({ convert });
		const assets = Array.from({ length: 40 }, (_, index) => ({
			id: `asset-${index}`,
			eligible: true,
			position: index + 1,
			sourceIdentity: `source-${index}`,
			sourceBytes: new Uint8Array([1, 2, 3])
		}));
		const snapshot = coordinator.schedule({ assets, activePosition: -1, lookahead: { kind: 'all' }, generation: 0 }, 'video');

		expect(snapshot.targeted).toBe(40);
		await vi.waitFor(() => expect(coordinator.snapshot().state).toBe('ready'), { timeout: 10_000 });
		expect(convert).toHaveBeenCalledTimes(40);
		expect(coordinator.snapshot().failed).toBe(0);
	});

	it('retries once, then preserves a terminal failure without retaining bytes', async () => {
		const convert = vi.fn(async () => { throw new Error('native-failed'); });
		const coordinator = new HdrPrewarmCoordinator({ convert });
		coordinator.schedule(projection(0, 'etag-retry'), 'video');
		await vi.waitFor(() => expect(convert).toHaveBeenCalledTimes(2));
		await vi.waitFor(() => expect(coordinator.snapshot().state).toBe('partial'));
		expect(coordinator.inspectSourceBytes()).toBe(0);
	});

	// Specialist Review finding 1 (hdr-caching-uat-20261010): interactive routes previously called
	// submitInteractive()/ensureInteractive() with no scope at all, so a standalone interactive job
	// (one with no corresponding background job already queued, e.g. a representation or asset
	// outside the current prewarm window) was always filed under the coordinator's own internal
	// 'default' bucket -- never under the real per-share scope that readiness reporting filters by
	// (snapshot()). That job byte-serving still worked (the promise still resolves), but it was
	// permanently invisible to that share's own readiness snapshot. Threading the real scope through
	// fixes the attribution.
	it('attributes a standalone interactive job (no prior background job) to the real share scope, not the internal default bucket', async () => {
		const convert = vi.fn(async () => ({ body: new Uint8Array([9]), contentType: 'video/mp4' }));
		const coordinator = new HdrPrewarmCoordinator({ convert });
		const scope = 'share-key-standalone';
		const asset = { id: 'asset-standalone', eligible: true, position: 0, sourceIdentity: 'standalone-etag', sourceBytes: new Uint8Array([1, 2, 3]) };
		const generation = coordinator.getScopedGeneration(scope);
		await coordinator.submitInteractive(asset, 'video', generation, scope);
		expect(convert).toHaveBeenCalledTimes(1);
		expect(coordinator.snapshot(generation, 'video', scope)).toMatchObject({ targeted: 1, completed: 1 });
		expect(coordinator.snapshot(coordinator.getGeneration(), 'video', 'default')).toMatchObject({ targeted: 0 });
	});

	// jobState() is the AVIF-only per-asset readiness lookup now (08-21-PLAN.md Task 1 migrates
	// video onto the registry-backed activeState() below -- see hdr-caching-uat-20261010
	// root_cause (1)/CR-01). A key built for a job that was never scheduled still answers 'none'.
	it('jobState exposes an AVIF job status by cache key for per-asset readiness, and "none" for an unknown key', async () => {
		const convert = vi.fn(async () => ({ body: new Uint8Array([1]), contentType: 'image/avif' }));
		const coordinator = new HdrPrewarmCoordinator({ convert });
		const asset = { id: 'asset-state', eligible: true, position: 0, sourceIdentity: 'state-etag', sourceBytes: new Uint8Array([4, 5, 6]), width: undefined, height: undefined };
		const key = buildHdrCacheKey({ assetId: asset.id, sourceIdentity: asset.sourceIdentity, width: asset.width, height: asset.height, outputContract: HDR_OUTPUT_CONTRACT.avif });
		expect(coordinator.jobState(key)).toBe('none');
		coordinator.schedule({ assets: [asset], activePosition: -1, lookahead: { kind: 'all' }, generation: 0, scope: 'share-key-state' }, 'avif', 'background');
		// run() flips a job straight to 'running' synchronously (before its first await), so
		// 'queued' is only ever observable for a job still waiting on the bounded scheduler.
		expect(['running', 'queued']).toContain(coordinator.jobState(key));
		await vi.waitFor(() => expect(coordinator.jobState(key)).toBe('succeeded'));
	});

	// The video-representation replacement for the AVIF test above: a direct registry lookup
	// through activeState(), not a cache-key reconstruction -- the whole point of CR-01's fix.
	it('activeState exposes a video entry status by (scope, assetId), and "none" for an unknown asset', async () => {
		const convert = vi.fn(async () => ({ body: new Uint8Array([1]), contentType: 'video/mp4' }));
		const coordinator = new HdrPrewarmCoordinator({ convert });
		const asset = { id: 'asset-state-video', eligible: true, position: 0, sourceIdentity: 'state-etag-video', sourceBytes: new Uint8Array([4, 5, 6]) };
		const scope = 'share-key-state-video';
		expect(coordinator.activeState(scope, asset.id, 'video')).toBe('none');
		coordinator.schedule({ assets: [asset], activePosition: -1, lookahead: { kind: 'all' }, generation: 0, scope }, 'video', 'background');
		expect(['running', 'queued']).toContain(coordinator.activeState(scope, asset.id, 'video'));
		await vi.waitFor(() => expect(coordinator.activeState(scope, asset.id, 'video')).toBe('succeeded'));
	});

	it('redacts progress to bounded representation-specific aggregates and safe event IDs', () => {
		const snapshot = redactHdrProgress({ generation: 99, representation: 'avif', state: 'ready', targeted: 1_000_000, queued: -1, running: 2, completed: 3, failed: 4, skipped: 5 });
		expect(snapshot).toEqual({ generation: 99, representation: 'avif', state: 'ready', targeted: 100_000, queued: 0, running: 2, completed: 3, failed: 4, skipped: 5 });
		expect(redactHdrProgressEvent('completed', 'avif', 'req-123')).toEqual({ category: 'completed', representation: 'avif', requestId: 'req-123' });
		expect(redactHdrProgressEvent('failed', 'video', 'https://secret/share/key')).toEqual({ category: 'failed', representation: 'video' });
	});

	// Per-asset readiness (hdr-caching-uat-20261010 root_cause (3)): activeAssetState must survive
	// redaction when present, but stay absent entirely (not even as `undefined`) when the caller
	// never computed one -- existing callers' exact-shape `toEqual` assertions above must keep
	// passing unchanged.
	it('passes activeAssetState through redaction when present, restricted to the known enum', () => {
		expect(redactHdrProgress({ generation: 1, representation: 'video', state: 'ready', targeted: 1, queued: 0, running: 0, completed: 1, failed: 0, skipped: 0, activeAssetState: 'succeeded' })).toMatchObject({ activeAssetState: 'succeeded' });
		expect(redactHdrProgress({ generation: 1, representation: 'video', state: 'ready', targeted: 1, queued: 0, running: 0, completed: 1, failed: 0, skipped: 0, activeAssetState: 'not-a-real-state' as never })).not.toHaveProperty('activeAssetState');
		expect(redactHdrProgress({ generation: 1, representation: 'video', state: 'ready', targeted: 0, queued: 0, running: 0, completed: 0, failed: 0, skipped: 0 })).not.toHaveProperty('activeAssetState');
	});
});
