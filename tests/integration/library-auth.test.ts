import { describe, expect, it, vi } from 'vitest';
import { load } from '../../src/routes/library/+page.server';

describe('share-only library route', () => {
	it('does not require or forward incoming Immich user credentials', async () => {
		process.env.IMMICH_BASE_URL = 'https://immich.test';
		process.env.PAGES_VISITED_SHARES_SECRET = 'test-secret-that-is-at-least-32-characters-long';
		const fetchMock = vi.fn();
		const result = await (load as unknown as (event: unknown) => Promise<{ library: { kind: string } }> )({
			request: new Request('https://pages.test/library', { headers: { cookie: 'immich=user', authorization: 'Bearer user' } }),
			url: new URL('https://pages.test/library'),
			fetch: fetchMock,
			cookies: { get: () => undefined },
			locals: { requestId: 'test' },
			setHeaders: vi.fn()
		});
		expect(result.library.kind).toBe('empty');
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
