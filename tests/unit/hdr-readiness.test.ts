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

// hdr-caching-uat-20261010 root_cause (3): readiness was aggregate-window-only, so "green" meant
// only "the current lookahead window finished", not "the photo the viewer has open is ready" --
// a 10/20-asset window could finish and turn green while the open photo (outside that window) was
// still regenerating from scratch. activeAssetState is computed server-side specifically for the
// viewer's current asset and must be the PRIMARY signal whenever it is present, overriding the
// aggregate window math entirely -- a window that is still "preparing" overall must not block a
// dot that should already be green for the one photo actually on screen, and vice versa.
describe('HDR readiness keyed on the viewer\'s own active asset', () => {
	it('is ready when the active asset specifically has already succeeded, even if the aggregate window is still preparing', () => {
		expect(resolveHdrReadiness({ ...preparing, activeAssetState: 'succeeded' }, { supported: true }).state).toBe('ready');
	});
	it('is ready when the active asset is not HDR-eligible at all, regardless of aggregate state', () => {
		expect(resolveHdrReadiness({ ...preparing, activeAssetState: 'ineligible' }, { supported: true }).state).toBe('ready');
	});
	it('stays preparing while the active asset specifically is still queued or running, even if the aggregate window already reports ready', () => {
		expect(resolveHdrReadiness({ ...preparing, state: 'ready', activeAssetState: 'queued' }, { supported: true }).state).toBe('preparing');
		expect(resolveHdrReadiness({ ...preparing, state: 'ready', activeAssetState: 'running' }, { supported: true }).state).toBe('preparing');
	});
	it('is partial when the active asset specifically failed, was skipped, or could not be authorized', () => {
		expect(resolveHdrReadiness({ ...preparing, activeAssetState: 'failed' }, { supported: true }).state).toBe('partial');
		expect(resolveHdrReadiness({ ...preparing, activeAssetState: 'skipped' }, { supported: true }).state).toBe('partial');
		expect(resolveHdrReadiness({ ...preparing, activeAssetState: 'unavailable' }, { supported: true }).state).toBe('partial');
	});
	it('falls back to the old aggregate-window math when activeAssetState is absent (older/degraded response)', () => {
		expect(resolveHdrReadiness({ ...preparing, completed: 2 }, { supported: true }).state).toBe('ready');
	});
	it('still reports unsupported/control-failure ahead of any active-asset signal', () => {
		expect(resolveHdrReadiness({ ...preparing, activeAssetState: 'succeeded' }, { supported: false }).state).toBe('ready');
		expect(resolveHdrReadiness({ ...preparing, activeAssetState: 'succeeded' }, { supported: true, controlFailed: true }).state).toBe('partial');
	});
});
