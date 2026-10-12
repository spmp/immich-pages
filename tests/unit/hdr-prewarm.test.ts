import { describe, expect, it, vi } from 'vitest';
import { HdrPrewarmCoordinator, type AuthorizedHdrProjection } from '../../src/lib/server/media/hdr-prewarm';
import { redactHdrProgress, redactHdrProgressEvent } from '../../src/lib/server/media/hdr-progress';

const projection = (generation = 0, sourceIdentity = 'etag-1'): AuthorizedHdrProjection => ({
	generation,
	activePosition: 0,
	lookahead: { kind: 'count', value: 1 },
	scope: 'default',
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
		const snapshot = coordinator.schedule({ assets, activePosition: -1, lookahead: { kind: 'all' }, generation: 0, scope: 'default' }, 'video');

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

	// jobState()/the old cache-key reconstruction are gone (08-21-PLAN.md Task 2 fully retires
	// the coordinator's private jobs Map); activeState() is the direct O(1) registry lookup for
	// BOTH representations now -- see hdr-caching-uat-20261010 root_cause (1)/CR-01. An asset
	// that was never scheduled answers 'none' for either representation.
	it.each(['video', 'avif'] as const)('activeState exposes a %s entry status by (scope, assetId), and "none" for an unknown asset', async (representation) => {
		const convert = vi.fn(async () => ({ body: new Uint8Array([1]), contentType: representation === 'video' ? 'video/mp4' : 'image/avif' }));
		const coordinator = new HdrPrewarmCoordinator({ convert });
		const asset = { id: `asset-state-${representation}`, eligible: true, position: 0, sourceIdentity: `state-etag-${representation}`, sourceBytes: new Uint8Array([4, 5, 6]) };
		const scope = `share-key-state-${representation}`;
		expect(coordinator.activeState(scope, asset.id, representation)).toBe('none');
		coordinator.schedule({ assets: [asset], activePosition: -1, lookahead: { kind: 'all' }, generation: 0, scope }, representation, 'background');
		// enqueue() flips an entry straight to 'converting' synchronously (before its first
		// await), so 'pending'/'queued' is only ever observable for an entry still waiting on
		// the bounded scheduler.
		expect(['running', 'queued']).toContain(coordinator.activeState(scope, asset.id, representation));
		await vi.waitFor(() => expect(coordinator.activeState(scope, asset.id, representation)).toBe('succeeded'));
	});

	// D-19 / Task 2 Behavior Test 1: an AVIF call and a VIDEO call for the SAME (scope, assetId)
	// write to independent registry slots -- completing one never marks the other 'ready'.
	it('keeps video and AVIF registry entries independent for the same (scope, assetId)', async () => {
		const convert = vi.fn(async ({ representation }: { representation: string }) => ({ body: new Uint8Array([1]), contentType: representation === 'video' ? 'video/mp4' : 'image/avif' }));
		const coordinator = new HdrPrewarmCoordinator({ convert });
		const scope = 'share-key-d19';
		const asset = { id: 'asset-d19', eligible: true, position: 0, sourceIdentity: 'd19-etag', sourceBytes: new Uint8Array([1, 2, 3]) };
		coordinator.schedule({ assets: [asset], activePosition: -1, lookahead: { kind: 'all' }, generation: 0, scope }, 'video', 'background');
		await vi.waitFor(() => expect(coordinator.activeState(scope, asset.id, 'video')).toBe('succeeded'));
		expect(coordinator.activeState(scope, asset.id, 'avif')).toBe('none');
		coordinator.schedule({ assets: [asset], activePosition: -1, lookahead: { kind: 'all' }, generation: 0, scope }, 'avif', 'background');
		await vi.waitFor(() => expect(coordinator.activeState(scope, asset.id, 'avif')).toBe('succeeded'));
		expect(coordinator.activeState(scope, asset.id, 'video')).toBe('succeeded');
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
