import { expect, test } from '@playwright/test';

const shareHref = '/share/key/opaque-ref';

test.describe('production gradient boundary', () => {
	test('exposes exactly the production theme choices on desktop and mobile', async ({ page, context }) => {
		await context.addCookies([{ name: 'immich_shared_link_token', value: 'fixture', domain: '127.0.0.1', path: '/' }]);
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto(shareHref);
		await expect(page.locator('#desktop-theme-choice option')).toHaveText(['Default', 'Light', 'Dark']);
		await expect(page.locator('#desktop-theme-choice')).toHaveAttribute('aria-describedby', 'desktop-theme-description');

		await expect(page.locator('#desktop-theme-choice option')).toHaveCount(3);
	});

	test('hydrates OS theme, keeps wrapped content responsive, and changes no auth or media boundary', async ({ page, context }) => {
		await context.addCookies([{ name: 'immich_shared_link_token', value: 'fixture', domain: '127.0.0.1', path: '/' }]);
		await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
		await page.setViewportSize({ width: 390, height: 844 });
		const requests: string[] = [];
		page.on('request', (request) => requests.push(new URL(request.url()).pathname));
		await page.goto(shareHref);

		const root = page.locator('.theme-root');
		await expect(root).toHaveAttribute('data-theme', 'light');
		await expect(page.getByRole('heading', { name: 'Mock Journey' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Open journeys' })).toBeVisible();
		await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe('auto');
		const baseline = requests.length;

		await page.getByRole('button', { name: 'Open journeys' }).click();
		await expect(page.getByRole('dialog', { name: 'Journeys' })).toBeVisible();
		const themeSelect = page.locator('#mobile-theme-choice');
		await expect(themeSelect).toHaveValue('default');
		await expect(themeSelect.locator('option')).toHaveCount(3);
		await expect(themeSelect).toHaveAttribute('aria-describedby', 'mobile-theme-description');
		await themeSelect.selectOption('dark');
		await expect(root).toHaveAttribute('data-theme', 'dark');
		await themeSelect.selectOption('light');
		await expect(root).toHaveAttribute('data-theme', 'light');
		expect(requests.slice(baseline).some((path) => /\/login|\/users\/me|\/albums(?:\/|$)|\/media\//.test(path))).toBe(false);
		await page.keyboard.press('Escape');
		await expect(page.getByRole('button', { name: 'Open journeys' })).toBeFocused();
	});

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
