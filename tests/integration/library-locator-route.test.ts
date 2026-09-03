import { describe, expect, it, vi } from 'vitest';
import { load } from '../../src/routes/library/page/[locator]/+page.server';

describe('retired authenticated library locator route', () => {
	it('is unreachable regardless of locator or incoming user credentials', async () => {
		await expect((load as unknown as (event: unknown) => Promise<unknown>)({ params: { locator: 'album-id' }, request: new Request('https://pages.test'), setHeaders: vi.fn() })).rejects.toMatchObject({ status: 404 });
	});
});
