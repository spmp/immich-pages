import { describe, expect, it, vi } from 'vitest';
import { createImmichProvider } from '../../src/lib/server/immich/provider';
import { assembleDirectShare } from '../../src/lib/server/page/assemble';
import { immichOrigin, readBoundedText, requestImmich } from '../../src/lib/server/immich/client';
import v3 from '../fixtures/shared-link/v3-valid-page.json';
import sanitized from '../fixtures/shared-link/v3-sanitized-page.json';
import { decodeRegistry, encodeRegistry, registerShare, REGISTRY_MAX_ENTRIES, REGISTRY_MAX_COOKIE_BYTES } from '../../src/lib/server/share/registry';

const context = { shareRef: { kind: 'key' as const, value: 'opaque-ref' }, cookie: 'visitor=1', authorization: 'Bearer visitor' };

describe('Immich v3 boundary contracts', () => {
	it('rejects tampered, oversized, duplicate, and over-capacity share registries', () => {
		vi.stubEnv('PAGES_VISITED_SHARES_SECRET', 'registry-secret-that-is-at-least-32-characters');
		const now = 1_700_000_000_000;
		const cookie = registerShare(undefined, { kind: 'key', value: 'opaque-ref' }, now);
		const [iv, tag, body] = cookie.split('.');
		const tamperedTag = `${tag.startsWith('x') ? 'y' : 'x'}${tag.slice(1)}`;
		expect(decodeRegistry([iv, tamperedTag, body].join('.'), now)).toBeNull();
		expect(decodeRegistry('x'.repeat(REGISTRY_MAX_COOKIE_BYTES + 1), now)).toBeNull();
		const entries = Array.from({ length: REGISTRY_MAX_ENTRIES + 1 }, (_, index) => ({ kind: 'key' as const, value: `ref-${index}`, firstSeenAt: now, lastSeenAt: now, expiresAt: now + 1_000 }));
		const bounded = encodeRegistry({ version: 1, entries: entries.slice(0, REGISTRY_MAX_ENTRIES) });
		expect(decodeRegistry(bounded, now)?.entries).toHaveLength(REGISTRY_MAX_ENTRIES);
		expect(decodeRegistry(encodeRegistry({ version: 1, entries }), now)).toBeNull();
		const duplicate = encodeRegistry({ version: 1, entries: [entries[0], entries[0]] });
		expect(decodeRegistry(duplicate, now)).toBeNull();
	});
	it('adds exactly one API prefix to an origin', async () => {
		const fetchMock = vi.fn(async (input: URL | RequestInfo) => { expect(input.toString()).toBe('https://immich.example/api/assets/22222222-2222-4222-8222-222222222222/thumbnail'); return new Response('ok'); });
		await requestImmich('https://immich.example/', '/api/assets/22222222-2222-4222-8222-222222222222/thumbnail', context, fetchMock);
		expect(immichOrigin('https://immich.example')).toBe('https://immich.example');
		for (const value of ['https://immich.example/api', 'https://immich.example/path', 'not a url']) expect(() => immichOrigin(value)).toThrow();
	});

	it('forwards only request Cookie and Authorization', async () => {
		const fetchMock = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
			expect(Object.fromEntries(new Headers(init?.headers).entries())).toEqual({ accept: 'application/json', authorization: 'Bearer visitor', cookie: 'visitor=1' });
			return new Response(JSON.stringify(v3));
		});
		const result = await createImmichProvider(fetchMock, 'https://immich.example').getSharedLink(context);
		expect(result.data?.album?.id).toBe('11111111-1111-4111-8111-111111111111');
		expect(JSON.stringify(result)).not.toContain('originalPath');
	});

	it('accepts sanitized assets and projects neither paths nor unknown fields', async () => {
		const result = await assembleDirectShare(createImmichProvider(vi.fn(async () => new Response(JSON.stringify(sanitized))), 'https://immich.example'), context, 'request-1');
		expect(result).toMatchObject({ kind: 'page', page: { assets: [{ id: '22222222-2222-4222-8222-222222222222' }] } });
		expect(JSON.stringify(result)).not.toContain('private');
	});

	it('hydrates v3.1.0 album assets through metadata search while retaining individual shares', async () => {
		const nested = { ...v3, assets: [], album: { ...v3.album, assetCount: 1 } };
		const nestedAsset = { ...v3.assets[0], originalPath: '/private/nested.jpg' };
		const provider = createImmichProvider(vi.fn(async (input: URL | RequestInfo) => new Response(JSON.stringify(new URL(input.toString()).pathname === '/api/shared-links/me' ? nested : { albums: {}, assets: { items: [nestedAsset] } }))), 'https://immich.example');
		const resolved = await provider.getSharedLink(context);
		expect(resolved.data?.assets).toHaveLength(1);
		expect(resolved.data?.assets[0].id).toBe(nestedAsset.id);
		expect(JSON.stringify(resolved)).not.toContain('originalPath');

		const individual = { ...nested, type: 'INDIVIDUAL' as const, assets: [v3.assets[0]], album: undefined };
		const individualResult = await createImmichProvider(vi.fn(async () => new Response(JSON.stringify(individual))), 'https://immich.example').getSharedLink(context);
		expect(individualResult.data?.assets).toHaveLength(1);
	});

	it('trusts a populated top-level assets array as-is without reconciling it against nested album.assets', async () => {
		// A non-empty top-level `assets` is Immich's documented primary field for a shared-link's
		// asset order; this locks that as deliberate current behavior. If a live Immich instance is
		// ever found returning a differently-ordered top-level `assets` for the same album, that is
		// new evidence requiring research before changing this, not something to guess at here.
		const first = { ...v3.assets[0], id: '22222222-2222-4222-8222-222222222222' };
		const second = { ...v3.assets[0], id: '33333333-3333-4333-8333-333333333333' };
		const share = { ...v3, assets: [second, first], album: { ...v3.album, assets: [first, second] } };
		const resolved = await createImmichProvider(vi.fn(async () => new Response(JSON.stringify(share))), 'https://immich.example').getSharedLink(context);
		expect(resolved.data?.assets.map((asset) => asset.id)).toEqual([first.id, second.id]);
	});

	it('preserves metadata-search response order, including equal-date and equal-id ties', async () => {
		const early = { ...v3.assets[0], id: '22222222-2222-4222-8222-222222222222', localDateTime: '2026-01-01T00:00:00.000Z' };
		const late = { ...v3.assets[0], id: '33333333-3333-4333-8333-333333333333', localDateTime: '2026-06-01T00:00:00.000Z' };
		const middle = { ...v3.assets[0], id: '44444444-4444-4444-8444-444444444444', createdAt: '2026-03-01T00:00:00.000Z' };
		const undated = { ...v3.assets[0], id: '55555555-5555-4555-8555-555555555555', localDateTime: undefined, createdAt: undefined };
		const equalDate = { ...v3.assets[0], id: late.id, localDateTime: late.localDateTime };
		const shuffled = { albums: {}, assets: { items: [late, undated, early, middle, equalDate] } };
		const searchFetch = (nested: unknown) => vi.fn(async (input: URL | RequestInfo) => new Response(JSON.stringify(new URL(input.toString()).pathname === '/api/shared-links/me' ? nested : shuffled)));

		const noOrderField = { ...v3, assets: [], album: { ...v3.album, assetCount: 5 } };
		const defaulted = await createImmichProvider(searchFetch(noOrderField), 'https://immich.example').getSharedLink(context);
		expect(defaulted.data?.assets.map((asset) => asset.id)).toEqual([late.id, undated.id, early.id, middle.id, equalDate.id]);

		const ascending = { ...v3, assets: [], album: { ...v3.album, assetCount: 4, order: 'asc' as const } };
		const ascResult = await createImmichProvider(searchFetch(ascending), 'https://immich.example').getSharedLink(context);
		expect(ascResult.data?.assets.map((asset) => asset.id)).toEqual([late.id, undated.id, early.id, middle.id, equalDate.id]);

		const descending = { ...v3, assets: [], album: { ...v3.album, assetCount: 4, order: 'desc' as const } };
		const descResult = await createImmichProvider(searchFetch(descending), 'https://immich.example').getSharedLink(context);
		expect(descResult.data?.assets.map((asset) => asset.id)).toEqual([late.id, undated.id, early.id, middle.id, equalDate.id]);
	});

	it('preserves the ordered nested album assets before considering metadata search', async () => {
		const first = { ...v3.assets[0], id: '22222222-2222-4222-8222-222222222222' };
		const second = { ...v3.assets[0], id: '33333333-3333-4333-8333-333333333333' };
		const nested = { ...v3, assets: [], album: { ...v3.album, assetCount: 2, assets: [second, first] } };
		const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
			const pathname = new URL(input.toString()).pathname;
			if (pathname === '/api/shared-links/me') return new Response(JSON.stringify(nested));
			return new Response(JSON.stringify({ albums: {}, assets: { items: [first, second] } }));
		});
		const resolved = await createImmichProvider(fetchMock, 'https://immich.example').getSharedLink(context);

		expect(resolved.data?.assets.map((asset) => asset.id)).toEqual([second.id, first.id]);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('rejects missing album and non-UUID identifiers', async () => {
		const missing = { ...v3, album: undefined };
		const invalid = { ...v3, assets: [{ ...v3.assets[0], id: 'asset' }] };
		expect((await assembleDirectShare(createImmichProvider(vi.fn(async () => new Response(JSON.stringify(missing))), 'https://immich.example'), context, 'missing')).kind).toBe('unsupported');
		expect((await createImmichProvider(vi.fn(async () => new Response(JSON.stringify(invalid))), 'https://immich.example').getSharedLink(context)).error).toBe('malformed');
	});

	it('bounds streamed bodies', async () => {
		await expect(readBoundedText(new Response('12345'), 4)).rejects.toThrow('response-too-large');
	});

	it('accepts structured Immich server versions', async () => {
		const result = await createImmichProvider(vi.fn(async () => new Response(JSON.stringify({ major: 3, minor: 1, patch: 0 }))), 'https://immich.example').getVersion();
		expect(result).toEqual({ status: 200, version: '3.1.0' });
	});

	it('normalizes valid map markers', async () => {
		const marker = { id: '22222222-2222-4222-8222-222222222222', lat: 48.8566, lon: 2.3522, city: 'Paris', state: null, country: 'France' };
		const result = await createImmichProvider(vi.fn(async () => new Response(JSON.stringify([marker]))), 'https://immich.example').getMapMarkers(context, '11111111-1111-4111-8111-111111111111');
		expect(result).toMatchObject({ status: 200, data: [marker] });
	});

	it('never synthesizes owner credentials or original/download operations', async () => {
		const calls: Array<{ url: string; headers: Headers }> = [];
		const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
			calls.push({ url: input.toString(), headers: new Headers(init?.headers) });
			return new Response(JSON.stringify(v3));
		});
		const provider = createImmichProvider(fetchMock, 'https://immich.example');
		await provider.getSharedLink({ shareRef: { kind: 'key', value: 'opaque-ref' }, cookie: null, authorization: null });
		expect(calls[0].headers.has('x-api-key')).toBe(false);
		expect(calls[0].headers.has('authorization')).toBe(false);
		expect(calls[0].url).not.toMatch(/download|original/);
	});
});
