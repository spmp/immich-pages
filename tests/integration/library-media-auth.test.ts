import { describe, expect, it, vi } from 'vitest';
import { GET } from '../../src/routes/library/page/[locator]/media/[assetId]/thumbnail/+server';

describe('retired authenticated library media route', () => {
	it('is unreachable and never forwards user credentials', async () => {
		const fetchMock = vi.fn();
		await expect(GET({ params: { locator: 'album-id', assetId: 'asset-id' }, request: new Request('https://pages.test', { headers: { cookie: 'immich=user', authorization: 'Bearer user' } }), fetch: fetchMock, setHeaders: vi.fn() } as never)).rejects.toMatchObject({ status: 404 });
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
