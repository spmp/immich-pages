import { describe, expect, it, vi } from 'vitest';
import { createImmichProvider } from '../../src/lib/server/immich/provider';
import { assembleDirectShare } from '../../src/lib/server/page/assemble';
import { GET as getHealth } from '../../src/routes/health/+server';
import v3 from '../fixtures/shared-link/v3-valid-page.json';

describe('v3 direct-share matrix', () => {
	it.each(['key', 'slug'] as const)('resolves one authorized %s album without state leakage', async (kind) => {
		const calls: string[] = [];
		// map.enabled defaults to true now, so each resolution also makes a map-markers call;
		// this test only cares about the shared-link lookup's own query/cookie state.
		const provider = createImmichProvider(vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => { const url = new URL(input.toString()); if (url.pathname === '/api/shared-links/me') calls.push(`${url.search}${new Headers(init?.headers).get('cookie')}`); return new Response(JSON.stringify(v3)); }), 'https://immich.example');
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
		// map.enabled defaults to true now, so a minimal presentation config also triggers a
		// third, map-markers call after asset hydration completes.
		expect(calls).toHaveLength(3);
		expect(calls[2].url.pathname).toBe('/api/albums/11111111-1111-4111-8111-111111111111/map-markers');
		expect(calls[1].url.pathname).toBe('/api/search/metadata');
		expect(calls[1].url.search).toBe('?slug=opaque-ref');
		expect(calls[1].init?.method).toBe('POST');
		expect(JSON.parse(String(calls[1].init?.body))).toEqual({ albumIds: [v3.album.id], page: 1, size: 1000 });
		expect(new Headers(calls[1].init?.headers).get('cookie')).toBe('visitor=1');
		expect(new Headers(calls[1].init?.headers).get('authorization')).toBe('Bearer visitor');
	});

	it('preserves the ordered nested album asset sequence before metadata fallback', async () => {
		const second = { ...v3.assets[0], id: '22222222-2222-4222-8222-222222222222' };
		const ordered = [second, v3.assets[0]];
		const shared = { ...v3, assets: [], album: { ...v3.album, assetCount: 2, assets: ordered } };
		const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
			const url = new URL(input.toString());
			if (url.pathname === '/api/shared-links/me') return new Response(JSON.stringify(shared));
			return new Response(JSON.stringify({ albums: {}, assets: { items: [v3.assets[0], v3.assets[1]] } }));
		});

		const result = await createImmichProvider(fetchMock, 'https://immich.example').getSharedLink({
			shareRef: { kind: 'key', value: 'opaque-ref' }, cookie: 'visitor=1', authorization: null
		});

		expect(result.data?.assets.map((asset) => asset.id)).toEqual(ordered.map((asset) => asset.id));
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('retrieves only the exact share-aware map marker contract', async () => {
		const marker = { id: v3.assets[0].id, lat: 51.5, lon: -0.1, city: null, state: null, country: 'UK' };
		const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
			const url = new URL(input.toString());
			expect(url.pathname).toBe(`/api/albums/${v3.album.id}/map-markers`);
			expect(url.search).toBe('?key=opaque-ref');
			expect([...new Headers(init?.headers).keys()].sort()).toEqual(['accept', 'authorization', 'cookie']);
			return new Response(JSON.stringify([marker]));
		});
		const result = await createImmichProvider(fetchMock, 'https://immich.example').getMapMarkers({ shareRef: { kind: 'key', value: 'opaque-ref' }, cookie: 'visitor=1', authorization: 'Bearer visitor' }, v3.album.id);
		expect(result).toEqual({ status: 200, data: [marker] });
	});

	it('quietly omits hidden metadata, location, and configured route coordinates', async () => {
		const description = `---\nimmich-presentation:\n  type: journey\n  version: 1\n  map:\n    enabled: true\n    source: waypoints\n    waypoints:\n      - [10, 20]\n---\n# Private location story`;
		const shared = { ...v3, showMetadata: false, album: { ...v3.album, description, startDate: '2020-01-01T00:00:00Z', updatedAt: '2020-01-02T00:00:00Z' }, assets: [{ ...v3.assets[0], originalFileName: 'private-location.jpg', width: 4000, height: 3000, localDateTime: '2020-01-01T00:00:00Z' }] };
		const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
			if (new URL(input.toString()).pathname.endsWith('/map-markers')) throw new Error('map markers must not be requested');
			return new Response(JSON.stringify(shared));
		});
		const result = await assembleDirectShare(createImmichProvider(fetchMock, 'https://immich.example'), { shareRef: { kind: 'key', value: 'private' }, cookie: null, authorization: null }, 'private');
		expect(result.kind).toBe('page');
		if (result.kind !== 'page') return;
		expect(result.page.album).not.toHaveProperty('startDate');
		expect(result.page.album).not.toHaveProperty('updatedAt');
		expect(result.page.assets[0]).not.toHaveProperty('fileName');
		expect(result.page.assets[0]).not.toHaveProperty('width');
		expect(result.page.presentation.map).toMatchObject({ enabled: false });
		expect(result.page.presentation.map).not.toHaveProperty('waypoints');
		expect(result.page.markers).toEqual([]);
		expect(result.page.routeData).toBeNull();
	});

	it('keeps process health independent from Immich', async () => {
		expect(getHealth().status).toBe(200);
	});

	it('preserves page content and authorized markers when an explicit route fails', async () => {
		const description = `---\nimmich-presentation:\n  type: journey\n  version: 1\n  map:\n    enabled: true\n    source: waypoints\n    waypoints:\n      - [10, 20]\n---\n# Safe story`;
		const shared = { ...v3, album: { ...v3.album, description }, assets: [v3.assets[0]] };
		const marker = { id: v3.assets[0].id, lat: 20, lon: 10, city: null, state: null, country: 'UK' };
		const result = await assembleDirectShare(createImmichProvider(vi.fn(async (input: URL | RequestInfo) => new Response(new URL(input.toString()).pathname.endsWith('map-markers') ? JSON.stringify([marker]) : JSON.stringify(shared))), 'https://immich.example'), { shareRef: { kind: 'key', value: 'opaque' }, cookie: null, authorization: null }, 'route-failure');
		expect(result.kind).toBe('page');
		if (result.kind !== 'page') return;
		expect(result.page.routeData).toBeNull();
		expect(result.page.markers).toEqual([{ id: marker.id, lat: 20, lon: 10, label: 'UK' }]);
		expect(result.page.narrativeHtml).toContain('Safe story');
		expect(result.page.assets).toHaveLength(1);
		expect(result.page.warnings).toContain('map-route-invalid');
	});

	it.each([
		['geojson', '    geojson: not-json', 'map-route-invalid'],
		['brouter-web', '    url: "https://evil.example/brouter-web/#profile=trekking&lonlats=10,20|30,40"', 'brouter-permalink-invalid']
	] as const)('keeps %s failures markers-only without falling back to auto', async (_source, mapFields, warning) => {
		const description = `---\nimmich-presentation:\n  type: journey\n  version: 1\n  map:\n    enabled: true\n    source: ${_source}\n${mapFields}\n---\n# Preserved story`;
		const shared = { ...v3, album: { ...v3.album, description }, assets: [v3.assets[0], { ...v3.assets[0], id: '33333333-3333-4333-8333-333333333333' }] };
		const markers = shared.assets.map((asset, index) => ({ id: asset.id, lat: 20 + index, lon: 10 + index, city: null, state: null, country: 'UK' }));
		const result = await assembleDirectShare(createImmichProvider(vi.fn(async (input: URL | RequestInfo) => new Response(new URL(input.toString()).pathname.endsWith('map-markers') ? JSON.stringify(markers) : JSON.stringify(shared))), 'https://immich.example'), { shareRef: { kind: 'key', value: 'opaque' }, cookie: null, authorization: null }, 'explicit-failure');
		expect(result.kind).toBe('page');
		if (result.kind !== 'page') return;
		expect(result.page.routeData).toBeNull();
		expect(result.page.markers).toHaveLength(2);
		expect(result.page.narrativeHtml).toContain('Preserved story');
		expect(result.page.warnings).toContain(warning);
	});
});
