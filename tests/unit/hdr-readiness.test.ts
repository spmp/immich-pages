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
