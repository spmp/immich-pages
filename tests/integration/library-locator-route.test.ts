import { beforeEach, describe, expect, it, vi } from 'vitest';
import { load } from '../../src/routes/library/page/[locator]/+page.server';
import { issueLibraryLocator } from '../../src/lib/server/immich/locator';
import v3 from '../fixtures/shared-link/v3-valid-page.json';

const albumId = v3.album.id;
const request = (headers: Record<string, string> = {}) => new Request('https://pages.test/library/page/locator', { headers });
const event = (locator: string, fetch: typeof globalThis.fetch, headers: Record<string, string> = {}) => ({ params: { locator }, request: request(headers), fetch, setHeaders: vi.fn() }) as never;
const album = { ...v3.album, description: v3.album.description, assetCount: v3.assets.length };
	const invokeLoad = (input: Parameters<typeof load>[0]) => (load as unknown as (event: Parameters<typeof load>[0]) => Promise<{ outcome: any; navigation?: { entries: unknown[]; activeHref?: string } }>)(input);

describe('authenticated library locator destination', () => {
	beforeEach(() => { process.env.IMMICH_BASE_URL = 'https://immich.test'; });
	it('freshly authorizes and assembles the album without exposing the album id in the locator', async () => {
		process.env.PAGES_LOCATOR_SECRET = 'a'.repeat(32);
		const locator = issueLibraryLocator(albumId);
		const calls: string[] = [];
		const result = await invokeLoad(event(locator, vi.fn(async (input, init) => {
			const pathname = new URL(input.toString()).pathname;
			calls.push(pathname);
			expect(new Headers(init?.headers).get('cookie')).toBe('immich=session');
			const body = pathname.endsWith('/users/me')
				? { id: '22222222-2222-4222-8222-222222222222' }
				: pathname.endsWith('/albums') ? [album]
				: pathname.endsWith('/search/metadata') ? { assets: { items: v3.assets } } : album;
			return new Response(JSON.stringify(body));
		}), { cookie: 'immich=session' }));
		expect(result.outcome.kind).toBe('page');
		expect(calls).toEqual(['/api/users/me', `/api/albums/${albumId}`, '/api/search/metadata', '/api/users/me', '/api/albums', `/api/albums/${albumId}`, '/api/search/metadata']);
		expect(result.navigation?.entries).toHaveLength(1);
		expect(result.navigation?.activeHref).toBe(`/library/page/${locator}`);
		expect(JSON.stringify(result)).not.toContain(albumId);
	});

	it('rechecks access on a new request and returns one safe outcome after revocation', async () => {
		process.env.PAGES_LOCATOR_SECRET = 'b'.repeat(32);
		const locator = issueLibraryLocator(albumId);
		const fetchMock = vi.fn(async (input: URL | RequestInfo) => new Response(new URL(input.toString()).pathname.endsWith('/users/me') ? JSON.stringify({ id: '22222222-2222-4222-8222-222222222222' }) : '', { status: new URL(input.toString()).pathname.endsWith('/users/me') ? 200 : 403 }));
		const result = await invokeLoad(event(locator, fetchMock, { cookie: 'immich=session' }));
		expect(result.outcome).toEqual({ kind: 'presentation-error', state: 'temporary' });
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	it.each(['bad', ''])('redacts malformed locator %s', async (locator) => {
		const fetchMock = vi.fn();
		const result = await invokeLoad(event(locator, fetchMock));
		expect(result.outcome).toEqual({ kind: 'presentation-error', state: 'invalid' });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('does not turn an absent browser session into an Immich request', async () => {
		process.env.PAGES_LOCATOR_SECRET = 'c'.repeat(32);
		const locator = issueLibraryLocator(albumId);
		const fetchMock = vi.fn();
		const result = await invokeLoad(event(locator, fetchMock));
		expect(result.outcome).toEqual({ kind: 'presentation-error', state: 'temporary' });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('projects visibility claims out of the authenticated page model', async () => {
		process.env.PAGES_LOCATOR_SECRET = 'e'.repeat(32);
		const locator = issueLibraryLocator(albumId);
		const userId = '22222222-2222-4222-8222-222222222222';
		const privateClaim = 'private@example.test';
		const description = `---\nimmich-presentation:\n  type: journey\n  version: 1\n  auth:\n    allow:\n      users:\n        - ${privateClaim}\n---\nSafe page`;
		const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
			const pathname = new URL(input.toString()).pathname;
			if (pathname.endsWith('/users/me')) return new Response(JSON.stringify({ id: userId, email: privateClaim }));
			if (pathname.endsWith('/search/metadata')) return new Response(JSON.stringify({ assets: { items: v3.assets } }));
			return new Response(JSON.stringify({ ...album, description }));
		});
		const result = await invokeLoad(event(locator, fetchMock, { cookie: 'immich=session' }));
		expect(result.outcome.kind).toBe('page');
		expect(JSON.stringify(result)).not.toContain(privateClaim);
		expect(result.outcome.page.presentation).not.toHaveProperty('auth');
	});

	it('maps expired locators to the same redacted invalid state', async () => {
		process.env.PAGES_LOCATOR_SECRET = 'd'.repeat(32);
		const expired = issueLibraryLocator(albumId, Date.now() - 25 * 60 * 60 * 1000);
		const result = await invokeLoad(event(expired, vi.fn()));
		expect(result.outcome).toEqual({ kind: 'presentation-error', state: 'invalid' });
	});
});
