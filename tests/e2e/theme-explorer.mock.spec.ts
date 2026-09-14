import { expect, test } from '@playwright/test';

const shareHref = '/share/key/opaque-ref';

test.describe('production gradient boundary', () => {
	test('renders the themed journal without adding authorization or remote image inputs', async ({ page, context }) => {
		await context.addCookies([{ name: 'immich_shared_link_token', value: 'fixture', domain: '127.0.0.1', path: '/' }]);
		await page.setExtraHTTPHeaders({ authorization: 'Bearer fixture' });
		const requests: string[] = [];
		page.on('request', (request) => requests.push(new URL(request.url()).pathname));
		await page.goto(shareHref);

		const root = page.locator('.theme-root');
		await expect(root).toBeVisible();
		await expect(root).toHaveAttribute('data-theme', 'dark');
		await expect(page.getByRole('heading', { name: 'Mock Journey' })).toBeVisible();
		await expect(root).toHaveAttribute('data-gradient-mode', /theme|automatic/);
		await expect.poll(() => page.evaluate(() => document.querySelector('.theme-root')?.getAttribute('style') ?? '')).not.toContain('url(');
		await expect.poll(() => page.evaluate(() => document.querySelector('.theme-root')?.getAttribute('style') ?? '')).not.toContain('http');
		expect(requests.some((path) => /\/original|\/download/.test(path))).toBe(false);
		expect(requests.some((path) => /\/login|\/users\/me|\/albums(?:\/|$)/.test(path))).toBe(false);
	});

	test('keeps the page usable when the hero sampler cannot decode its image', async ({ page, context }) => {
		await context.addCookies([{ name: 'immich_shared_link_token', value: 'fixture', domain: '127.0.0.1', path: '/' }]);
		await page.route('**/share/key/opaque-ref/media/**/thumbnail**', (route) => route.abort());
		await page.goto(shareHref);
		await expect(page.getByRole('heading', { name: 'Mock Journey' })).toBeVisible();
		await expect(page.locator('.theme-root')).toHaveAttribute('data-gradient-mode', 'theme');
		await expect(page.locator('.theme-root')).toHaveCSS('background-color', 'rgb(22, 22, 22)');
	});
});
