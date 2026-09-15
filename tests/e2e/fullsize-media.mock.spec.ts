import { expect, test } from '@playwright/test';

test.use({ extraHTTPHeaders: { authorization: 'Bearer fixture' } });
test.beforeEach(async ({ context }) => {
	await context.addCookies([{ name: 'immich_shared_link_token', value: 'fixture', domain: '127.0.0.1', path: '/' }]);
});

test('keeps an adequate thumbnail as the initial and lightbox anchor source', async ({ page }) => {
	const paths: string[] = [];
	page.on('request', (request) => paths.push(new URL(request.url()).pathname));
	await page.goto('/share/key/opaque-ref');
	await expect(page.locator('[data-lightbox-status]')).toHaveAttribute('data-lightbox-status', 'ready');
	const image = page.locator('#asset-550e8400-e29b-41d4-a716-446655440002');
	await expect(image.locator('img')).toHaveAttribute('data-media-source', 'thumbnail');
	await expect(image.locator('a')).toHaveAttribute('href', /\/thumbnail\?/);
	expect(paths.some((path) => /\/original|\/download/.test(path))).toBe(false);
});

test('retains thumbnail fallback semantics when promotion is unavailable', async ({ page }) => {
	await page.goto('/share/key/opaque-ref');
	const image = page.locator('#asset-550e8400-e29b-41d4-a716-446655440002');
	await expect(image.locator('a')).toHaveAttribute('data-lightbox-fallback', 'native-anchor');
	await expect(image.locator('img')).toHaveAttribute('loading', 'lazy');
	await expect(image.locator('a')).toHaveAttribute('href', /\/thumbnail\?/);
});
