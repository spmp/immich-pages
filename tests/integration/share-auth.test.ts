import { describe, expect, it } from 'vitest';
import { createImmichProvider } from '../../src/lib/server/immich/provider';

describe('shared-link login boundary', () => {
	it('posts the password and returns only the approved token', async () => {
		const provider = createImmichProvider(async (input, init) => {
			expect(new URL(input.toString()).pathname).toBe('/api/shared-links/login');
			expect(JSON.parse(String(init?.body))).toEqual({ password: 'correct' });
			return new Response('{}', { headers: { 'set-cookie': 'immich_shared_link_token=secret; Path=/; HttpOnly', location: 'https://immich.example/login' } });
		}, 'https://immich.example');
		await expect(provider.loginSharedLink({ shareRef: { kind: 'slug', value: 'share' }, cookie: null, authorization: null }, 'correct')).resolves.toEqual({ status: 200, token: 'secret' });
	});
	it('fails closed when Immich does not return a token', async () => {
		const provider = createImmichProvider(async () => new Response('{}'), 'https://immich.example');
		await expect(provider.loginSharedLink({ shareRef: { kind: 'key', value: 'share' }, cookie: null, authorization: null }, 'wrong')).resolves.toEqual({ status: 502 });
	});
});
