import { describe, expect, it } from 'vitest';
import { decodeRegistry } from '../../src/lib/server/share/registry';
import { load } from '../../src/routes/share/[kind]/[ref]/+page.server';
import v3 from '../fixtures/shared-link/v3-valid-page.json';
import { registerShare } from '../../src/lib/server/share/registry';

process.env.PAGES_VISITED_SHARES_SECRET = 'test-visited-shares-secret-that-is-long-enough';
process.env.IMMICH_BASE_URL = 'https://immich.test';

describe('authorized direct-share registry integration contract', () => {
	it('keeps registry state ref-only and never stores request credentials', () => {
		expect(decodeRegistry(undefined, Date.now())).toBeNull();
	});

	it('registers a key only after the direct share assembles successfully', async () => {
		const values = new Map<string, string>();
		const cookies = { get: (name: string) => values.get(name), set: (name: string, value: string) => { values.set(name, value); } };
		const result = await load({ params: { kind: 'key', ref: 'opaque-ref' }, request: new Request('https://pages.test/share/key/opaque-ref', { headers: { cookie: 'immich_shared_link_token=fixture', authorization: 'Bearer fixture' } }), locals: { requestId: 'registry-test' }, fetch: async () => new Response(JSON.stringify(v3)), cookies, setHeaders: () => {} } as never) as { outcome: { kind: string } };
		expect(result.outcome.kind).toBe('page');
		const registry = decodeRegistry(values.get('pages_visited_shares'), Date.now());
		expect(registry?.entries.map(({ kind, value }) => ({ kind, value }))).toEqual([{ kind: 'key', value: 'opaque-ref' }]);
		expect(values.get('pages_visited_shares')).not.toContain('fixture');
	});

	it('does not turn a forged candidate into authorization', async () => {
		const forged = registerShare(undefined, { kind: 'key', value: 'unauthorized' });
		const values = new Map([['pages_visited_shares', forged]]);
		let requests = 0;
		const cookies = { get: (name: string) => values.get(name), set: (name: string, value: string) => { values.set(name, value); } };
		const result = await load({ params: { kind: 'key', ref: 'unauthorized' }, request: new Request('https://pages.test/share/key/unauthorized'), locals: { requestId: 'forged-test' }, fetch: async () => { requests += 1; return new Response(JSON.stringify({ ...v3, password: null }), { status: 403 }); }, cookies, setHeaders: () => {} } as never) as { outcome: { kind: string } };
		expect(result.outcome.kind).toBe('unauthorized');
		expect(requests).toBe(1);
		expect(values.get('pages_visited_shares')).toBe(forged);
	});
});
