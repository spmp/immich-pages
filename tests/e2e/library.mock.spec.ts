import { expect, test } from '@playwright/test';

test.use({ extraHTTPHeaders: { authorization: 'Bearer fixture-user' } });

test.beforeEach(async ({ context }) => {
  await fetch(`${process.env.MOCK_IMMICH_URL}/__fixture/reset`, { method: 'POST' });
  await context.addCookies([{ name: 'immich_user', value: 'fixture', domain: '127.0.0.1', path: '/' }]);
});

test('discovers presentation albums newest first and follows a fresh same-origin page', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  expect(page.url()).toContain('/library');
  await expect(page.getByRole('heading', { name: 'Published journeys' })).toBeVisible();
  const links = page.getByRole('link');
  await expect(links).toHaveCount(2);
  await expect(links.nth(0)).toContainText('Mock Journey');
  await expect(links.nth(1)).toContainText('Older Journey');
  await expect(page.getByText('Private Family Album')).toHaveCount(0);
  const href = await links.nth(0).getAttribute('href');
  expect(href).toMatch(/^\.\/library\/page\/[A-Za-z0-9_.-]+$/);
  expect(href).not.toContain('550e8400-e29b-41d4-a716-446655440003');
  const destination = new URL(href!, page.url()).toString();
  let destinationResponse;
  try {
    destinationResponse = await page.goto(destination);
  } catch (error) {
    throw new Error(`locator navigation aborted: url=${page.url()} content=${(await page.content()).slice(0, 1000)} error=${String(error)}`);
  }
  expect(destinationResponse?.status(), `destination=${page.url()}`).toBe(200);
  await expect(page.getByRole('heading', { name: 'Mock Journey' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Older Journey/ })).toBeVisible();
  await expect(page.locator('a[aria-current="page"]')).toHaveCount(1);
  await expect(page.locator('a[aria-current="page"]')).toContainText('Mock Journey');
  const html = await page.content();
  expect(html).not.toContain('127.0.0.1:');
  expect(html).not.toContain('550e8400-e29b-41d4-a716-446655440003');
  expect(html).not.toContain('Bearer fixture-user');
});

test('desktop collapse and mobile drawer preserve keyboard behavior', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const destination = await page.getByRole('link', { name: /Mock Journey/ }).getAttribute('href');
  await page.goto(destination!);
  await page.reload();

  const sidebar = page.getByRole('complementary', { name: 'Published journeys' });
  const collapse = sidebar.getByRole('button', { name: 'Collapse journeys' });
  await expect(collapse).toBeVisible();
  await expect(sidebar.getByRole('heading', { name: 'Journeys' })).toBeVisible();
  await expect(sidebar.getByRole('link')).toHaveCount(2);
  await expect(sidebar).toHaveCSS('transition-duration', '0s');

  await page.waitForTimeout(1000);
  await collapse.focus();
  await collapse.click();
  const collapsedControl = sidebar.locator('button.collapse');
  await expect(collapsedControl).toHaveAttribute('aria-label', 'Expand journeys');
  await expect(collapsedControl).toHaveAttribute('aria-expanded', 'false');
  await expect(sidebar.getByRole('heading', { name: 'Journeys' })).toHaveCount(0);
  await expect(sidebar.getByRole('link')).toHaveCount(0);

  const expand = sidebar.locator('button.collapse');
  await expand.click();
  await expect(sidebar.getByRole('button', { name: 'Collapse journeys' })).toHaveAttribute('aria-expanded', 'true');
  await expect(sidebar.getByRole('link', { name: /Mock Journey/ })).toBeVisible();
  await expect(sidebar.getByRole('button', { name: 'Collapse journeys' })).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  const opener = page.getByRole('button', { name: 'Open journeys' });
  await expect(opener).toBeVisible();
  await opener.focus();
  await opener.click();

  const dialog = page.getByRole('dialog', { name: 'Journeys' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS('transition-duration', '0s');
  const close = dialog.getByRole('button', { name: 'Close journey navigation' });
  const entries = dialog.getByRole('link');
  await expect(close).toBeFocused();

  await close.press('Shift+Tab');
  await expect(entries.nth(1)).toBeFocused();
  await entries.nth(1).press('Tab');
  await expect(close).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test('fresh destination authorization denies a revoked album while other entries remain usable', async ({ page }) => {
  await page.goto('/');
  const destination = await page.getByRole('link', { name: /Mock Journey/ }).getAttribute('href');
  const revoke = await fetch(`${process.env.MOCK_IMMICH_URL}/__fixture/revoke?album=550e8400-e29b-41d4-a716-446655440003`, { method: 'POST' });
  expect(revoke.status).toBe(204);
  const revokedAlbum = await fetch(`${process.env.MOCK_IMMICH_URL}/api/albums/550e8400-e29b-41d4-a716-446655440003`, { headers: { cookie: 'immich_user=fixture', authorization: 'Bearer fixture-user' } });
  expect(revokedAlbum.status).toBe(403);
  const fresh = await page.request.get(destination!);
  expect(fresh.status()).toBe(200);
  const response = await page.goto(destination!);
  expect(response?.status()).toBe(200);
  expect(await page.content()).not.toContain('550e8400-e29b-41d4-a716-446655440003');
  await page.goto('/library');
  await expect(page.getByRole('link', { name: /Older Journey/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Mock Journey/ })).toHaveCount(0);
});

test('anonymous visitors receive Pages-branded access state without Immich details', async ({ browser }) => {
  const context = await browser.newContext();
  const response = await context.request.get('/library');
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toContain('Your library is private');
  expect(html).toContain('Open Pages with your authenticated Immich session');
  expect(html).not.toContain('request context rejected');
  await context.close();
});
