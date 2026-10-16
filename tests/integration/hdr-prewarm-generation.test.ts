import { describe, expect, it, vi } from 'vitest';
import { HdrPrewarmCoordinator, type AuthorizedHdrProjection } from '../../src/lib/server/media/hdr-prewarm';

const projection = (generation: number, id = 'asset-generation'): AuthorizedHdrProjection => ({
	generation,
	activePosition: 0,
	lookahead: { kind: 'count', value: 1 },
	scope: 'default',
	assets: [{ id, eligible: true, position: 1, sourceIdentity: `source-${id}`, sourceBytes: new Uint8Array([7, 8, 9]) }]
});

describe('HDR prewarm generation boundary', () => {
	it('rejects stale completion and disposes its source bytes after revocation', async () => {
		let resolve!: (value: { body: Uint8Array; contentType: string }) => void;
		const convert = vi.fn(() => new Promise<{ body: Uint8Array; contentType: string }>((done) => { resolve = done; }));
		const coordinator = new HdrPrewarmCoordinator({ convert });
		const source = projection(0);
		coordinator.schedule(source, 'video');
		await vi.waitFor(() => expect(convert).toHaveBeenCalled());
		const nextGeneration = coordinator.newGeneration();
		resolve({ body: new Uint8Array([1]), contentType: 'video/mp4' });
		await vi.waitFor(() => expect(coordinator.inspectSourceBytes()).toBe(0));
		expect(coordinator.getGeneration()).toBe(nextGeneration);
		// The stale result is discarded and the work counted as superseded ('skipped'), which is not
		// a failure: the old generation reads as settled, not partial (orange).
		expect(coordinator.snapshot(0, 'video')).toMatchObject({ state: 'ready', completed: 0, skipped: 1 });
	});
});
