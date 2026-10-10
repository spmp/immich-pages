import { describe, expect, it, vi } from 'vitest';
import { HdrPrewarmCoordinator, type AuthorizedHdrProjection } from '../../src/lib/server/media/hdr-prewarm';

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

	it('retries once, then preserves a terminal failure without retaining bytes', async () => {
		const convert = vi.fn(async () => { throw new Error('native-failed'); });
		const coordinator = new HdrPrewarmCoordinator({ convert });
		coordinator.schedule(projection(0, 'etag-retry'), 'video');
		await vi.waitFor(() => expect(convert).toHaveBeenCalledTimes(2));
		await vi.waitFor(() => expect(coordinator.snapshot().state).toBe('partial'));
		expect(coordinator.inspectSourceBytes()).toBe(0);
	});
});
