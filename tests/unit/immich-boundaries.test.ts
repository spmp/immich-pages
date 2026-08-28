import { describe, expect, it, vi } from 'vitest';
import { createImmichProvider } from '../../src/lib/server/immich/provider';
import { assembleDirectShare } from '../../src/lib/server/page/assemble';
import { immichOrigin, readBoundedText, requestImmich } from '../../src/lib/server/immich/client';
import v3 from '../fixtures/shared-link/v3-valid-page.json';
import sanitized from '../fixtures/shared-link/v3-sanitized-page.json';

const context = { shareRef: { kind: 'key' as const, value: 'opaque-ref' }, cookie: 'visitor=1', authorization: 'Bearer visitor' };

describe('Immich v3 boundary contracts', () => {
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

	it('rejects missing album and non-UUID identifiers', async () => {
		const missing = { ...v3, album: undefined };
		const invalid = { ...v3, assets: [{ ...v3.assets[0], id: 'asset' }] };
		expect((await assembleDirectShare(createImmichProvider(vi.fn(async () => new Response(JSON.stringify(missing))), 'https://immich.example'), context, 'missing')).kind).toBe('unsupported');
		expect((await createImmichProvider(vi.fn(async () => new Response(JSON.stringify(invalid))), 'https://immich.example').getSharedLink(context)).error).toBe('malformed');
	});

	it('bounds streamed bodies', async () => {
		await expect(readBoundedText(new Response('12345'), 4)).rejects.toThrow('response-too-large');
	});
});
