import { describe, expect, it, vi } from 'vitest';
import { createImmichProvider } from '../../src/lib/server/immich/provider';
import { assembleDirectShare } from '../../src/lib/server/page/assemble';
import { GET as getHealth } from '../../src/routes/health/+server';
import v3 from '../fixtures/shared-link/v3-valid-page.json';

describe('v3 direct-share matrix', () => {
	it.each(['key', 'slug'] as const)('resolves one authorized %s album without state leakage', async (kind) => {
		const calls: string[] = [];
		const provider = createImmichProvider(vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => { calls.push(`${new URL(input.toString()).search}${new Headers(init?.headers).get('cookie')}`); return new Response(JSON.stringify(v3)); }), 'https://immich.example');
		await assembleDirectShare(provider, { shareRef: { kind, value: 'first' }, cookie: 'first=1', authorization: null }, 'one');
		await assembleDirectShare(provider, { shareRef: { kind, value: 'second' }, cookie: 'second=1', authorization: 'Bearer second' }, 'two');
		expect(calls).toEqual([`?${kind}=firstfirst=1`, `?${kind}=secondsecond=1`]);
	});

	it('keeps ordinary albums out of Pages', async () => {
		const ordinary = { ...v3, album: { ...v3.album, description: 'ordinary album' } };
		const result = await assembleDirectShare(createImmichProvider(vi.fn(async () => new Response(JSON.stringify(ordinary))), 'https://immich.example'), { shareRef: { kind: 'key', value: 'ordinary' }, cookie: null, authorization: null }, 'ordinary');
		expect(result).toEqual({ kind: 'non-page' });
	});

	it('keeps process health independent from Immich', async () => {
		expect(getHealth().status).toBe(200);
	});
});
