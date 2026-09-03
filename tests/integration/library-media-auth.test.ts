import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../../src/routes/library/page/[locator]/media/[assetId]/thumbnail/+server';
import { issueLibraryLocator } from '../../src/lib/server/immich/locator';

const albumId = '550e8400-e29b-41d4-a716-446655440003';
const assetId = '550e8400-e29b-41d4-a716-446655440002';
const user = { id: '22222222-2222-4222-8222-222222222222' };
const album = { id: albumId, albumName: 'Fixture Journey', description: '---\nimmich-presentation:\n  type: journey\n  version: 1\n---\nFixture' };
const asset = { id: assetId, type: 'IMAGE', originalFileName: 'proof.jpg', width: 10, height: 10 };

const invoke = (locator: string, fetch: typeof globalThis.fetch, headers: Record<string, string> = { cookie: 'immich_user=fixture' }) => GET({
	params: { locator, assetId },
	request: new Request('https://pages.test/library/page/x/media/y/thumbnail', { headers }),
	fetch,
	setHeaders: vi.fn()
} as never);

describe('authenticated library thumbnails', () => {
	beforeEach(() => { process.env.IMMICH_BASE_URL = 'https://immich.test'; process.env.PAGES_LOCATOR_SECRET = 'm'.repeat(32); });

	it('rechecks album and asset membership before proxying a same-origin thumbnail', async () => {
		const locator = issueLibraryLocator(albumId);
		const calls: string[] = [];
		const response = await invoke(locator, vi.fn(async (input, init) => {
			const url = new URL(input.toString()); calls.push(url.pathname);
			expect(new Headers(init?.headers).get('cookie')).toBe('immich_user=fixture');
			if (url.pathname.endsWith(`/albums/${albumId}`)) return new Response(JSON.stringify(album));
			if (url.pathname.endsWith('/search/metadata')) return new Response(JSON.stringify({ assets: { items: [asset] } }));
			return new Response('png', { headers: { 'content-type': 'image/png', 'set-cookie': 'upstream=secret' } });
		}));
		const result = await response;
		expect(result.status).toBe(200);
		expect(result.headers.get('content-type')).toBe('image/png');
		expect(result.headers.get('set-cookie')).toBeNull();
		expect(await result.text()).toBe('png');
		expect(calls).toEqual([`/api/albums/${albumId}`, '/api/search/metadata', `/api/assets/${assetId}/thumbnail`]);
	});

	it('denies a revoked album on a new request without Pages state', async () => {
		const locator = issueLibraryLocator(albumId);
		const fetchMock = vi.fn(async (input: URL | RequestInfo) => new Response('', { status: new URL(input.toString()).pathname.endsWith('/albums/' + albumId) ? 403 : 200 }));
		await expect(invoke(locator, fetchMock)).rejects.toMatchObject({ status: 403 });
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('does not proxy an asset outside the freshly returned album membership', async () => {
		const locator = issueLibraryLocator(albumId);
		const fetchMock = vi.fn(async (input: URL | RequestInfo) => new Response(input.toString().endsWith('/search/metadata') ? JSON.stringify({ assets: { items: [] } }) : JSON.stringify(album)));
		await expect(invoke(locator, fetchMock)).rejects.toMatchObject({ status: 404 });
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('rejects malformed locators and anonymous media requests before Immich', async () => {
		const fetchMock = vi.fn();
		await expect(invoke('not-a-locator', fetchMock)).rejects.toMatchObject({ status: 404 });
		await expect(invoke(issueLibraryLocator(albumId), fetchMock, {})).rejects.toMatchObject({ status: 403 });
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
