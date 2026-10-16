import { expect, test } from '@playwright/test';

test.use({ extraHTTPHeaders: { authorization: 'Bearer fixture' } });

test('redirects Immich share links to the Pages host', async ({ request }) => {
  const response = await request.get('https://127.0.0.1:18080/share/opaque-ref?chapter=1', { maxRedirects: 0, headers: { host: 'immich.example.xyz' } });
  expect(response.status()).toBe(301);
  expect(response.headers().location).toBe('https://pages.example.xyz/share/key/opaque-ref?chapter=1');
});

test('keeps the shielded share workflow on the Pages host', async ({ page, context }) => {
  const base = 'https://pages.example.xyz:18080';
  const failed = await page.goto(`${base}/share/key/opaque-ref?chapter=1`);
  expect(failed?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'This journey is protected' })).toBeVisible();
  await page.locator('input[name=password]').fill('wrong-password');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('alert')).toContainText('could not be accepted');
  await page.locator('input[name=password]').fill('fixture-password');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Traefik Journey' })).toBeVisible();
  expect(page.url()).toContain('/share/key/opaque-ref?chapter=1');
  expect((await context.cookies()).map((cookie) => cookie.name)).toEqual(['pages_share_session']);
  const html = await page.content();
  expect(html).not.toContain('fake-immich');
  expect(html).not.toContain('immich.example.xyz');
  await expect(page.locator('img').first()).toHaveAttribute('src', /\/share\/key\/opaque-ref\/media\/.*\/thumbnail\?key=opaque-ref/);
  const pagesOrigin = 'https://127.0.0.1:18080';
  const session = (await context.cookies()).find((cookie) => cookie.name === 'pages_share_session');
  const pagesHeaders = { host: 'pages.example.xyz', cookie: `${session?.name}=${session?.value}` };
  expect((await page.request.get(`${pagesOrigin}/share/key/opaque-ref/media/${'550e8400-e29b-41d4-a716-446655440002'}/thumbnail`, { headers: pagesHeaders })).status()).toBe(200);
  const video = await page.request.get(`${pagesOrigin}/share/key/opaque-ref/media/${'550e8400-e29b-41d4-a716-446655440004'}/video/playback`, { headers: { ...pagesHeaders, range: 'bytes=0-3' } });
  expect(video.status()).toBe(206);
  expect(video.headers()['content-range']).toMatch(/^bytes 0-3\//);
  expect(video.url()).not.toContain('fake-immich');
});

test('keeps non-page and ordinary Immich paths outside the Pages surface', async ({ page }) => {
  const nonPage = await page.goto('https://pages.example.xyz:18080/share/key/non-page');
  expect(nonPage?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'This is not a Pages journey' })).toBeVisible();
  const ordinary = await page.request.get('https://127.0.0.1:18080/albums', { headers: { host: 'immich.example.xyz' } });
  expect(ordinary.status()).toBe(200);
  expect(await ordinary.text()).toContain('ordinary Immich path');
});

test('rejects an expired share at the Pages authorization boundary', async ({ page, context }) => {
  const base = 'https://pages.example.xyz:18080';
  await context.addCookies([{ name: 'immich_shared_link_token', value: 'fixture', domain: 'pages.example.xyz', path: '/' }]);
  const pageResponse = await page.goto(`${base}/share/key/expired`);
  expect(pageResponse?.status()).toBe(200);
  await expect(page.getByText('This journey is no longer available')).toBeVisible();
  const media = await page.request.get('https://127.0.0.1:18080/share/key/expired/media/550e8400-e29b-41d4-a716-446655440002/thumbnail', { headers: { host: 'pages.example.xyz' } });
  expect(media.status()).toBe(403);
});
