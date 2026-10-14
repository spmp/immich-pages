import { describe, expect, it } from 'vitest';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { decodeRegistry, encodeRegistry, registerShare, registryCookie, REGISTRY_MAX_COOKIE_BYTES, REGISTRY_MAX_ENTRIES, REGISTRY_TTL_MS } from '../../src/lib/server/share/registry';

process.env.PAGES_VISITED_SHARES_SECRET = 'test-visited-shares-secret-that-is-long-enough';

const ref = { kind: 'key' as const, value: 'opaque-ref' };
// The shape of a real Immich share key: 67 base64url characters.
const realKey = () => randomBytes(50).toString('base64url');
/** A cookie exactly as the first registry format wrote it, for visitors who still hold one. */
function legacyCookie(entries: Array<{ kind: 'key' | 'slug'; value: string; firstSeenAt: number; lastSeenAt: number; expiresAt: number }>): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(process.env.PAGES_VISITED_SHARES_SECRET!).digest(), iv);
	const body = Buffer.concat([cipher.update(Buffer.from(JSON.stringify({ version: 1, entries }))), cipher.final()]);
	return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${body.toString('base64url')}`;
}

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
		for (let index = 0; index < 70; index += 1) value = registerShare(value, { kind: 'slug', value: `ref-${index}` }, index + 1_000);
		const decoded = decodeRegistry(value, 2_000);
		expect(REGISTRY_MAX_ENTRIES).toBe(50);
		expect(decoded?.entries).toHaveLength(50);
		expect(decoded?.entries.some((entry) => entry.value === 'ref-19')).toBe(false);
		// Visits within the same second still keep their order.
		expect(decoded?.entries.map((entry) => entry.value)).toEqual(Array.from({ length: 50 }, (_, index) => `ref-${index + 20}`));
	});

	// The library is this cookie -- Pages keeps no other record of what a visitor has opened --
	// and a cookie is at most 4,096 bytes. The first format spent ~240 of them per share and so
	// was capped at 8; a visitor's library must hold about 50 real share keys.
	it('holds fifty real share keys within a single cookie', () => {
		const keys = Array.from({ length: 50 }, realKey);
		let value: string | undefined;
		keys.forEach((key, index) => { value = registerShare(value, { kind: 'key', value: key }, 1_000_000 + index * 60_000); });
		expect(Buffer.byteLength(value!)).toBeLessThanOrEqual(REGISTRY_MAX_COOKIE_BYTES);
		const decoded = decodeRegistry(value, 1_000_000 + 50 * 60_000);
		expect(decoded?.entries.map((entry) => entry.value)).toEqual(keys);
		expect(decoded?.entries.every((entry) => entry.kind === 'key')).toBe(true);
		expect(decoded?.entries.at(-1)?.lastSeenAt).toBe(1_000_000 + 49 * 60_000);
	});

	it('round-trips every legal ref, including ones that only look like packed keys', () => {
		const refs = [{ kind: 'slug' as const, value: 'a' }, { kind: 'slug' as const, value: 'e2e-forward' }, { kind: 'key' as const, value: 'AAAB' }, { kind: 'key' as const, value: 'AAB' }, { kind: 'key' as const, value: 'x'.repeat(128) }, { kind: 'slug' as const, value: '_-_-' }];
		let value: string | undefined;
		refs.forEach((entry, index) => { value = registerShare(value, entry, 5_000 + index * 1_000); });
		expect(decodeRegistry(value, 20_000)?.entries.map(({ kind, value: ref }) => ({ kind, value: ref }))).toEqual(refs);
	});

	it('drops the oldest shares, rather than failing, when the newest would not fit the cookie', () => {
		let value: string | undefined;
		for (let index = 0; index < 50; index += 1) value = registerShare(value, { kind: 'slug', value: `${String(index).padStart(3, '0')}${'s'.repeat(125)}` }, 1_000 + index * 1_000);
		expect(Buffer.byteLength(value!)).toBeLessThanOrEqual(REGISTRY_MAX_COOKIE_BYTES);
		const decoded = decodeRegistry(value, 60_000);
		expect(decoded?.entries.length).toBeGreaterThan(15);
		expect(decoded?.entries.length).toBeLessThan(50);
		expect(decoded?.entries.at(-1)?.value.startsWith('049')).toBe(true);
	});

	it('still reads a cookie written in the first format, and rewrites it in the compact one', () => {
		const now = 10_000_000;
		const old = legacyCookie([
			{ kind: 'slug', value: 'second', firstSeenAt: 2_000, lastSeenAt: 9_000_000, expiresAt: now + 1_000 },
			{ kind: 'key', value: 'first', firstSeenAt: 1_000, lastSeenAt: 8_000_000, expiresAt: now + 1_000 }
		]);
		expect(decodeRegistry(old, now)?.entries.map((entry) => entry.value)).toEqual(['first', 'second']);
		const rewritten = registerShare(old, { kind: 'key', value: 'third' }, now);
		expect(decodeRegistry(rewritten, now)?.entries.map((entry) => entry.value)).toEqual(['first', 'second', 'third']);
		expect(Buffer.byteLength(rewritten)).toBeLessThan(Buffer.byteLength(old));
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
		const oversized = encodeRegistry({ version: 1, entries: Array.from({ length: 51 }, (_, index) => ({ kind: 'key' as const, value: `ref-${index}`, firstSeenAt: 1, lastSeenAt: 1, expiresAt: 2_000 })) });
		expect(decodeRegistry(oversized, 1)).toBeNull();
	});

	it('expires entries without making them candidates', () => {
		const value = registerShare(undefined, ref, 1_000);
		expect(decodeRegistry(value, 1_000 + REGISTRY_TTL_MS - 1)?.entries).toHaveLength(1);
		expect(decodeRegistry(value, 1_000 + REGISTRY_TTL_MS)?.entries).toEqual([]);
		// Long enough that a library of fifty does not quietly thin out between visits; 400 days
		// is also the longest lifetime browsers will honour for a cookie.
		expect(REGISTRY_TTL_MS).toBe(400 * 24 * 60 * 60 * 1000);
		expect(registryCookie(value)).toContain(`Max-Age=${400 * 24 * 60 * 60};`);
	});
});

describe('forgetting a share', () => {
	it('removes only that share and keeps the others in visit order', async () => {
		const { forgetShare } = await import('../../src/lib/server/share/registry');
		let value: string | undefined;
		for (const [index, name] of ['a', 'b', 'c'].entries()) value = registerShare(value, { kind: 'slug', value: name }, 1_000 + index * 1_000);
		const forgotten = forgetShare(value, { kind: 'slug', value: 'b' }, 5_000);
		expect(decodeRegistry(forgotten, 5_000)?.entries.map((entry) => entry.value)).toEqual(['a', 'c']);
		expect(decodeRegistry(forgetShare(value, { kind: 'key', value: 'b' }, 5_000), 5_000)?.entries).toHaveLength(3);
		expect(decodeRegistry(forgetShare('not-a-registry', ref, 5_000), 5_000)?.entries).toEqual([]);
	});
});
