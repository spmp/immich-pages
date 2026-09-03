import { describe, expect, it } from 'vitest';
import { decodeRegistry, encodeRegistry, registerShare, registryCookie } from '../../src/lib/server/share/registry';

process.env.PAGES_VISITED_SHARES_SECRET = 'test-visited-shares-secret-that-is-long-enough';

const ref = { kind: 'key' as const, value: 'opaque-ref' };

describe('visited share registry', () => {
	it('registers only the canonical kind and ref in an encrypted cookie', () => {
		const value = registerShare(undefined, ref, 1_000);
		const decoded = decodeRegistry(value, 1_000);
		expect(decoded?.entries).toEqual([{ kind: 'key', value: 'opaque-ref', firstSeenAt: 1_000, lastSeenAt: 1_000, expiresAt: expect.any(Number) }]);
		expect(value).not.toContain('opaque-ref');
		expect(value).not.toContain('immich_shared_link_token');
	});

	it('uses a dedicated cookie contract', () => {
		const value = registerShare(undefined, ref, 1_000);
		expect(registryCookie(value)).toMatch(/^pages_visited_shares=.*; Path=\/; Max-Age=/);
		expect(registryCookie(value)).toContain('HttpOnly; Secure; SameSite=Lax');
	});

	it('rejects a forged envelope', () => {
		const value = registerShare(undefined, ref, 1_000);
		const [iv, tag, body] = value.split('.');
		expect(decodeRegistry(`${iv}.${tag}x.${body}`, 1_000)).toBeNull();
	});

	it('bounds entries and evicts the least recently seen ref', () => {
		let value: string | undefined;
		for (let index = 0; index < 20; index += 1) value = registerShare(value, { kind: 'slug', value: `ref-${index}` }, index + 1_000);
		const decoded = decodeRegistry(value, 2_000);
		expect(decoded?.entries).toHaveLength(8);
		expect(decoded?.entries.some((entry) => entry.value === 'ref-0')).toBe(false);
	});

	it('normalizes invalid cookies to an empty candidate set', () => {
		expect(decodeRegistry('not-a-registry', Date.now())).toBeNull();
		expect(encodeRegistry({ version: 1, entries: [] })).toEqual(expect.any(String));
	});

	it('rejects invalid refs, duplicate entries, and oversized envelopes', () => {
		const invalid = encodeRegistry({ version: 1, entries: [{ kind: 'key', value: 'bad/ref', firstSeenAt: 1, lastSeenAt: 1, expiresAt: 2_000 }] } as never);
		expect(decodeRegistry(invalid, 1)).toBeNull();
		const duplicate = encodeRegistry({ version: 1, entries: [
			{ ...ref, firstSeenAt: 1, lastSeenAt: 1, expiresAt: 2_000 },
			{ ...ref, firstSeenAt: 2, lastSeenAt: 2, expiresAt: 2_000 }
		] });
		expect(decodeRegistry(duplicate, 1)).toBeNull();
		const oversized = encodeRegistry({ version: 1, entries: Array.from({ length: 9 }, (_, index) => ({ kind: 'key' as const, value: `ref-${index}`, firstSeenAt: 1, lastSeenAt: 1, expiresAt: 2_000 })) });
		expect(decodeRegistry(oversized, 1)).toBeNull();
	});

	it('expires entries without making them candidates', () => {
		const value = registerShare(undefined, ref, 1_000);
		expect(decodeRegistry(value, 1_000 + 30 * 24 * 60 * 60 * 1000)?.entries).toEqual([]);
	});
});
