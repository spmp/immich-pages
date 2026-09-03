import { describe, expect, it, vi } from 'vitest';
import { load } from '../../src/routes/library/+page.server';
import { discoverLibrary } from '../../src/lib/server/library/discover';
import { registerShare } from '../../src/lib/server/share/registry';
import { createImmichProvider } from '../../src/lib/server/immich/provider';
import v3 from '../fixtures/shared-link/v3-valid-page.json';

describe('share-only library route', () => {
	it('freshly reauthorizes every registered share after upstream revocation', async () => {
		process.env.PAGES_VISITED_SHARES_SECRET = 'test-visited-shares-secret-that-is-long-enough';
		let revoked = false;
		const fetchMock = vi.fn(async () => revoked ? new Response('denied', { status: 403 }) : new Response(JSON.stringify(v3)));
		const registryCookie = registerShare(undefined, { kind: 'key', value: 'opaque-ref' });
		const context = { registryCookie, sessionCookie: undefined, requestId: 'freshness-test' };
		const provider = createImmichProvider(fetchMock, 'https://immich.test');
		expect((await discoverLibrary(provider, context)).kind).toBe('ready');
		revoked = true;
		expect((await discoverLibrary(provider, context)).kind).toBe('empty');
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
	it('does not require or forward incoming Immich user credentials', async () => {
		process.env.IMMICH_BASE_URL = 'https://immich.test';
		process.env.PAGES_VISITED_SHARES_SECRET = 'test-secret-that-is-at-least-32-characters-long';
		const fetchMock = vi.fn();
		const result = await (load as unknown as (event: unknown) => Promise<{ library: { kind: string } }> )({
			request: new Request('https://pages.test/library', { headers: { cookie: 'immich=user', authorization: 'Bearer user' } }),
			url: new URL('https://pages.test/library'),
			fetch: fetchMock,
			cookies: { get: () => undefined },
			locals: { requestId: 'test' },
			setHeaders: vi.fn()
		});
		expect(result.library.kind).toBe('empty');
		 expect(fetchMock).not.toHaveBeenCalled();
	});

	it('sets private no-store caching for candidate discovery', async () => {
		process.env.PAGES_VISITED_SHARES_SECRET = 'test-secret-that-is-at-least-32-characters-long';
		const setHeaders = vi.fn();
		await (load as unknown as (event: unknown) => Promise<unknown>)({
			request: new Request('https://pages.test/library'), url: new URL('https://pages.test/library'), fetch: vi.fn(),
			cookies: { get: () => undefined }, locals: { requestId: 'test' }, setHeaders
		});
		expect(setHeaders).toHaveBeenCalledWith({ 'cache-control': 'private, no-store' });
	});
});
