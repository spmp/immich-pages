import { describe, expect, it, vi } from 'vitest';
import { parseSharedLinkRef } from '../../src/lib/server/share/ref';
import { createImmichProvider } from '../../src/lib/server/immich/provider';
import { assembleDirectShare } from '../../src/lib/server/page/assemble';
import v3Response from '../fixtures/shared-link/v3-valid-page.json';

describe('direct-share tracer', () => {
	 it('requires an explicit key or slug kind', () => {
		expect(parseSharedLinkRef('key', 'opaque_ref')).toEqual({ kind: 'key', value: 'opaque_ref' });
		expect(parseSharedLinkRef('opaque_ref', undefined)).toBeNull();
		expect(parseSharedLinkRef(undefined, 'opaque_ref')).toBeNull();
		expect(parseSharedLinkRef('key', 'bad/ref')).toBeNull();
	});

	it.each(['key', 'slug'] as const)('forwards only request auth and matching %s query', async (kind) => {
		const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
			const url = new URL(input.toString());
			expect(url.pathname).toBe('/api/shared-links/me');
			expect(url.searchParams.get(kind)).toBe('opaque_ref');
			expect(url.searchParams.get(kind === 'key' ? 'slug' : 'key')).toBeNull();
			expect([...new Headers(init?.headers).keys()].sort()).toEqual(['accept', 'authorization', 'cookie']);
			return new Response(JSON.stringify(v3Response), { status: 200 });
		});
		const provider = createImmichProvider(fetchMock, 'https://immich.example');
		const ref = parseSharedLinkRef(kind, 'opaque_ref')!;
		const outcome = await assembleDirectShare(provider, { shareRef: ref, cookie: 'session=visitor', authorization: 'Bearer visitor' }, 'req-1');
		expect(outcome.kind).toBe('page');
		if (outcome.kind === 'page') {
			expect(outcome.page.album.id).toBe('11111111-1111-4111-8111-111111111111');
			expect(outcome.page.assets[0]).toEqual({
				id: '22222222-2222-4222-8222-222222222222', type: 'IMAGE', fileName: 'one.jpg',
				thumbnail: `/share/${kind}/opaque_ref/media/22222222-2222-4222-8222-222222222222/thumbnail`
			});
			expect(JSON.stringify(outcome)).not.toContain('visitor');
		}
	});

	it('does not expose private paths or direct Immich origins', async () => {
		const outcome = await assembleDirectShare(createImmichProvider(vi.fn(async () => new Response(JSON.stringify(v3Response))), 'https://immich.example'), {
			shareRef: { kind: 'key', value: 'opaque_ref' }, cookie: null, authorization: null
		}, 'req-media');
		expect(outcome.kind).toBe('page');
		expect(JSON.stringify(outcome)).not.toContain('originalPath');
		expect(JSON.stringify(outcome)).not.toContain('https://immich.example');
	});

	it('classifies activation metadata deterministically', async () => {
		const makeOutcome = async (description: string) => assembleDirectShare(
			createImmichProvider(vi.fn(async () => new Response(JSON.stringify({ ...v3Response, album: { ...v3Response.album, description } }))), 'https://immich.example'),
			{ shareRef: { kind: 'key', value: 'opaque_ref' }, cookie: null, authorization: null }, 'req-metadata'
		);
		expect((await makeOutcome('ordinary album')).kind).toBe('non-page');
		expect((await makeOutcome('---\nimmich-presentation:\n  type: journey\n  version: 2\n---')).kind).toBe('invalid-metadata');
		expect((await makeOutcome('---\nimmich-presentation:\n  type: journey\n  version: 1\n---')).kind).toBe('page');
	});
});
