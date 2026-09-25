import { expect, test } from '@playwright/test';

test.beforeEach(async () => {
  await fetch(`${process.env.MOCK_IMMICH_URL}/__fixture/reset`, { method: 'POST' });
});

test('opening a share registers it and anonymous library lists only opened shares', async ({ page, context }) => {
  const response = await page.goto('/share/key/opaque-ref');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Mock Journey' })).toBeVisible();
  const registry = (await context.cookies()).find((cookie) => cookie.name === 'pages_visited_shares');
  expect(registry).toBeTruthy();
  expect(registry?.httpOnly).toBe(true);

  await page.goto('/library');
  await expect(page.getByRole('heading', { name: 'Published journeys' })).toBeVisible();
  const libraryMain = page.locator('main');
  await expect(libraryMain.getByRole('link', { name: /Mock Journey/ })).toHaveCount(1);
  await expect(libraryMain.getByRole('link', { name: /Second Journey/ })).toHaveCount(0);
  expect(await page.content()).not.toMatch(/Immich user|authenticated session|550e8400/);
});

test('anonymous library is share-only and never presents Immich user-session setup', async ({ page }) => {
  await page.goto('/library');
  await expect(page.getByRole('heading', { name: /No published journeys|Your library/ })).toBeVisible();
  expect(await page.content()).not.toMatch(/authenticated Immich session|Immich user authorization|Immich user-session/i);
});

test('multiple opened shares navigate through direct-share routes with fresh requests', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('/share/key/opaque-ref');
  await page.goto('/share/slug/second-ref');
  await page.goto('/library');
  const libraryMain = page.locator('main');
  await expect(libraryMain.getByRole('link', { name: /Mock Journey/ })).toBeVisible();
  await expect(libraryMain.getByRole('link', { name: /Second Journey/ })).toBeVisible();
  await libraryMain.getByRole('link', { name: /Mock Journey/ }).click();
  await expect(page).toHaveURL(/\/share\/key\/opaque-ref$/);
  await expect(page.getByRole('heading', { name: 'Mock Journey' })).toBeVisible();
  expect(requests.some((url) => url.endsWith('/share/key/opaque-ref'))).toBe(true);
});

test('direct shares expose desktop collapse and mobile drawer focus behavior', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/share/key/opaque-ref');
  await page.waitForTimeout(1000);
  expect(await page.content()).not.toContain('550e8400-e29b-41d4-a716-446655440003');
  const sidebar = page.getByRole('complementary', { name: 'Published journeys' });
  await expect(sidebar).toBeVisible();
  const collapse = sidebar.getByRole('button', { name: 'Collapse journeys' });
  await collapse.click();
  const expand = sidebar.locator('button.collapse');
  await expect(expand).toHaveAttribute('aria-label', 'Expand journeys');
  await expand.click();
  await expect(sidebar.getByRole('link', { name: /Mock Journey/ })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const opener = page.getByRole('button', { name: 'Open journeys' });
  await opener.focus();
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Journeys' });
  await expect(dialog).toBeVisible();
  const close = dialog.getByRole('button', { name: 'Close journey navigation' });
  const entries = dialog.getByRole('link');
  await expect(close).toBeFocused();
  await close.press('Shift+Tab');
  await expect(entries.last()).toBeFocused();
  await entries.last().press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test.describe('map state across a client-side navigation between journeys', () => {
  test.use({ extraHTTPHeaders: { authorization: 'Bearer fixture' } });

  test('rebuilds the map instead of staying stuck on the previous journey (or the previous no-map state)', async ({ page, context }) => {
    await context.addCookies([{ name: 'immich_shared_link_token', value: 'fixture', domain: '127.0.0.1', path: '/' }]);
    // Register both shares first via full loads (safe -- a full load always mounts fresh and
    // can never exhibit the bug). The actual test is the *client-side* navigation between them.
    await page.goto('/share/key/no-map-ref');
    await expect(page.locator('[data-phase="3-map-seam"]')).not.toHaveClass(/enabled/);
    await page.goto('/share/key/map-ref');
    const seam = page.locator('[data-phase="3-map-seam"]');
    await expect(seam).toHaveAttribute('data-marker-count', '2');
    await expect(seam.locator('canvas').first()).toBeVisible({ timeout: 15_000 });

    const sidebar = page.getByRole('complementary', { name: 'Published journeys' });
    await expect(sidebar.getByRole('link', { name: /^No-Map Journey/ })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: /^Map Journey/ })).toBeVisible();

    // Client-side navigation to the no-map journey: JourneyMapSlot's onMount previously never
    // reran here (SvelteKit reuses the component across same-route navigations), so the seam
    // would stay stuck showing the previous journey's enabled map and markers forever.
    await sidebar.getByRole('link', { name: /^No-Map Journey/ }).click();
    await expect(page).toHaveURL(/\/share\/key\/no-map-ref$/);
    await expect(seam).not.toHaveClass(/enabled/);
    await expect(seam.locator('canvas')).toHaveCount(0);

    // And the reverse: navigating client-side from no-map back to a map-enabled journey must
    // actually build and show a real map, not stay stuck "disabled" (no onMount rerun) or in a
    // perpetual "Loading journey map" state (enabled flips true but mapStatus -- a local $state
    // set only inside the now-stale onMount closure -- never leaves 'disabled').
    await sidebar.getByRole('link', { name: /^Map Journey/ }).click();
    await expect(page).toHaveURL(/\/share\/key\/map-ref$/);
    await expect(seam).toHaveAttribute('data-marker-count', '2');
    await expect(page.getByText('Loading journey map')).toHaveCount(0);
    await expect(seam.locator('canvas').first()).toBeVisible({ timeout: 15_000 });
  });
});

test('revocation and expiry remove a previously opened share and block fresh page/media access', async ({ page }) => {
  await page.goto('/share/key/revoke-ref');
  await expect(page.getByRole('heading', { name: 'Mock Journey' })).toBeVisible();

  await fetch(`${process.env.MOCK_IMMICH_URL}/__fixture/revoke?ref=revoke-ref`, { method: 'POST' });
  await page.goto('/library');
  await expect(page.getByRole('link', { name: /Mock Journey/ })).toHaveCount(0);
  const revokedPage = await page.goto('/share/key/revoke-ref');
  expect(revokedPage?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'This journey is no longer available' })).toBeVisible();
  expect((await page.request.get('/share/key/revoke-ref/media/550e8400-e29b-41d4-a716-446655440002/thumbnail')).status()).toBe(403);

  await page.goto('/share/key/expire-ref');
  await expect(page.getByRole('heading', { name: 'Mock Journey' })).toBeVisible();
  await fetch(`${process.env.MOCK_IMMICH_URL}/__fixture/expire?ref=expire-ref`, { method: 'POST' });
  await page.goto('/library');
  await expect(page.getByRole('link', { name: /Mock Journey/ })).toHaveCount(0);
  const expiredPage = await page.goto('/share/key/expire-ref');
  expect(expiredPage?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'This journey is no longer available' })).toBeVisible();
});
