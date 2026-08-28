import { describe, expect, it, vi } from 'vitest';
import { GET } from '../../src/routes/share/[kind]/[ref]/media/[assetId]/thumbnail/+server';
import v3 from '../fixtures/shared-link/v3-valid-page.json';

describe('same-origin thumbnail boundary', () => {
	it('re-resolves the share, checks membership, and forwards only thumbnail', async () => {
		vi.stubEnv('IMMICH_BASE_URL', 'https://immich.example');
		const calls: Array<{ url: string; headers: Headers }> = [];
		const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => { calls.push({ url: input.toString(), headers: new Headers(init?.headers) }); return calls.length === 1 ? new Response(JSON.stringify(v3)) : new Response('image', { headers: { 'content-type': 'image/jpeg', 'set-cookie': 'must-not-relay' } }); });
		const response = await GET({ params: { kind: 'key', ref: 'opaque_ref', assetId: '22222222-2222-4222-8222-222222222222' }, request: new Request('https://pages.example/share/key/opaque_ref', { headers: { cookie: 'visitor=1', authorization: 'Bearer visitor' } }), fetch: fetchMock } as never);
		expect(response.status).toBe(200);
		expect(calls.map((call) => call.url)).toEqual(['https://immich.example/api/shared-links/me?key=opaque_ref', 'https://immich.example/api/assets/22222222-2222-4222-8222-222222222222/thumbnail']);
		expect(calls[1].headers.get('cookie')).toBe('visitor=1');
		expect(calls[1].headers.get('authorization')).toBe('Bearer visitor');
		expect(response.headers.get('set-cookie')).toBeNull();
		vi.unstubAllEnvs();
	});
});
