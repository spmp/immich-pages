import { describe, expect, it } from 'vitest';
import { decodeRegistry, encodeRegistry, registerShare, registryCookie } from '../../src/lib/server/share/registry';

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
		expect(decodeRegistry(`${value.slice(0, -1)}x`, 1_000)).toBeNull();
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
});
