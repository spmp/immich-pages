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
		const cookie = addSession(undefined, ref, 'token-one');
		expect(decodeSession(`x${cookie.slice(1)}`)).toBeNull();
		expect(extractImmichShareToken('foo=bar; immich_shared_link_token=abc123; x=y')).toBe('abc123');
		expect(extractImmichShareToken('immich_shared_link_token=' + 'x'.repeat(2049))).toBeNull();
	});
});
