import { describe, expect, it } from 'vitest';
import { resolveHdrReadiness } from '../../src/lib/media/hdr-readiness';

const preparing = { state: 'preparing' as const, targeted: 2, queued: 0, running: 0, completed: 0, failed: 0, skipped: 0 };

describe('HDR readiness lifecycle', () => {
	it('does not stay preparing when capability is unsupported', () => {
		expect(resolveHdrReadiness(preparing, { supported: false })).toMatchObject({ state: 'ready', targeted: 0 });
	});
	it('does not stay preparing for an empty target set', () => {
		expect(resolveHdrReadiness({ ...preparing, targeted: 0 }, { supported: true }).state).toBe('ready');
	});
	it('does not stay preparing after control failure', () => {
		expect(resolveHdrReadiness(preparing, { supported: true, controlFailed: true }).state).toBe('partial');
	});
	it('does not stay preparing once every job is terminal', () => {
		expect(resolveHdrReadiness({ ...preparing, completed: 1, failed: 1 }, { supported: true }).state).toBe('partial');
		expect(resolveHdrReadiness({ ...preparing, completed: 2 }, { supported: true }).state).toBe('ready');
	});
});

// The indicator reports the PREWARM, not a photo: it is only visible on the share page itself
// (never over the lightbox), so there is no photo the viewer is "on" for it to describe. Green
// means every conversion the prewarm targeted -- the configured lookahead, or the whole album
// when that is 'all' -- has finished, and the server has nothing left queued or running for it.
//
// This deliberately supersedes hdr-caching-uat-20261010 root_cause (3), which made the server's
// per-photo activeAssetState the primary signal: on a real phone that turned the dot green at
// 4 of 10 conversions done (pages-lightbox-weirdness_01.log) while the server was still busy.
describe('HDR readiness reports the whole prewarm', () => {
	it('stays preparing while targeted work remains, even though the active photo itself is done', () => {
		expect(resolveHdrReadiness({ ...preparing, targeted: 10, completed: 4, queued: 5, running: 1, activeAssetState: 'succeeded' }, { supported: true }).state).toBe('preparing');
		expect(resolveHdrReadiness({ ...preparing, targeted: 10, completed: 4, queued: 5, running: 1, activeAssetState: 'ineligible' }, { supported: true }).state).toBe('preparing');
	});
	it('is ready once everything targeted has completed, whatever the active photo was doing', () => {
		expect(resolveHdrReadiness({ ...preparing, targeted: 10, completed: 10, activeAssetState: 'succeeded' }, { supported: true }).state).toBe('ready');
		expect(resolveHdrReadiness({ ...preparing, targeted: 10, completed: 10, activeAssetState: 'unavailable' }, { supported: true }).state).toBe('ready');
	});
	it('does not trust a server "ready" label over its own counts', () => {
		expect(resolveHdrReadiness({ ...preparing, state: 'ready', targeted: 10, completed: 9, running: 1 }, { supported: true }).state).toBe('preparing');
		expect(resolveHdrReadiness({ ...preparing, state: 'ready', targeted: 10, completed: 10, queued: 1 }, { supported: true }).state).toBe('preparing');
	});
	it('is partial, not ready, when the prewarm finished with failures or skips', () => {
		expect(resolveHdrReadiness({ ...preparing, targeted: 10, completed: 8, failed: 1, skipped: 1, activeAssetState: 'succeeded' }, { supported: true }).state).toBe('partial');
	});
	it('still reports unsupported/control-failure ahead of the counts', () => {
		expect(resolveHdrReadiness({ ...preparing, completed: 2 }, { supported: false }).state).toBe('ready');
		expect(resolveHdrReadiness({ ...preparing, completed: 2 }, { supported: true, controlFailed: true }).state).toBe('partial');
	});
});
