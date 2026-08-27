import { describe, expect, it, vi } from 'vitest';
import { createImmichProvider } from '../../src/lib/server/immich/provider';
import { assembleDirectShare } from '../../src/lib/server/page/assemble';
import validPage from '../fixtures/shared-link/valid-page.json';
import validNonPage from '../fixtures/shared-link/valid-non-page.json';
import { GET as getHealth } from '../../src/routes/health/+server';
import { GET as getImmichHealth } from '../../src/routes/health/immich/+server';

describe('direct-share fixture matrix', () => {
	it.each(['key', 'slug'] as const)('resolves a valid %s share without cross-request auth state', async (kind) => {
		const requests: string[] = [];
		const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
			requests.push(`${new URL(input.toString()).search}${new Headers(init?.headers).get('cookie') ?? ''}`);
			return new Response(JSON.stringify(validPage));
		});
		const provider = createImmichProvider(fetchMock, 'https://immich.example');
		const first = await assembleDirectShare(provider, { shareRef: { kind, value: 'first' }, cookie: 'first=1', authorization: null }, 'first-request');
		const second = await assembleDirectShare(provider, { shareRef: { kind, value: 'second' }, cookie: 'second=1', authorization: 'Bearer second' }, 'second-request');
		expect(first).toMatchObject({ kind: 'page', page: { album: { id: 'album-journey' } } });
		expect(second).toMatchObject({ kind: 'page', page: { album: { id: 'album-journey' } } });
		expect(requests).toEqual([`?${kind}=firstfirst=1`, `?${kind}=secondsecond=1`]);
	});

	it('does not promote an ordinary album into a Pages page', async () => {
		const provider = createImmichProvider(vi.fn(async () => new Response(JSON.stringify(validNonPage))), 'https://immich.example');
		expect(await assembleDirectShare(provider, { shareRef: { kind: 'slug', value: 'ordinary' }, cookie: null, authorization: null }, 'ordinary-request')).toEqual({ kind: 'non-page' });
	});

	it('keeps process health independent from Immich', async () => {
		const response = getHealth();
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: 'ok' });
	});

	it('uses only the version probe for the deeper health check', async () => {
		vi.stubEnv('IMMICH_BASE_URL', 'https://immich.example');
		const calls: string[] = [];
		const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
			calls.push(new URL(input.toString()).pathname);
			return new Response(JSON.stringify({ version: 'v1.143.1' }));
		});
		const response = await getImmichHealth({ fetch: fetchMock });
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ compatibility: 'supported', immichVersion: 'v1.143.1' });
		expect(calls).toEqual(['/api/server/version']);
		vi.unstubAllEnvs();
	});

	it('maps missing Immich configuration to a typed unavailable response', async () => {
		vi.stubEnv('IMMICH_BASE_URL', '');
		const { load } = await import('../../src/routes/share/[kind]/[ref]/+page.server');
		await expect(load({
			params: { kind: 'key', ref: 'opaque-ref' },
			request: new Request('https://pages.example/share/key/opaque-ref'),
			locals: { requestId: 'missing-config' },
			fetch: vi.fn()
		} as never)).rejects.toMatchObject({ status: 502 });
		vi.unstubAllEnvs();
	});
});
