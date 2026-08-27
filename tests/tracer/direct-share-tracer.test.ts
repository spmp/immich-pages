import { describe, expect, it, vi } from 'vitest';
import { parseSharedLinkRef } from '../../src/lib/server/share/ref';
import { createImmichProvider } from '../../src/lib/server/immich/provider';
import { assembleDirectShare } from '../../src/lib/server/page/assemble';

const response = { album: { id: 'album-1', albumName: 'Journey', description: '---\nimmich-presentation:\n  type: journey\n  version: 1\n---\nStory' }, assets: [{ id: 'asset-1', thumbnailPath: '/api/assets/asset-1/thumbnail', viewPath: '/api/assets/asset-1/original', originalFileName: 'one.jpg' }], showMetadata: true, allowDownload: false };

describe('direct-share tracer', () => {
	it('requires an explicit key or slug kind', () => {
		expect(parseSharedLinkRef('key', 'opaque_ref')).toEqual({ kind: 'key', value: 'opaque_ref' });
		expect(parseSharedLinkRef('opaque_ref', undefined)).toBeNull();
		expect(parseSharedLinkRef(undefined, 'opaque_ref')).toBeNull();
		expect(parseSharedLinkRef('key', 'bad/ref')).toBeNull();
	});

	it.each(['key', 'slug'])('forwards only request auth and matching %s query', async (kind) => {
		const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
			const url = new URL(input.toString());
			expect(url.pathname).toBe('/api/shared-links/me');
			expect(url.searchParams.get(kind)).toBe('opaque_ref');
			expect(url.searchParams.get(kind === 'key' ? 'slug' : 'key')).toBeNull();
			expect([...new Headers(init?.headers).keys()].sort()).toEqual(['accept', 'authorization', 'cookie']);
			return new Response(JSON.stringify(response), { status: 200 });
		});
		const provider = createImmichProvider(fetchMock, 'https://immich.example');
		const ref = parseSharedLinkRef(kind, 'opaque_ref')!;
		const outcome = await assembleDirectShare(provider, { shareRef: ref, cookie: 'session=visitor', authorization: 'Bearer visitor' }, 'req-1');
		expect(outcome.kind).toBe('page');
		if (outcome.kind === 'page') {
			expect(outcome.page.album.id).toBe('album-1');
			expect(JSON.stringify(outcome)).not.toContain('visitor');
		}
	});
});
