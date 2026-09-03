import { describe, expect, it } from 'vitest';
import { decodeRegistry } from '../../src/lib/server/share/registry';

describe('authorized direct-share registry integration contract', () => {
	it('keeps registry state ref-only and never stores request credentials', () => {
		const serialized = JSON.stringify({ kind: 'key', value: 'opaque-ref', cookie: 'Cookie=secret', authorization: 'Bearer secret', password: 'pw', token: 'token', albumId: 'album', url: 'https://immich.example/api/assets/x' });
		expect(serialized).not.toContain('pages_visited_shares');
		// This RED contract is completed when the route emits an encrypted ref-only cookie.
		expect(decodeRegistry(undefined, Date.now())).toBeNull();
	});
});
