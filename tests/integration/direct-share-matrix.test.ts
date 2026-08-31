import { describe, expect, it, vi } from 'vitest';
import { createImmichProvider } from '../../src/lib/server/immich/provider';
import { assembleDirectShare } from '../../src/lib/server/page/assemble';
import { GET as getHealth } from '../../src/routes/health/+server';
import v3 from '../fixtures/shared-link/v3-valid-page.json';

describe('v3 direct-share matrix', () => {
	it.each(['key', 'slug'] as const)('resolves one authorized %s album without state leakage', async (kind) => {
		const calls: string[] = [];
		const provider = createImmichProvider(vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => { calls.push(`${new URL(input.toString()).search}${new Headers(init?.headers).get('cookie')}`); return new Response(JSON.stringify(v3)); }), 'https://immich.example');
		await assembleDirectShare(provider, { shareRef: { kind, value: 'first' }, cookie: 'first=1', authorization: null }, 'one');
		await assembleDirectShare(provider, { shareRef: { kind, value: 'second' }, cookie: 'second=1', authorization: 'Bearer second' }, 'two');
		expect(calls).toEqual([`?${kind}=firstfirst=1`, `?${kind}=secondsecond=1`]);
	});

	it('keeps ordinary albums out of Pages', async () => {
		const ordinary = { ...v3, album: { ...v3.album, description: 'ordinary album' } };
		const result = await assembleDirectShare(createImmichProvider(vi.fn(async () => new Response(JSON.stringify(ordinary))), 'https://immich.example'), { shareRef: { kind: 'key', value: 'ordinary' }, cookie: null, authorization: null }, 'ordinary');
		expect(result).toEqual({ kind: 'non-page' });
	});

	it('hydrates v3.1 album shares through authorized metadata search', async () => {
		const shared = { ...v3, album: { ...v3.album, assetCount: 1 }, assets: [] };
		const calls: Array<{ url: URL; init?: RequestInit }> = [];
		const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
			const url = new URL(input.toString());
			calls.push({ url, init });
			if (url.pathname === '/api/shared-links/me') return new Response(JSON.stringify(shared));
			return new Response(JSON.stringify({ albums: {}, assets: { items: v3.assets } }));
		});
		const result = await assembleDirectShare(createImmichProvider(fetchMock, 'https://immich.example'), { shareRef: { kind: 'slug', value: 'opaque-ref' }, cookie: 'visitor=1', authorization: 'Bearer visitor' }, 'hydrated');

		expect(result.kind).toBe('page');
		if (result.kind !== 'page') return;
		expect(result.page.assets).toHaveLength(1);
		expect(result.page.hero?.id).toBe(v3.assets[0].id);
		expect(calls).toHaveLength(2);
		expect(calls[1].url.pathname).toBe('/api/search/metadata');
		expect(calls[1].url.search).toBe('?slug=opaque-ref');
		expect(calls[1].init?.method).toBe('POST');
		expect(JSON.parse(String(calls[1].init?.body))).toEqual({ albumIds: [v3.album.id], page: 1, size: 1000 });
		expect(new Headers(calls[1].init?.headers).get('cookie')).toBe('visitor=1');
		expect(new Headers(calls[1].init?.headers).get('authorization')).toBe('Bearer visitor');
	});

	it('retrieves only the exact share-aware map marker contract', async () => {
		const marker = { id: v3.assets[0].id, lat: 51.5, lon: -0.1, city: null, state: null, country: 'UK' };
		const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
			const url = new URL(input.toString());
			expect(url.pathname).toBe('/api/albums/550e8400-e29b-41d4-a716-446655440003/map-markers');
			expect(url.search).toBe('?key=opaque-ref');
			expect([...new Headers(init?.headers).keys()].sort()).toEqual(['authorization', 'cookie']);
			return new Response(JSON.stringify([marker]));
		});
		const result = await createImmichProvider(fetchMock, 'https://immich.example').getMapMarkers({ shareRef: { kind: 'key', value: 'opaque-ref' }, cookie: 'visitor=1', authorization: 'Bearer visitor' }, v3.album.id);
		expect(result).toEqual({ status: 200, data: [marker] });
	});

	it('keeps process health independent from Immich', async () => {
		expect(getHealth().status).toBe(200);
	});
});
