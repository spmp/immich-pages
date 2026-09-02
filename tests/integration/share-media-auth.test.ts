import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as getThumbnail } from '../../src/routes/share/[kind]/[ref]/media/[assetId]/thumbnail/+server';
import { GET as getVideo } from '../../src/routes/share/[kind]/[ref]/media/[assetId]/video/playback/+server';
import v3 from '../fixtures/shared-link/v3-valid-page.json';

const assetId = v3.assets[0].id;
const params = { kind: 'key', ref: 'opaque-ref', assetId };

beforeEach(() => vi.stubEnv('IMMICH_BASE_URL', 'https://immich.example'));

function cookies(initial?: string) {
	const values = new Map(initial ? [['pages_share_session', initial]] : []);
	const set = vi.fn((name: string, value: string) => values.set(name, value));
	return { cookies: { get: (name: string) => values.get(name), set }, set };
}

describe('share media authorization boundary', () => {
	it('re-resolves the share before a thumbnail and clears rejected Pages sessions', async () => {
		const cookieJar = cookies();
		const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
			const path = new URL(input.toString()).pathname;
			return path.endsWith('/shared-links/me')
				? new Response(JSON.stringify(v3))
				: new Response('denied', { status: 403, headers: { 'set-cookie': 'immich_shared_link_token=upstream-secret' } });
		});
		await expect(getThumbnail({ params, request: new Request('https://pages.example/share/key/opaque-ref'), fetch: fetchMock, ...cookieJar } as never)).rejects.toMatchObject({ status: 403 });
		expect(cookieJar.set).toHaveBeenCalledWith('pages_share_session', '', expect.objectContaining({ maxAge: 0 }));
	});

	it('preserves full and single-range video behavior while rechecking membership', async () => {
		const sharedVideo = { ...v3, assets: [{ ...v3.assets[0], type: 'VIDEO' as const }] };
		const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
			const path = new URL(input.toString()).pathname;
			if (path.endsWith('/shared-links/me')) return new Response(JSON.stringify(sharedVideo));
			const range = new Headers(init?.headers).get('range');
			return range
				? new Response('abcd', { status: 206, headers: { 'content-type': 'video/mp4', 'content-length': '4', 'content-range': 'bytes 0-3/4', 'accept-ranges': 'bytes', 'set-cookie': 'immich-secret=leak' } })
				: new Response('abcd', { headers: { 'content-type': 'video/mp4', 'content-length': '4', 'accept-ranges': 'bytes', location: 'https://immich.example/private' } });
		});
		const full = await getVideo({ params, request: new Request('https://pages.example/share/key/opaque-ref'), fetch: fetchMock, ...cookies() } as never);
		expect(full.status).toBe(200);
		expect(await full.text()).toBe('abcd');
		expect(full.headers.get('location')).toBeNull();
		const ranged = await getVideo({ params, request: new Request('https://pages.example/share/key/opaque-ref', { headers: { range: 'bytes=0-3' } }), fetch: fetchMock, ...cookies() } as never);
		expect(ranged.status).toBe(206);
		expect(ranged.headers.get('content-range')).toBe('bytes 0-3/4');
	});
});
