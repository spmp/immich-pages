import { describe, expect, it, beforeEach } from 'vitest';
import { addSession, decodeSession, extractImmichShareToken, sessionForShare } from '../../src/lib/server/share/session';

const ref = { kind: 'key' as const, value: 'one' };
beforeEach(() => { process.env.PAGES_SESSION_SECRET = 'a'.repeat(32); });
describe('Pages share sessions', () => {
	it('encrypts a bounded host-wide envelope and binds lookups to refs', () => {
		const cookie = addSession(undefined, ref, 'token-one', 1000);
		const second = addSession(cookie, { kind: 'slug', value: 'two' }, 'token-two', 1000);
		expect(sessionForShare(second, ref, 1001).token).toBe('token-one');
		expect(sessionForShare(second, { kind: 'key', value: 'wrong' }, 1001).token).toBeNull();
		expect(decodeSession(second)?.entries).toHaveLength(2);
	});
	it('rejects tampering and extracts only the approved upstream token', () => {
		// The cookie starts with a random IV: replacing its first character with a fixed one ('x')
		// changed nothing whenever it already was that character, failing 1 run in 64. Swap in a
		// character that always differs, in each part (IV, auth tag, ciphertext), over many cookies.
		const swapFirst = (part: string) => `${part[0] === 'A' ? 'B' : 'A'}${part.slice(1)}`;
		for (let attempt = 0; attempt < 200; attempt += 1) {
			const cookie = addSession(undefined, ref, 'token-one');
			const parts = cookie.split('.');
			expect(decodeSession(cookie)?.entries[0].token).toBe('token-one');
			for (let index = 0; index < parts.length; index += 1) {
				expect(decodeSession(parts.map((part, at) => at === index ? swapFirst(part) : part).join('.'))).toBeNull();
			}
		}
		expect(extractImmichShareToken('foo=bar; immich_shared_link_token=abc123; x=y')).toBe('abc123');
		expect(extractImmichShareToken('immich_shared_link_token=' + 'x'.repeat(2049))).toBeNull();
	});
	it('expires entries independently and evicts the least recently used entry', () => {
		let cookie: string | undefined;
		for (let index = 0; index < 8; index += 1) cookie = addSession(cookie, { kind: 'key', value: `share-${index}` }, `token-${index}`, 1000 + index);
		const touched = sessionForShare(cookie, { kind: 'key', value: 'share-0' }, 2000).cookie;
		const full = addSession(touched?.split(';')[0].split('=')[1], { kind: 'key', value: 'new-share' }, 'new-token', 2001);
		expect(sessionForShare(full, { kind: 'key', value: 'share-1' }, 2002).token).toBeNull();
		expect(sessionForShare(full, { kind: 'key', value: 'share-0' }, 2002).token).toBe('token-0');
		expect(sessionForShare(full, { kind: 'key', value: 'share-0' }, 1000 + 24 * 60 * 60 * 1000 + 1).token).toBeNull();
	});
	it('forgets the saved access for one share without touching the others', async () => {
		const { removeSession } = await import('../../src/lib/server/share/session');
		const both = addSession(addSession(undefined, ref, 'token-one', 1000), { kind: 'slug', value: 'two' }, 'token-two', 1000);
		const remaining = removeSession(both, ref, 1001);
		expect(remaining && sessionForShare(remaining, ref, 1002).token).toBeNull();
		expect(remaining && sessionForShare(remaining, { kind: 'slug', value: 'two' }, 1002).token).toBe('token-two');
		expect(removeSession(addSession(undefined, ref, 'token-one', 1000), ref, 1001)).toBeNull();
		expect(removeSession(undefined, ref, 1001)).toBeNull();
	});
});

