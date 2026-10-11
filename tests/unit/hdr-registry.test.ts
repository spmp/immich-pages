import { describe, expect, it } from 'vitest';
import { createHdrAssetRegistry } from '../../src/lib/server/media/hdr-registry';

const identity = { sourceIdentity: 'etag-1|2026-01-01|1024', width: 800, height: 600 };

describe('HdrAssetRegistry', () => {
	it('returns the same entry object for identical identity (no duplicate creation)', () => {
		const registry = createHdrAssetRegistry();
		const first = registry.resolve('scope-a', 'asset-1', 'video', identity);
		const second = registry.resolve('scope-a', 'asset-1', 'video', identity);
		expect(second).toBe(first);
	});

	it('returns a fresh pending entry when sourceIdentity/width/height change (staleness, not a key mismatch)', () => {
		const registry = createHdrAssetRegistry();
		const first = registry.resolve('scope-a', 'asset-1', 'video', identity);
		registry.transition(first, { status: 'ready', cacheKey: 'old-key' });
		const second = registry.resolve('scope-a', 'asset-1', 'video', { ...identity, sourceIdentity: 'etag-2|2026-02-01|2048' });
		expect(second).not.toBe(first);
		expect(second.status).toBe('pending');
		expect(second.cacheKey).toBeUndefined();

		const third = registry.resolve('scope-a', 'asset-1', 'video', { ...identity, width: 400, height: 300 });
		expect(third).not.toBe(second);
		expect(third.status).toBe('pending');
	});

	it('transition() mutates the entry in place, visible through a later read()', () => {
		const registry = createHdrAssetRegistry();
		const entry = registry.resolve('scope-a', 'asset-1', 'video', identity);
		registry.transition(entry, { status: 'ready', cacheKey: 'exact-cache-key' });
		const read = registry.read('scope-a', 'asset-1', 'video');
		expect(read).toBeDefined();
		expect(read?.status).toBe('ready');
		expect(read?.cacheKey).toBe('exact-cache-key');
	});

	it('revokeScope() aborts and skips every pending/converting entry in that scope, leaving other scopes untouched', () => {
		const registry = createHdrAssetRegistry();
		const pending = registry.resolve('scope-a', 'asset-1', 'video', identity);
		const converting = registry.resolve('scope-a', 'asset-2', 'video', identity);
		registry.transition(converting, { status: 'converting' });
		const otherScope = registry.resolve('scope-b', 'asset-1', 'video', identity);

		let pendingAborted = false;
		let convertingAborted = false;
		pending.abortController.signal.addEventListener('abort', () => { pendingAborted = true; });
		converting.abortController.signal.addEventListener('abort', () => { convertingAborted = true; });

		registry.revokeScope('scope-a');

		expect(pending.status).toBe('skipped');
		expect(pendingAborted).toBe(true);
		expect(converting.status).toBe('skipped');
		expect(convertingAborted).toBe(true);
		expect(otherScope.status).toBe('pending');
		expect(otherScope.abortController.signal.aborted).toBe(false);
	});

	it('resolve() after revokeScope() creates a fresh entry even with identical identity (stale generation)', () => {
		const registry = createHdrAssetRegistry();
		const first = registry.resolve('scope-a', 'asset-1', 'video', identity);
		registry.transition(first, { status: 'ready', cacheKey: 'k1' });
		registry.revokeScope('scope-a');
		const second = registry.resolve('scope-a', 'asset-1', 'video', identity);
		expect(second).not.toBe(first);
		expect(second.status).toBe('pending');
	});
});
