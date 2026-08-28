import { expect, test } from '@playwright/test';

test.use({
  extraHTTPHeaders: { authorization: 'Bearer fixture' },
  ignoreHTTPSErrors: false
});

test.beforeEach(async ({ context }) => {
  const domain = process.env.E2E_COOKIE_DOMAIN ?? 'pages.example.xyz';
  await context.addCookies([{ name: 'immich_shared_link_token', value: 'fixture', domain, path: '/' }]);
});

test('routes the explicit key share through Traefik with query and auth context', async ({ page }) => {
  const response = await page.goto('/share/key/opaque-ref?view=gallery');
  expect(response?.status()).toBe(200);
  expect(response?.headers()['set-cookie']).toBeUndefined();
  await expect(page.getByRole('heading', { name: 'Traefik Journey' })).toBeVisible();
  await expect(page.getByText('Proxy proof')).toBeVisible();
  expect(page.url()).toContain('/share/key/opaque-ref?view=gallery');
});

test('supports the explicit slug route and deep links on the Pages host', async ({ page }) => {
  const response = await page.goto('/share/slug/opaque-ref/deep?chapter=1');
  expect(response?.status()).toBe(404);

  const valid = await page.goto('/share/slug/opaque-ref?chapter=1');
  expect(valid?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Traefik Journey' })).toBeVisible();
  expect(page.url()).toContain('chapter=1');
});

test('exposes process readiness through the routed host', async ({ request }) => {
  const response = await request.get('/health');
  expect(response.status()).toBe(200);
  await expect(response.json()).resolves.toEqual({ status: 'ok' });
});
