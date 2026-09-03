import { expect, test } from '@playwright/test';

test.use({ extraHTTPHeaders: { authorization: 'Bearer fixture' } });

for (const host of ['pages.example.xyz', 'immich.example.xyz']) {
  test(`keeps the shielded share workflow on Pages at ${host}`, async ({ page, context }) => {
    const base = `https://${host}:18080`;
    const failed = await page.goto(`${base}/share/key/opaque-ref?chapter=1`);
    expect(failed?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'This journey is protected' })).toBeVisible();
    await page.locator('input[name=password]').fill('wrong-password');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('alert')).toContainText('could not be accepted');
    await page.locator('input[name=password]').fill('fixture-password');
    const login = page.waitForResponse((response) => response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Continue' }).click();
    expect((await login).url()).toContain(host);
    await expect(page.getByRole('heading', { name: 'Traefik Journey' })).toBeVisible();
    expect(page.url()).toContain('/share/key/opaque-ref?chapter=1');
    const cookies = await context.cookies();
    expect(cookies.filter((cookie) => cookie.domain.includes(host)).map((cookie) => cookie.name)).toEqual(['pages_share_session']);
    const html = await page.content();
    expect(html).not.toContain('fake-immich');
    expect(html).not.toContain('immich.example.xyz');
    await expect(page.locator('img').first()).toHaveAttribute('src', /\/share\/key\/opaque-ref\/media\/.*\/thumbnail\?key=opaque-ref/);
    expect((await page.request.get(`${base}/share/key/opaque-ref/media/${'550e8400-e29b-41d4-a716-446655440002'}/thumbnail`)).status()).toBe(200);
    const video = await page.request.get(`${base}/share/key/opaque-ref/media/${'550e8400-e29b-41d4-a716-446655440004'}/video/playback`, { headers: { range: 'bytes=0-3' } });
    expect(video.status()).toBe(206);
    expect(video.headers()['content-range']).toMatch(/^bytes 0-3\//);
    expect(video.url()).not.toContain('fake-immich');
  });
}

test('keeps non-page and ordinary Immich paths outside the Pages surface', async ({ page }) => {
  const nonPage = await page.goto('https://pages.example.xyz:18080/share/key/non-page');
  expect(nonPage?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'This is not a Pages journey' })).toBeVisible();
  const ordinary = await page.request.get('https://immich.example.xyz:18080/albums');
  expect(ordinary.status()).toBe(200);
  expect(await ordinary.text()).toContain('ordinary Immich path');
});

for (const host of ['pages.example.xyz', 'immich.example.xyz']) {
  test(`rejects an expired share at both ${host} authorization boundaries`, async ({ page, context }) => {
    const base = `https://${host}:18080`;
    await context.addCookies([{ name: 'immich_shared_link_token', value: 'fixture', domain: host, path: '/' }]);
    const pageResponse = await page.goto(`${base}/share/key/expired`);
    expect(pageResponse?.status()).toBe(200);
    await expect(page.getByText('This journey is no longer available')).toBeVisible();
    const media = await page.request.get(`${base}/share/key/expired/media/550e8400-e29b-41d4-a716-446655440002/thumbnail`);
    expect(media.status()).toBe(403);
  });
}
